import type { ChainStatus, KeyEnvelope, ShareRecord, StorageIntentView, StorageUploadPlan } from './types';

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
    master: string;
    name: string;
    agentPub: string;
    permissions: string[];
    dailyLimit: number;
    totalLimit: number;
    expiresAt: number;
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
}
