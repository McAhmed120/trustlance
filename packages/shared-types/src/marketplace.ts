/** Sprint 2-5 transport shapes. Integer cents everywhere (§11). */

export const JOB_CATEGORIES = [
  'web-development',
  'mobile-development',
  'design',
  'writing',
  'data',
  'devops',
  'other',
] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

export type JobStatus = 'OPEN' | 'CLOSED';
export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';
export type ContractStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type MilestoneState =
  | 'CREATED'
  | 'FUNDED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'DISPUTED'
  | 'RELEASED'
  | 'RESOLVED'
  | 'CANCELLED';
export type LedgerEntryType = 'DEPOSIT' | 'FUND' | 'RELEASE' | 'REFUND';
export type DisputeStatus = 'OPEN' | 'RESOLVED';

export interface JobDto {
  id: string;
  clientId: string;
  clientName: string;
  clientAvatarUrl: string | null;
  title: string;
  description: string;
  category: string;
  budgetCents: number;
  skills: string[];
  status: JobStatus;
  proposalCount: number;
  createdAt: string;
}

export interface ProposalDto {
  id: string;
  jobId: string;
  jobTitle?: string;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatarUrl: string | null;
  freelancerTrustScore: number | null;
  coverLetter: string;
  amountCents: number;
  status: ProposalStatus;
  createdAt: string;
}

export interface MilestoneDto {
  id: string;
  contractId: string;
  title: string;
  description: string | null;
  amountCents: number;
  dueDate: string | null;
  state: MilestoneState;
  submissionNote: string | null;
  submittedAt: string | null;
  autoReleaseAt: string | null;
  approvedAt: string | null;
  rating: number | null;
  feedback: string | null;
  /** Funds currently held in this milestone's escrow (derived from ledger). */
  escrowCents: number;
  openDispute?: DisputeDto | null;
}

export interface ContractDto {
  id: string;
  jobId: string;
  jobTitle: string;
  clientId: string;
  clientName: string;
  freelancerId: string;
  freelancerName: string;
  totalAmountCents: number;
  status: ContractStatus;
  createdAt: string;
  milestones: MilestoneDto[];
}

export interface WalletDto {
  balanceCents: number;
  /** Total currently locked in escrow across the user's milestones. */
  inEscrowCents: number;
  ledger: LedgerRowDto[];
}

export interface LedgerRowDto {
  id: string;
  type: LedgerEntryType;
  amountCents: number;
  milestoneId: string | null;
  note: string | null;
  createdAt: string;
}

export interface WorkRecordDto {
  id: string;
  milestoneId: string;
  jws: string;
  payload: WorkRecordClaims;
  createdAt: string;
}

/** The claims inside a signed work record (§10.1). */
export interface WorkRecordClaims {
  v: 1;
  platform: 'trustlance';
  freelancerId: string;
  clientId: string;
  contractId: string;
  milestoneId: string;
  title: string;
  amountCents: number;
  rating: number | null;
  completedAt: string;
}

export interface ReputationExportDto {
  keyId: string;
  publicKeyPem: string;
  freelancerId: string;
  exportedAt: string;
  records: string[]; // compact JWS strings — each independently verifiable
}

export interface DisputeDto {
  id: string;
  milestoneId: string;
  raisedById: string;
  reason: string;
  status: DisputeStatus;
  freelancerPct: number | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  contractId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface TimeEntryDto {
  id: string;
  contractId: string;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  hash: string;
  prevHash: string;
  createdAt: string;
}

export interface FileDto {
  id: string;
  contractId: string;
  uploaderId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: string;
  payload: { title: string; link?: string };
  readAt: string | null;
  createdAt: string;
}
