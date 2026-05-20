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

export const AGENT_KEY_PREFIX = 'fara_';

export const ALLOWED_PERMISSIONS = [
  'create_intent',
  'batch_commit',
  'finalize',
  'renew',
  'retrieval',
  'collection_create',
  'append_record',
];

export const PERMISSION_LABELS: Record<string, string> = {
  create_intent: 'Create Intent',
  batch_commit: 'Batch Commit',
  finalize: 'Finalize',
  renew: 'Renew',
  retrieval: 'Retrieval',
  collection_create: 'Create Collection',
  append_record: 'Append Record',
};
