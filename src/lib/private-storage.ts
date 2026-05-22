import { ChainApi } from './api';
import { bytesToBase64, base64ToBytes, decodeShards, encodeShards, merkleRoot } from './erasure';
import { stripHexPrefix } from './crypto';

const SEGMENT_ALGORITHM = 'AES-256-GCM/segment-v1';
const OWNER_WRAP_ALGORITHM = 'AES-256-GCM/key-wrap-v1';
const PASSCODE_WRAP_ALGORITHM = 'AES-256-GCM/passcode-wrap-v1';
const PASSCODE_KDF = 'PBKDF2-SHA256/passcode-v1';
const DEFAULT_SEGMENT_SIZE = 1024 * 1024;
const DEFAULT_PBKDF2_ITERATIONS = 310000;

export interface PrivateUploadResult {
  intentId: string;
  dealId: string;
  dataKeyBase64: string;
  ownerEnvelopeId?: string;
}

export interface PasscodeShareResult {
  shareId: string;
  url: string;
  accessCode: string;
  envelopeId?: string;
}

export async function uploadPrivateFile(
  api: ChainApi,
  file: File,
  user: string,
  options: {
    dataShards?: number;
    parityShards?: number;
    duration?: number;
    ownerWrapKeyBase64?: string;
    onProgress?: (stage: string) => void;
  } = {},
): Promise<PrivateUploadResult> {
  const dataShards = options.dataShards ?? 3;
  const parityShards = options.parityShards ?? 1;
  const duration = options.duration ?? 86400;
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const dataKey = randomBytes(32);
  const nonceBase = randomBytes(32);
  const nonceBase64 = bytesToBase64(nonceBase);
  const keyHash = await sha256Hex(dataKey);

  options.onProgress?.('encrypting');

  const segments: {
    segmentId: number;
    segmentRoot: string;
    shardHashes: string[];
    shardCIDs: string[];
  }[] = [];
  const segmentRoots: string[] = [];
  const allShards: { segmentId: number; shardIndex: number; data: Uint8Array; hash: string }[] = [];
  let storedSize = 0;

  for (let segId = 0, offset = 0; offset < plaintext.length || (plaintext.length === 0 && segId === 0); segId++, offset += DEFAULT_SEGMENT_SIZE) {
    const plainSegment = plaintext.slice(offset, Math.min(offset + DEFAULT_SEGMENT_SIZE, plaintext.length));
    const ciphertext = await encryptSegment(plainSegment, dataKey, nonceBase, keyHash, segId);
    storedSize += ciphertext.length;
    const shards = encodeShards(ciphertext, dataShards, parityShards);
    const shardHashes: string[] = [];
    const shardCIDs: string[] = [];
    for (let i = 0; i < shards.length; i++) {
      const hash = await sha256Hex(shards[i]);
      shardHashes.push(hash);
      allShards.push({ segmentId: segId, shardIndex: i, data: shards[i], hash });
    }
    const segmentRoot = merkleRoot(shardHashes);
    segments.push({ segmentId: segId, segmentRoot, shardHashes, shardCIDs });
    segmentRoots.push(segmentRoot);
    if (plaintext.length === 0) break;
  }

  const fileRoot = merkleRoot(segmentRoots);
  const shardSize = dataShards > 0 ? Math.ceil(Math.min(DEFAULT_SEGMENT_SIZE + 16, Math.max(storedSize, 1)) / dataShards) : 0;
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  options.onProgress?.('creating_intent');
  const intentResp = await api.createIntent({
    user,
    fileName: file.name,
    fileSize: storedSize,
    segmentSize: DEFAULT_SEGMENT_SIZE + 16,
    fileRoot,
    segmentRoots,
    segments,
    erasure: { dataShards, parityShards, shardSize },
    policy: {
      class: 'standard',
      duration,
      redundancy: 'erasure',
      renewable: true,
      autoRenew: false,
      deletionPolicy: 'standard',
    },
    lockedFee: 1,
    deadlineUnix: deadline,
    encryption: {
      algorithm: SEGMENT_ALGORITHM,
      keyHash,
      nonceBase64,
      plaintextSize: plaintext.length,
      plaintextSegmentSize: DEFAULT_SEGMENT_SIZE,
    },
  });

  const intentId = (intentResp as any).intentId || (intentResp as any).intent_id;
  const assignments = intentResp.assignments || [];
  const receipts: any[] = [];

  options.onProgress?.('uploading');
  for (const shard of allShards) {
    const assignment = assignments.find((a: any) => {
      return (a.segment_id ?? a.segmentId) === shard.segmentId && (a.shard_index ?? a.shardIndex) === shard.shardIndex;
    });
    if (!assignment) continue;
    const segment = segments[shard.segmentId];
    const receipt = await api.uploadShard({
      intentId,
      user,
      fileRoot,
      segmentId: shard.segmentId,
      segmentRoot: segment.segmentRoot,
      shardIndex: shard.shardIndex,
      shardId: `${intentId}:${shard.segmentId}:${shard.shardIndex}`,
      shardHash: shard.hash,
      shardCID: assignment.shardCID || assignment.shard_cid || '',
      shardSize: shard.data.length,
      policyHash: await sha256Hex(new TextEncoder().encode(JSON.stringify({ class: 'standard', duration, redundancy: 'erasure' }))),
      dataBase64: bytesToBase64(shard.data),
    }, assignment.endpoint || assignment.minerEndpoint);
    receipts.push({ ...receipt, minerEndpoint: assignment.endpoint || assignment.minerEndpoint });
  }

  options.onProgress?.('committing');
  if (receipts.length > 0) {
    await api.batchCommit({ intentId, user, receipts });
  }

  options.onProgress?.('finalizing');
  const finalizeResp = await api.finalize({
    intentId,
    user,
    manifestRoot: await sha256Hex(new TextEncoder().encode(intentId)),
  });

  let ownerEnvelopeId: string | undefined;
  if (options.ownerWrapKeyBase64) {
    const wrapped = await wrapDataKey(dataKey, base64ToBytes(options.ownerWrapKeyBase64), OWNER_WRAP_ALGORITHM);
    const envelopeResp = await api.createKeyEnvelope({
      intentId,
      owner: user,
      recipient: user,
      recipientType: 'owner',
      algorithm: OWNER_WRAP_ALGORITHM,
      encryptedDataKey: wrapped.encryptedDataKey,
      nonce: wrapped.nonce,
    });
    ownerEnvelopeId = envelopeResp.envelope.envelopeId || envelopeResp.envelope.envelope_id;
  }

  return {
    intentId,
    dealId: (finalizeResp as any).dealId || (finalizeResp as any).deal_id,
    dataKeyBase64: bytesToBase64(dataKey),
    ownerEnvelopeId,
  };
}

export async function downloadPrivateFile(
  api: ChainApi,
  intentId: string,
  options: {
    dataKeyBase64: string;
  },
): Promise<{ fileName: string; data: Uint8Array }> {
  const manifest = await api.getManifest(intentId);
  const plan = manifest.plan as any;
  const encryption = plan.encryption;
  if (!encryption) {
    throw new Error('intent is not encrypted');
  }
  const key = base64ToBytes(options.dataKeyBase64);
  const keyHash = await sha256Hex(key);
  if (strip0x(encryption.keyHash ?? encryption.key_hash) !== keyHash) {
    throw new Error('data key does not match manifest');
  }
  const nonceBase = base64ToBytes(encryption.nonceBase64 ?? encryption.nonce_base64);
  const plaintextSize = encryption.plaintextSize ?? encryption.plaintext_size;
  const plaintextSegmentSize = encryption.plaintextSegmentSize ?? encryption.plaintext_segment_size;
  const dataShards = plan.erasure.dataShards ?? plan.erasure.data_shards;
  const parityShards = plan.erasure.parityShards ?? plan.erasure.parity_shards;
  const result = new Uint8Array(plaintextSize);
  const assignments = plan.assignments || [];
  const totalSegments = Math.ceil(plaintextSize / plaintextSegmentSize);

  for (let segId = 0; segId < totalSegments; segId++) {
    const shards: (Uint8Array | null)[] = [];
    for (const assignment of assignments) {
      const assignmentSeg = assignment.segmentId ?? assignment.segment_id;
      if (assignmentSeg !== segId) continue;
      const shardIndex = assignment.shardIndex ?? assignment.shard_index;
      try {
        const endpoint = assignment.endpoint || assignment.minerEndpoint;
        const shardHash = assignment.shardHash ?? assignment.shard_hash;
        shards[shardIndex] = await api.downloadShard(endpoint, shardHash);
      } catch {
        shards[shardIndex] = null;
      }
    }
    const plainLength = Math.min(plaintextSegmentSize, plaintextSize - segId * plaintextSegmentSize);
    const ciphertextLength = plainLength + 16;
    const ciphertext = decodeShards(shards, dataShards, parityShards, ciphertextLength);
    if (!ciphertext) {
      throw new Error(`not enough shards for segment ${segId}`);
    }
    const plaintext = await decryptSegment(ciphertext, key, nonceBase, keyHash, segId);
    result.set(plaintext.slice(0, plainLength), segId * plaintextSegmentSize);
  }

  return { fileName: plan.fileName ?? plan.file_name, data: result };
}

export async function createPasscodeShare(
  api: ChainApi,
  params: {
    intentId: string;
    owner: string;
    dataKeyBase64: string;
    appBaseUrl: string;
    expiresAtUnix?: number;
    includeKeyInUrl?: boolean;
  },
): Promise<PasscodeShareResult> {
  const accessCode = formatAccessCode(randomBytes(16));
  const salt = randomBytes(16);
  const wrappingKey = await derivePasscodeWrappingKey(accessCode, salt);
  const wrapped = await wrapDataKey(base64ToBytes(params.dataKeyBase64), wrappingKey, PASSCODE_WRAP_ALGORITHM);
  const mode = params.includeKeyInUrl ? 'link_fragment' : 'passcode';
  const resp = await api.createPasscodeShare({
    intentId: params.intentId,
    owner: params.owner,
    mode,
    algorithm: PASSCODE_WRAP_ALGORITHM,
    encryptedDataKey: wrapped.encryptedDataKey,
    nonce: wrapped.nonce,
    kdf: {
      name: PASSCODE_KDF,
      salt: bytesToBase64(salt),
      iterations: DEFAULT_PBKDF2_ITERATIONS,
      parallelism: 1,
    },
    expiresAtUnix: params.expiresAtUnix,
  });
  const shareId = resp.share.shareId || resp.share.share_id || '';
  const base = `${params.appBaseUrl.replace(/\/$/, '')}/share/${shareId}`;
  return {
    shareId,
    url: params.includeKeyInUrl ? `${base}#key=${encodeURIComponent(accessCode)}` : base,
    accessCode,
    envelopeId: resp.envelope.envelopeId || resp.envelope.envelope_id,
  };
}

export async function openPasscodeShare(
  api: ChainApi,
  shareId: string,
  accessCode: string,
): Promise<{ intentId: string; dataKeyBase64: string }> {
  const resp = await api.listShares({ shareId });
  const envelope = resp.envelopes?.[0];
  const share = resp.shares[0];
  if (!share || !envelope || !envelope.kdf) {
    throw new Error('share not found');
  }
  const salt = base64ToBytes(envelope.kdf.salt);
  const iterations = envelope.kdf.iterations || DEFAULT_PBKDF2_ITERATIONS;
  const wrappingKey = await derivePasscodeWrappingKey(accessCode, salt, iterations);
  const encryptedDataKey = envelope.encryptedDataKey || envelope.encrypted_data_key || '';
  const dataKey = await unwrapDataKey(encryptedDataKey, envelope.nonce || '', wrappingKey);
  return {
    intentId: share.intentId || share.intent_id || '',
    dataKeyBase64: bytesToBase64(dataKey),
  };
}

export async function sharePrivateFileWithAddress(
  api: ChainApi,
  params: {
    intentId: string;
    owner: string;
    recipient: string;
    encryptedDataKey: string;
    algorithm: string;
    nonce?: string;
    expiresAtUnix?: number;
  },
) {
  return api.createAddressShare(params);
}

async function encryptSegment(plaintext: Uint8Array, key: Uint8Array, nonceBase: Uint8Array, keyHash: string, segmentId: number): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', bufferSource(key), 'AES-GCM', false, ['encrypt']);
  const iv = await segmentNonce(key, nonceBase, segmentId);
  return new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bufferSource(iv), additionalData: bufferSource(segmentAAD(keyHash, segmentId)) },
    cryptoKey,
    bufferSource(plaintext),
  ));
}

async function decryptSegment(ciphertext: Uint8Array, key: Uint8Array, nonceBase: Uint8Array, keyHash: string, segmentId: number): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', bufferSource(key), 'AES-GCM', false, ['decrypt']);
  const iv = await segmentNonce(key, nonceBase, segmentId);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bufferSource(iv), additionalData: bufferSource(segmentAAD(keyHash, segmentId)) },
    cryptoKey,
    bufferSource(ciphertext),
  ));
}

async function segmentNonce(key: Uint8Array, nonceBase: Uint8Array, segmentId: number): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey('raw', bufferSource(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const id = uint64be(segmentId);
  const payload = concatBytes(new TextEncoder().encode(SEGMENT_ALGORITHM), nonceBase, id);
  const sum = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, bufferSource(payload)));
  return sum.slice(0, 12);
}

function segmentAAD(keyHash: string, segmentId: number): Uint8Array {
  return concatBytes(new TextEncoder().encode(`${SEGMENT_ALGORITHM}:${keyHash}:`), uint64be(segmentId));
}

async function wrapDataKey(dataKey: Uint8Array, wrappingKey: Uint8Array, algorithm: string): Promise<{ encryptedDataKey: string; nonce: string }> {
  const nonce = randomBytes(12);
  const cryptoKey = await crypto.subtle.importKey('raw', bufferSource(wrappingKey), 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bufferSource(nonce), additionalData: bufferSource(new TextEncoder().encode(algorithm)) },
    cryptoKey,
    bufferSource(dataKey),
  ));
  return { encryptedDataKey: bytesToBase64(encrypted), nonce: bytesToBase64(nonce) };
}

async function unwrapDataKey(encryptedDataKey: string, nonceBase64: string, wrappingKey: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', bufferSource(wrappingKey), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bufferSource(base64ToBytes(nonceBase64)), additionalData: bufferSource(new TextEncoder().encode(PASSCODE_WRAP_ALGORITHM)) },
    cryptoKey,
    bufferSource(base64ToBytes(encryptedDataKey)),
  ));
}

async function derivePasscodeWrappingKey(accessCode: string, salt: Uint8Array, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', bufferSource(new TextEncoder().encode(accessCode)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bufferSource(salt), iterations },
    material,
    256,
  ));
}

function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  crypto.getRandomValues(out);
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bufferSource(data)));
  return Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function uint64be(value: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt(value), false);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function formatAccessCode(bytes: Uint8Array): string {
  const raw = bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return raw.match(/.{1,4}/g)?.join('-') || raw;
}

function strip0x(value: string): string {
  return stripHexPrefix(value || '');
}
