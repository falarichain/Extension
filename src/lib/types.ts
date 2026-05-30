export interface WalletAccount {
  address: string;
  publicKey: string;
  label: string;
  walletId: string;
  pathIndex: number;
  createdAt: number;
}

export interface AgentKeyInfo {
  keyId: string;
  name: string;
  master: string;
  permissions: string[];
  dailyLimit: number;
  totalLimit: number;
  expiresAt: number;
  createdAt: number;
  revoked: boolean;
  encodedString: string;
}

export interface LocalAgentKey {
  keyId: string;
  name: string;
  master: string;
  address: string;
  privateKey: string;
  encodedString: string;
  permissions: string[];
  dailyLimit: number;
  totalLimit: number;
  expiresAt: number;
  createdAt: number;
  registered: boolean;
  revoked: boolean;
  hasPrivateKey?: boolean;
  remoteOnly?: boolean;
}

export interface ChainNodeConfig {
  url: string;
  label: string;
}

export interface WalletGroup {
  id: string;
  name: string;
  createdAt: number;
}

export interface WalletState {
  accounts: WalletAccount[];
  selectedAccount: string | null;
  wallets: WalletGroup[];
  agentKeys: LocalAgentKey[];
  chainNode: ChainNodeConfig;
  isLocked: boolean;
}

export interface ChainStatus {
  height: number;
  latestBlockHash: string;
  pendingTransactions: number;
  accounts: number;
  intents: number;
  finalizedIntents: number;
  deals: number;
  miners: number;
  activeMiners: number;
  capacityBytes: number;
  usedBytes: number;
  validators: number;
  feeMarket: { baseFee: number };
  storagePricing: { basePricePerGiBMonth: number; minimumFee: number };
  totalSupply: number;
  peerCount: number;
  chainId?: string;
  chain_id?: string;
  bonusGrantedCount?: number;
  maxBonusAddresses?: number;
  registrationBonusAmount?: number;
  stakePerTiB?: number;
  minCapacityBytes?: number;
}

export interface StorageIntentView {
  intentId: string;
  user: string;
  fileName: string;
  fileSize: number;
  status: string;
  storageStatus: string;
  accessStatus: string;
  lockedFee: number;
  dealId: string;
  expiresAtUnix: number;
  uploadedSize: number;
  committedSegments: number;
}

export interface StorageUploadPlan {
  intentId: string;
  user: string;
  fileName: string;
  fileSize: number;
  erasure: { dataShards: number; parityShards: number; shardSize: number };
  assignments: {
    segmentId: number;
    shardIndex: number;
    minerAddress: string;
    endpoint: string;
    shardHash: string;
    shardSize: number;
  }[];
  encrypted?: boolean;
  encryptionKey?: string;
}

/** 1 GF = 10^8 smallest units */
export const TOKEN_UNIT = 100_000_000;

export const AGENT_KEY_PREFIX = 'fara_';

export const MAX_AGENT_KEY_PERMISSIONS = 10;

export const ALLOWED_PERMISSIONS = [
  'create_intent',
  'batch_commit',
  'finalize',
  'renew',
  'terminate',
  'collection_create',
  'append_record',
  'create_key_envelope',
  'share_create',
  'share_revoke',
];

export const PERMISSION_LABELS: Record<string, string> = {
  create_intent: 'Create Intent',
  batch_commit: 'Batch Commit',
  finalize: 'Finalize',
  renew: 'Renew',
  terminate: 'Terminate Deal',
  collection_create: 'Create Collection',
  append_record: 'Append Record',
  create_key_envelope: 'Create Key Envelope',
  share_create: 'Create Share',
  share_revoke: 'Revoke Share',
};

export const PERMISSION_PRESETS: { key: string; permissions: string[] }[] = [
  { key: 'dataUpload', permissions: ['create_intent', 'batch_commit', 'finalize'] },
  { key: 'dealManagement', permissions: ['renew', 'terminate'] },
];

export interface PasscodeKDFParams {
  name: string;
  salt: string;
  memoryKiB?: number;
  memory_kib?: number;
  iterations: number;
  parallelism?: number;
}

export interface KeyEnvelope {
  envelopeId?: string;
  envelope_id?: string;
  intentId?: string;
  intent_id?: string;
  shareId?: string;
  share_id?: string;
  owner: string;
  recipient: string;
  recipientType?: string;
  recipient_type?: string;
  algorithm: string;
  encryptedDataKey?: string;
  encrypted_data_key?: string;
  nonce?: string;
  kdf?: PasscodeKDFParams;
  createdAtUnix?: number;
  created_at_unix?: number;
  expiresAtUnix?: number;
  expires_at_unix?: number;
  revoked?: boolean;
}

export interface ShareRecord {
  shareId?: string;
  share_id?: string;
  intentId?: string;
  intent_id?: string;
  owner: string;
  mode: 'address' | 'passcode' | 'link_fragment';
  recipient?: string;
  envelopeId?: string;
  envelope_id?: string;
  createdAtUnix?: number;
  created_at_unix?: number;
  expiresAtUnix?: number;
  expires_at_unix?: number;
  revoked?: boolean;
}

// ── Multisig ──

export const MULTISIG_PROPOSAL_PREFIX = 'fms_';

export interface MultisigWallet {
  address: string;
  signers: string[];
  threshold: number;
  nonce: number;
  salt: number;
  created_at_unix: number;
}

export interface MultisigWalletInfo {
  wallet: MultisigWallet;
  balance: number;
}

export interface MultisigSignature {
  signer: string;
  signature: string;
}

export interface MultisigExecRequest {
  wallet: string;
  operation: string;
  payload: unknown;
  nonce: number;
  fee: number;
  signatures: MultisigSignature[];
}

export interface MultisigProposal {
  id: string;
  wallet: string;
  operation: string;
  payload: unknown;
  nonce: number;
  fee: number;
  signatures: MultisigSignature[];
  status: 'pending' | 'executed' | 'rejected';
  createdAt: number;
}

// ── Validators & Delegation ──

export interface ValidatorInfo {
  owner_address: string;
  operator_address: string;
  operator_public_key: string;
  endpoint?: string;
  stake: number;
  delegated_stake: number;
  self_stake: number;
  status: string;
  consensus: boolean;
  registered_at_unix: number;
  produced_blocks: number;
  slashed: number;
  evidence_count: number;
  delegator_count: number;
  rewards: number;
  delegation_rewards: number;
  availability_score_bps: number;
  commission_rate_bps: number;
}

export interface StakeDelegation {
  delegator: string;
  validator: string;
  amount: number;
  since_unix: number;
}

export interface DelegateStakeResponse {
  delegator: string;
  validator: string;
  amount: number;
  delegated_stake: number;
}

export interface UndelegateStakeResponse {
  delegator: string;
  validator: string;
  released: number;
  delegated_stake: number;
}

// ── Collections ──

export interface DataCollection {
  collection_id: string;
  user: string;
  name: string;
  description?: string;
  metadata?: Record<string, string>;
  created_at_unix: number;
  updated_at_unix: number;
}

export interface DataRecord {
  record_id: string;
  collection_id: string;
  user: string;
  intent_id: string;
  deal_id?: string;
  parent_record?: string;
  kind?: string;
  key?: string;
  file_root: string;
  manifest_root?: string;
  metadata?: Record<string, string>;
  created_at_unix: number;
}

export interface CollectionRecordFilter {
  kind?: string;
  key?: string;
  parent_record?: string;
  after_unix?: number;
  before_unix?: number;
  limit?: number;
  reverse?: boolean;
}

export interface CollectionResponse {
  collection: DataCollection;
}

export interface CollectionRecordsResponse {
  collection: DataCollection;
  filter?: CollectionRecordFilter;
  records: DataRecord[];
}

export interface UserCollectionsResponse {
  user: string;
  collections: DataCollection[];
}

// ── Bridge ──

export interface BridgeConfig {
  enabled: boolean;
  bridgePoolAddress: string;
  relayerAddress: string;
  minBridgeAmount: number;
  delaySeconds: number;
  maxAmountPerDay: number;
  currentDayAmount: number;
  dayStartUnix: number;
  paused: boolean;
  chainId: string;
  targetChainId: string;
}

export interface BridgeOutbound {
  nonce: number;
  targetChainId: string;
  sender: string;
  recipient: string;
  amount: number;
  fee: number;
  status: string;
  lockedAtUnix: number;
  claimableAfter: number;
}

export interface BridgeInbound {
  nonce: number;
  sourceTxHash: string;
  sourceBlockNumber: number;
  recipient: string;
  amount: number;
  status: string;
  detectedAtUnix: number;
  claimableAfter: number;
}

export interface BridgePendingResponse {
  outbounds: BridgeOutbound[];
  inbounds: BridgeInbound[];
}
