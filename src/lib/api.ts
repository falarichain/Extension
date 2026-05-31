import type { ChainStatus, KeyEnvelope, ShareRecord, StorageIntentView, StorageUploadPlan, MultisigWalletInfo, MultisigExecRequest, MultisigWallet, ValidatorInfo, StakeDelegation, DelegateStakeResponse, UndelegateStakeResponse, BridgeConfig, BridgeOutbound, BridgePendingResponse, CollectionResponse, CollectionRecordsResponse, CollectionRecordFilter, UserCollectionsResponse } from './types';

const DEFAULT_TIMEOUT = 60000;

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const body = await resp.text();
    if (resp.status < 200 || resp.status >= 300) {
      throw new ApiError(body || `HTTP ${resp.status}`, resp.status);
    }
    if (!body) return undefined as T;
    return JSON.parse(body) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function toWireKey(key: string): string {
  const normalized = key
    .replace(/CIDs/g, 'Cids')
    .replace(/CID/g, 'Cid')
    .replace(/ID/g, 'Id');
  return normalized.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function toWirePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toWirePayload(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      toWireKey(key),
      toWirePayload(entry),
    ]),
  );
}

export class ChainApi {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getStatus(): Promise<ChainStatus> {
    return request<ChainStatus>(this.baseUrl, '/status');
  }

  async getBalance(address: string): Promise<{ balance: number; nonce: number }> {
    return request(this.baseUrl, `/accounts/${encodeURIComponent(address)}`);
  }

  async getAccount(address: string): Promise<{
    address: string;
    publicKey?: string;
    public_key?: string;
    balance: number;
    nonce: number;
    lockedStake: number;
    lockedStorage: number;
  }> {
    return request(this.baseUrl, `/accounts/${encodeURIComponent(address)}`);
  }

  async faucet(address: string, amount: number): Promise<{ account: { address: string; balance: number } }> {
    return request(this.baseUrl, '/faucet', {
      method: 'POST',
      body: JSON.stringify({ address, amount }),
    });
  }

  async transfer(payload: {
    from: string;
    to: string;
    amount: number;
    nonce: number;
    fee: number;
    signature: string;
    publicKey: string;
  }): Promise<{ from: { address: string; balance: number }; to: { address: string; balance: number } }> {
    return request(this.baseUrl, '/transfer', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async createIntent(payload: {
    user: string;
    fileName: string;
    fileSize: number;
    segmentSize: number;
    fileRoot: string;
    segmentRoots: string[];
    segments: {
      segmentId: number;
      segmentRoot: string;
      shardHashes: string[];
      shardCIDs: string[];
    }[];
    repair_pools?: {
      pool_id: number;
      segment_ids: [number, number];
      cross_parity: { shard_hashes: string[]; shard_cids: string[]; shard_size: number };
    }[];
    erasure: { dataShards: number; parityShards: number; shardSize: number };
    policy: {
      class: string;
      duration: number;
      redundancy: string;
      renewable: boolean;
      autoRenew: boolean;
      deletionPolicy: string;
    };
    lockedFee: number;
    deadlineUnix: number;
    encryption?: {
      algorithm: string;
      keyHash: string;
      nonceBase64: string;
      plaintextSize: number;
      plaintextSegmentSize: number;
    };
  }): Promise<{ intentId: string; status: string; requiredFee: number; assignments: any[] }> {
    return request(this.baseUrl, '/intents', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async uploadShard(payload: {
    intentId: string;
    user: string;
    fileRoot: string;
    segmentId: number;
    segmentRoot: string;
    shardIndex: number;
    shardId: string;
    shardHash: string;
    shardCID: string;
    shardSize: number;
    policyHash: string;
    dataBase64: string;
  }, minerEndpoint: string): Promise<any> {
    return request(minerEndpoint, '/upload', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async batchCommit(payload: {
    intentId: string;
    user: string;
    receipts: {
      version: number;
      minerAddress: string;
      minerPublicKey: string;
      user: string;
      intentId: string;
      fileRoot: string;
      segmentId: number;
      segmentRoot: string;
      shardIndex: number;
      shardId: string;
      shardHash: string;
      shardCID: string;
      shardSize: number;
      sectorCommitment: string;
      expiresAtUnix: number;
      minerEndpoint: string;
      signature: string;
    }[];
  }): Promise<{ intentId: string; status: string; committedSegments: number }> {
    return request(this.baseUrl, '/batch-commits', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async finalize(payload: {
    intentId: string;
    user: string;
    manifestRoot: string;
  }): Promise<{ intentId: string; dealId: string; status: string }> {
    return request(this.baseUrl, '/finalize', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async topUpPermanentFund(payload: {
    intentId: string;
    user: string;
    amount: number;
  }): Promise<{ fund: any }> {
    return request(this.baseUrl, '/intents/permanent-fund', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async getIntent(intentId: string): Promise<StorageIntentView> {
    return request(this.baseUrl, `/intents/${intentId}`);
  }

  async getManifest(intentId: string): Promise<{
    intentId: string;
    status: string;
    dealId: string;
    complete: boolean;
    receiptCount: number;
    plan: StorageUploadPlan;
  }> {
    return request(this.baseUrl, `/manifests/${intentId}`);
  }

  async createKeyEnvelope(payload: {
    intentId: string;
    owner: string;
    recipient: string;
    recipientType: 'owner' | 'address' | 'agent' | 'passcode';
    algorithm: string;
    encryptedDataKey: string;
    nonce?: string;
    kdf?: any;
    expiresAtUnix?: number;
  }): Promise<{ envelope: KeyEnvelope }> {
    return request(this.baseUrl, '/key-envelopes', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async listKeyEnvelopes(params: {
    intentId?: string;
    recipient?: string;
    recipientType?: string;
    shareId?: string;
    includeRevoked?: boolean;
  }): Promise<{ envelopes: KeyEnvelope[] }> {
    const query = new URLSearchParams();
    if (params.intentId) query.set('intent_id', params.intentId);
    if (params.recipient) query.set('recipient', params.recipient);
    if (params.recipientType) query.set('recipient_type', params.recipientType);
    if (params.shareId) query.set('share_id', params.shareId);
    if (params.includeRevoked) query.set('include_revoked', 'true');
    return request(this.baseUrl, `/key-envelopes?${query.toString()}`);
  }

  async createAddressShare(payload: {
    intentId: string;
    owner: string;
    recipient: string;
    algorithm: string;
    encryptedDataKey: string;
    nonce?: string;
    kdf?: any;
    expiresAtUnix?: number;
  }): Promise<{ share: ShareRecord; envelope: KeyEnvelope }> {
    return request(this.baseUrl, '/shares/address', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async createPasscodeShare(payload: {
    intentId: string;
    owner: string;
    mode?: 'passcode' | 'link_fragment';
    algorithm: string;
    encryptedDataKey: string;
    nonce?: string;
    kdf: any;
    expiresAtUnix?: number;
  }): Promise<{ share: ShareRecord; envelope: KeyEnvelope }> {
    return request(this.baseUrl, '/shares/passcode', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async revokeShare(payload: { shareId: string; owner: string }): Promise<void> {
    return request(this.baseUrl, '/shares/revoke', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async listShares(params: {
    intentId?: string;
    owner?: string;
    recipient?: string;
    shareId?: string;
    includeRevoked?: boolean;
  }): Promise<{ shares: ShareRecord[]; envelopes?: KeyEnvelope[] }> {
    const query = new URLSearchParams();
    if (params.intentId) query.set('intent_id', params.intentId);
    if (params.owner) query.set('owner', params.owner);
    if (params.recipient) query.set('recipient', params.recipient);
    if (params.shareId) query.set('share_id', params.shareId);
    if (params.includeRevoked) query.set('include_revoked', 'true');
    return request(this.baseUrl, `/shares?${query.toString()}`);
  }

  async registerAgentKey(payload: {
    chainId: string;
    master: string;
    name: string;
    agentPub: string;
    permissions: string[];
    dailyLimit: number;
    totalLimit: number;
    expiresAt: number;
    nonce: number;
    signature: string;
  }): Promise<{ key: any }> {
    return request(this.baseUrl, '/agent-keys', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async listAgentKeys(master: string): Promise<{ keys: any[] }> {
    return request(this.baseUrl, `/agent-keys?master=${encodeURIComponent(master)}`);
  }

  async revokeAgentKey(payload: {
    chainId: string;
    keyId: string;
    master: string;
    nonce: number;
    signature: string;
  }): Promise<void> {
    return request(this.baseUrl, '/agent-keys/revoke', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async extendAgentKey(payload: {
    chainId: string;
    keyId: string;
    master: string;
    expiresAt: number;
    nonce: number;
    signature: string;
  }): Promise<any> {
    return request(this.baseUrl, '/agent-keys/extend', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async topupAgentKey(payload: {
    chainId: string;
    keyId: string;
    master: string;
    totalLimit: number;
    nonce: number;
    signature: string;
  }): Promise<any> {
    return request(this.baseUrl, '/agent-keys/topup', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async getStorageQuote(payload: {
    fileSize: number;
    erasure: { dataShards: number; parityShards: number };
    policy: { class: string; duration: number; redundancy: string };
  }): Promise<{ pricing: any; requiredFee: number }> {
    return request(this.baseUrl, '/storage/quote', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async getBlocks(height: number): Promise<any> {
    return request(this.baseUrl, `/blocks/${height}`);
  }

  async getLatestBlock(): Promise<any> {
    return request(this.baseUrl, '/blocks/latest');
  }

  async getProviders(shardHash?: string, shardCID?: string, intentId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shardHash) params.set('shard_hash', shardHash);
    if (shardCID) params.set('shard_cid', shardCID);
    if (intentId) params.set('intent_id', intentId);
    return request(this.baseUrl, `/storage/providers?${params.toString()}`);
  }

  async getRoutes(shardHash?: string, shardCID?: string, intentId?: string): Promise<any> {
    const params = new URLSearchParams();
    if (shardHash) params.set('shard_hash', shardHash);
    if (shardCID) params.set('shard_cid', shardCID);
    if (intentId) params.set('intent', intentId);
    return request(this.baseUrl, `/storage/routes?${params.toString()}`);
  }

  async downloadShard(minerEndpoint: string, shardHash: string): Promise<Uint8Array> {
    const url = `${minerEndpoint.replace(/\/$/, '')}/shards/${shardHash}.bin`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new ApiError(`HTTP ${resp.status}`, resp.status);
    }
    return new Uint8Array(await resp.arrayBuffer());
  }

  async downloadBlock(minerEndpoint: string, cid: string): Promise<Uint8Array> {
    const url = `${minerEndpoint.replace(/\/$/, '')}/blocks/${cid}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new ApiError(`HTTP ${resp.status}`, resp.status);
    }
    return new Uint8Array(await resp.arrayBuffer());
  }

  // ── Multisig ──

  async createMultisigWallet(payload: {
    signers: string[];
    threshold: number;
    salt: number;
    signature: string;
  }): Promise<MultisigWallet> {
    return request<MultisigWallet>(this.baseUrl, '/multisig', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async getMultisigWallet(address: string): Promise<MultisigWalletInfo> {
    return request<MultisigWalletInfo>(this.baseUrl, `/multisig/${encodeURIComponent(address)}`);
  }

  async listMultisigWallets(signer?: string): Promise<{ wallets: MultisigWalletInfo[] }> {
    const query = signer ? `?signer=${encodeURIComponent(signer)}` : '';
    return request(this.baseUrl, `/multisig${query}`);
  }

  async multisigExec(req: MultisigExecRequest): Promise<any> {
    return request(this.baseUrl, '/multisig/exec', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(req)),
    });
  }

  // ── Validators & Delegation ──

  async listValidators(): Promise<{ validators: ValidatorInfo[] }> {
    return request(this.baseUrl, '/validators');
  }

  async getDelegations(delegator: string): Promise<{ delegations: StakeDelegation[] }> {
    return request(this.baseUrl, `/validators/delegations?delegator=${encodeURIComponent(delegator)}`);
  }

  async delegateStake(payload: {
    delegator: string;
    validator: string;
    amount: number;
    nonce: number;
    signature: string;
    publicKey: string;
  }): Promise<DelegateStakeResponse> {
    return request(this.baseUrl, '/validators/delegate', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async undelegateStake(payload: {
    delegator: string;
    validator: string;
    amount: number;
    nonce: number;
    signature: string;
    publicKey: string;
  }): Promise<UndelegateStakeResponse> {
    return request(this.baseUrl, '/validators/undelegate', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  // ── Collections ──

  async getCollection(collectionId: string): Promise<CollectionResponse> {
    return request<CollectionResponse>(this.baseUrl, `/collections/${encodeURIComponent(collectionId)}`);
  }

  async getCollectionRecords(collectionId: string, filter?: CollectionRecordFilter): Promise<CollectionRecordsResponse> {
    const params = new URLSearchParams();
    if (filter) {
      if (filter.kind) params.set('kind', filter.kind);
      if (filter.key) params.set('key', filter.key);
      if (filter.parent_record) params.set('parent', filter.parent_record);
      if (filter.after_unix != null) params.set('after', String(filter.after_unix));
      if (filter.before_unix != null) params.set('before', String(filter.before_unix));
      if (filter.limit != null) params.set('limit', String(filter.limit));
      if (filter.reverse) params.set('reverse', 'true');
    }
    const qs = params.toString();
    const path = `/collections/${encodeURIComponent(collectionId)}/records${qs ? `?${qs}` : ''}`;
    return request<CollectionRecordsResponse>(this.baseUrl, path);
  }

  async listUserCollections(user: string): Promise<UserCollectionsResponse> {
    return request<UserCollectionsResponse>(this.baseUrl, `/user-collections?user=${encodeURIComponent(user)}`);
  }

  async createCollection(payload: {
    chainId: string;
    user: string;
    name: string;
    description?: string;
    metadata?: Record<string, string>;
    nonce: number;
    publicKey: string;
    signature: string;
  }): Promise<CollectionResponse> {
    return request<CollectionResponse>(this.baseUrl, '/collections', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  // ── Bridge ──

  async getBridgeConfig(): Promise<BridgeConfig> {
    return request<BridgeConfig>(this.baseUrl, '/bridge/config');
  }

  async bridgeOut(payload: {
    sender: string;
    recipient: string;
    targetChainId: string;
    amount: number;
    fee: number;
    nonce: number;
    signature: string;
    publicKey: string;
  }): Promise<{ nonce: number; sender: { address: string; balance: number } }> {
    return request(this.baseUrl, '/bridge/out', {
      method: 'POST',
      body: JSON.stringify(toWirePayload(payload)),
    });
  }

  async getBridgePending(): Promise<BridgePendingResponse> {
    return request<BridgePendingResponse>(this.baseUrl, '/bridge/pending');
  }

  async getBridgeOutbound(nonce: number): Promise<BridgeOutbound> {
    return request<BridgeOutbound>(this.baseUrl, `/bridge/outbound/${nonce}`);
  }
}
