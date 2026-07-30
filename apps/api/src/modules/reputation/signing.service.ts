import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import type { KeyObject, webcrypto } from 'node:crypto';
import type { WorkRecordClaims } from '@trustlance/shared-types';
import { env } from '../../config/env.js';

/**
 * Ed25519 signing for portable work records (§10.1).
 *
 * The signed JWS is the product: anyone holding the platform PUBLIC key can
 * verify a record with no API call and no database. The private key never
 * leaves the server process.
 *
 * Keys arrive via env as base64-encoded PEM (SIGNING_PRIVATE_KEY /
 * SIGNING_PUBLIC_KEY). When absent — fresh dev checkout, CI — an ephemeral
 * pair is generated at boot with a loud warning: everything works, but records
 * signed this run won't verify after a restart. Production must set real keys.
 */

type CryptoKeyLike = webcrypto.CryptoKey | KeyObject;
let privateKey: CryptoKeyLike | null = null;
let publicKey: CryptoKeyLike | null = null;
let publicKeyPem = '';

async function ensureKeys(): Promise<void> {
  if (privateKey && publicKey) return;

  if (env.SIGNING_PRIVATE_KEY && env.SIGNING_PUBLIC_KEY) {
    const privPem = Buffer.from(env.SIGNING_PRIVATE_KEY, 'base64').toString('utf8');
    const pubPem = Buffer.from(env.SIGNING_PUBLIC_KEY, 'base64').toString('utf8');
    privateKey = (await importPKCS8(privPem, 'EdDSA')) as CryptoKeyLike;
    publicKey = (await importSPKI(pubPem, 'EdDSA')) as CryptoKeyLike;
    publicKeyPem = pubPem;
    return;
  }

  if (env.isProduction) {
    throw new Error('SIGNING_PRIVATE_KEY / SIGNING_PUBLIC_KEY must be set in production');
  }

  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  privateKey = pair.privateKey as CryptoKeyLike;
  publicKey = pair.publicKey as CryptoKeyLike;
  publicKeyPem = await exportSPKI(pair.publicKey);
  if (!env.isTest) {
    console.warn(
      '[reputation] no signing keys in env — using an EPHEMERAL keypair. ' +
        'Records signed now will not verify after restart. Run: node scripts/generate-signing-keys.mjs',
    );
    console.warn('[reputation] this run\'s private key (base64 PEM):');
    console.warn('  SIGNING_PRIVATE_KEY=' + Buffer.from(await exportPKCS8(pair.privateKey)).toString('base64'));
    console.warn('  SIGNING_PUBLIC_KEY=' + Buffer.from(publicKeyPem).toString('base64'));
  }
}

/** Signs a work record. Returns the compact JWS — the portable artefact. */
export async function signWorkRecord(claims: WorkRecordClaims): Promise<string> {
  await ensureKeys();
  return new SignJWT({ ...claims })
    // kid lets a future key rotation keep old records verifiable: verifiers
    // pick the right public key from the platform's published key history.
    .setProtectedHeader({ alg: 'EdDSA', kid: env.SIGNING_KEY_ID })
    .setIssuedAt()
    .setIssuer('trustlance')
    .sign(privateKey!);
}

/**
 * Verifies a JWS using ONLY the public key. Deliberately touches no tables:
 * this is the same check any third party can run, which is the whole claim
 * §10.1 makes. Returns the claims on success, null on any failure.
 */
export async function verifyWorkRecord(
  jws: string,
): Promise<{ claims: WorkRecordClaims; keyId: string | undefined } | null> {
  try {
    await ensureKeys();
    const { payload, protectedHeader } = await jwtVerify(jws, publicKey!, { issuer: 'trustlance' });
    return { claims: payload as unknown as WorkRecordClaims, keyId: protectedHeader.kid };
  } catch {
    return null;
  }
}

export async function getPublicKeyPem(): Promise<string> {
  await ensureKeys();
  return publicKeyPem;
}
