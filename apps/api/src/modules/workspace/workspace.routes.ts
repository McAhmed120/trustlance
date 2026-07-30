import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { MessageDto, TimeEntryDto, FileDto } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { loadContractForParty } from '../contracts/contracts.routes.js';
import { emitToContract } from '../../realtime/socket.js';

/**
 * Contract workspace (Sprint 5): chat history, tamper-evident time tracking,
 * file sharing. Everything here is scoped to one contract and gated on being
 * a party to it.
 */
export const workspaceRouter: Router = Router();

function param(req: { params: unknown }, key: string): string {
  return (req.params as Record<string, string>)[key]!;
}

// ------------------------------------------------------------------ chat ----

/** GET /api/contracts/:id/messages */
workspaceRouter.get('/:id/messages', requireAuth, async (req, res) => {
  const contractId = param(req, 'id');
  await loadContractForParty(contractId, req.user!.id, req.user!.role);

  const rows = await prisma.message.findMany({
    where: { contractId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const names = new Map<string, string>();
  for (const uid of new Set(rows.map((m) => m.senderId))) {
    const p = await prisma.profile.findUnique({ where: { userId: uid }, select: { displayName: true } });
    names.set(uid, p?.displayName ?? 'User');
  }
  const body: MessageDto[] = rows.map((m) => ({
    id: m.id,
    contractId: m.contractId,
    senderId: m.senderId,
    senderName: names.get(m.senderId) ?? 'User',
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));
  res.json(body);
});

/** POST /api/contracts/:id/messages — persists, then broadcasts to the room. */
workspaceRouter.post(
  '/:id/messages',
  requireAuth,
  validateBody(z.object({ body: z.string().min(1).max(5000).trim() }).strict()),
  async (req, res) => {
    const contractId = param(req, 'id');
    // Admins can read a workspace for arbitration but must not speak in it —
    // an arbitrator chatting as a party would contaminate the evidence trail.
    const contract = await loadContractForParty(contractId, req.user!.id, 'PARTY_ONLY');
    void contract;

    const msg = await prisma.message.create({
      data: { contractId, senderId: req.user!.id, body: req.body.body },
    });
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user!.id },
      select: { displayName: true },
    });
    const dto: MessageDto = {
      id: msg.id,
      contractId,
      senderId: msg.senderId,
      senderName: profile?.displayName ?? 'User',
      body: msg.body,
      createdAt: msg.createdAt.toISOString(),
    };
    emitToContract(contractId, 'chat:message', dto);
    res.status(201).json(dto);
  },
);

// ---------------------------------------------------------- time tracking ----

/**
 * Hash chain (§10.4): hash = SHA256(canonical entry data + prevHash).
 * The canonical string is what gets hashed — recompute it identically at
 * verification time or the chain "breaks" for spurious reasons.
 */
function entryHash(e: {
  contractId: string;
  freelancerId: string;
  startedAt: Date;
  endedAt: Date | null;
  note: string | null;
  prevHash: string;
}): string {
  const canonical = [
    e.contractId,
    e.freelancerId,
    e.startedAt.toISOString(),
    e.endedAt?.toISOString() ?? '',
    e.note ?? '',
    e.prevHash,
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

const GENESIS = 'genesis';

/** GET /api/contracts/:id/time — entries + a fresh chain verification. */
workspaceRouter.get('/:id/time', requireAuth, async (req, res) => {
  const contractId = param(req, 'id');
  await loadContractForParty(contractId, req.user!.id, req.user!.role);

  const rows = await prisma.timeEntry.findMany({
    where: { contractId },
    orderBy: { createdAt: 'asc' },
  });

  // Walk the chain from genesis; any edited/deleted row breaks every link
  // after it. This runs on every read so tampering surfaces immediately.
  let prev = GENESIS;
  let chainValid = true;
  for (const r of rows) {
    const expected = entryHash({ ...r, prevHash: prev });
    if (r.prevHash !== prev || r.hash !== expected) {
      chainValid = false;
      break;
    }
    prev = r.hash;
  }

  const entries: TimeEntryDto[] = rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    note: r.note,
    hash: r.hash,
    prevHash: r.prevHash,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json({ chainValid, entries });
});

/**
 * POST /api/contracts/:id/time — log a completed interval.
 * Entries are immutable once written (append-only, like the ledger): a timer
 * "stop" creates the row rather than updating a running one, so no row is
 * ever edited and the chain stays trivially intact.
 */
workspaceRouter.post(
  '/:id/time',
  requireAuth,
  validateBody(
    z
      .object({
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        note: z.string().max(500).trim().optional(),
      })
      .strict()
      .refine((v) => new Date(v.endedAt) > new Date(v.startedAt), {
        message: 'endedAt must be after startedAt',
      }),
  ),
  async (req, res) => {
    const contractId = param(req, 'id');
    const contract = await loadContractForParty(contractId, req.user!.id, 'PARTY_ONLY');
    if (contract.freelancerId !== req.user!.id) {
      throw ApiError.forbidden('Only the freelancer logs time');
    }

    // Serialize appends per contract so two stops can't both claim the same
    // prevHash — same advisory-lock trick as the wallet.
    const entry = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'timechain:' + contractId}))`;
      const last = await tx.timeEntry.findFirst({
        where: { contractId },
        orderBy: { createdAt: 'desc' },
        select: { hash: true },
      });
      const prevHash = last?.hash ?? GENESIS;
      const data = {
        contractId,
        freelancerId: req.user!.id,
        startedAt: new Date(req.body.startedAt),
        endedAt: new Date(req.body.endedAt),
        note: req.body.note ?? null,
        prevHash,
      };
      return tx.timeEntry.create({ data: { ...data, hash: entryHash(data) } });
    });

    emitToContract(contractId, 'time:entry', { id: entry.id });
    res.status(201).json({ id: entry.id, hash: entry.hash });
  },
);

// ----------------------------------------------------------------- files ----

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

/** Conservative allow-list (Day 23's "file-type validation"). */
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/markdown',
  'application/json',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOAD_ROOT, param(req as { params: unknown }, 'id'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // Random stored name: the original filename is attacker-controlled input
    // and must never influence a filesystem path.
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new ApiError(400, 'BAD_FILE_TYPE', `File type ${file.mimetype} is not allowed`));
  },
});

/** GET /api/contracts/:id/files */
workspaceRouter.get('/:id/files', requireAuth, async (req, res) => {
  const contractId = param(req, 'id');
  await loadContractForParty(contractId, req.user!.id, req.user!.role);

  const rows = await prisma.fileAttachment.findMany({
    where: { contractId },
    orderBy: [{ filename: 'asc' }, { version: 'desc' }],
  });
  const body: FileDto[] = rows.map((f) => ({
    id: f.id,
    contractId: f.contractId,
    uploaderId: f.uploaderId,
    filename: f.filename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    version: f.version,
    createdAt: f.createdAt.toISOString(),
  }));
  res.json(body);
});

/** POST /api/contracts/:id/files — multipart upload; same name bumps version. */
workspaceRouter.post('/:id/files', requireAuth, upload.single('file'), async (req, res) => {
  const contractId = param(req, 'id');
  await loadContractForParty(contractId, req.user!.id, 'PARTY_ONLY');
  const file = req.file;
  if (!file) throw ApiError.badRequest('No file provided (field name: "file")');

  const priorVersions = await prisma.fileAttachment.count({
    where: { contractId, filename: file.originalname },
  });

  const row = await prisma.fileAttachment.create({
    data: {
      contractId,
      uploaderId: req.user!.id,
      filename: file.originalname,
      storedPath: file.path,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      version: priorVersions + 1,
    },
  });

  emitToContract(contractId, 'file:new', { id: row.id, filename: row.filename });
  res.status(201).json({ id: row.id, version: row.version });
});

/** GET /api/contracts/:id/files/:fileId/download */
workspaceRouter.get('/:id/files/:fileId/download', requireAuth, async (req, res) => {
  const contractId = param(req, 'id');
  await loadContractForParty(contractId, req.user!.id, req.user!.role);

  const file = await prisma.fileAttachment.findUnique({ where: { id: param(req, 'fileId') } });
  if (!file || file.contractId !== contractId) throw ApiError.notFound('File not found');
  res.download(file.storedPath, file.filename);
});
