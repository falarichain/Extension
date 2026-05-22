import { ChainApi } from './api';
import {
  encodeShards,
  computeSegmentRoots,
  merkleRoot,
  bytesToBase64,
} from './erasure';
import { sha256, stripHexPrefix } from './crypto';

function sha256Hex(data: Uint8Array): string {
  return stripHexPrefix(sha256(data));
}

export interface UploadProgress {
  stage: 'init' | 'erasure' | 'uploading' | 'committing' | 'finalizing' | 'done' | 'error';
  intentId?: string;
  dealId?: string;
  segmentsTotal: number;
  segmentsDone: number;
  shardsTotal: number;
  shardsDone: number;
  currentSegment: number;
  error?: string;
}

export async function uploadFile(
  api: ChainApi,
  file: File,
  user: string,
  options: {
    dataShards?: number;
    parityShards?: number;
    duration?: number;
    onProgress?: (progress: UploadProgress) => void;
  } = {},
): Promise<{ intentId: string; dealId: string }> {
  const {
    dataShards = 3,
    parityShards = 1,
    duration = 86400,
    onProgress,
  } = options;

  const report = (p: Partial<UploadProgress>) => {
    onProgress?.({
      stage: 'init',
      segmentsTotal: 0,
      segmentsDone: 0,
      shardsTotal: 0,
      shardsDone: 0,
      currentSegment: 0,
      ...p,
    });
  };

  report({ stage: 'init' });

  const fileData = new Uint8Array(await file.arrayBuffer());
  const fileSize = fileData.length;
  const segmentSize = 1024 * 1024;

  report({ stage: 'erasure' });

  const { segmentRoots, fileRoot } = computeSegmentRoots(fileData, segmentSize);

  const segments: {
    segmentId: number;
    segmentRoot: string;
    shardHashes: string[];
    shardCIDs: string[];
  }[] = [];

  const allShards: { segmentId: number; shardIndex: number; data: Uint8Array; hash: string }[] = [];

  const totalSegments = segmentRoots.length;

  for (let segId = 0; segId < totalSegments; segId++) {
    const segData = fileData.slice(
      segId * segmentSize,
      Math.min((segId + 1) * segmentSize, fileSize),
    );
    const shards = encodeShards(segData, dataShards, parityShards);
    const shardHashes: string[] = [];
    const shardCIDs: string[] = [];

    for (let i = 0; i < shards.length; i++) {
      const hash = sha256Hex(shards[i]);
      shardHashes.push(hash);
      allShards.push({ segmentId: segId, shardIndex: i, data: shards[i], hash });
    }

    segments.push({
      segmentId: segId,
      segmentRoot: merkleRoot(shardHashes),
      shardHashes,
      shardCIDs,
    });
  }

  const shardSize = dataShards > 0
    ? Math.ceil(Math.min(segmentSize, fileSize) / dataShards)
    : 0;

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  report({ stage: 'init', segmentsTotal: totalSegments });

  const intentResp = await api.createIntent({
    user,
    fileName: file.name,
    fileSize,
    segmentSize,
    fileRoot,
    segmentRoots,
    segments: segments.map((s) => ({
      segmentId: s.segmentId,
      segmentRoot: s.segmentRoot,
      shardHashes: s.shardHashes,
      shardCIDs: s.shardCIDs,
    })),
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
  });

  const intentId = intentResp.intentId;
  const assignments = intentResp.assignments || [];

  report({ stage: 'uploading', intentId });

  const receiptEntries: Map<number, any[]> = new Map();
  let shardsDone = 0;
  const shardsTotal = allShards.length;

  for (const shard of allShards) {
    const assignment = assignments.find(
      (a: any) => a.segment_id === shard.segmentId && a.shard_index === shard.shardIndex,
    );

    if (assignment) {
      const segment = segments[shard.segmentId];
      await api.uploadShard(
        {
          intentId,
          user,
          fileRoot,
          segmentId: shard.segmentId,
          segmentRoot: segment.segmentRoot,
          shardIndex: shard.shardIndex,
          shardId: `${intentId}_${shard.segmentId}_${shard.shardIndex}`,
          shardHash: shard.hash,
          shardCID: assignment.shardCID || assignment.shard_cid || '',
          shardSize: shard.data.length,
          policyHash: sha256Hex(new TextEncoder().encode(JSON.stringify({ class: 'standard', duration, redundancy: 'erasure' }))),
          dataBase64: bytesToBase64(shard.data),
        },
        assignment.endpoint || assignment.minerEndpoint,
      );

      if (!receiptEntries.has(shard.segmentId)) {
        receiptEntries.set(shard.segmentId, []);
      }
      receiptEntries.get(shard.segmentId)!.push({
        version: 1,
        minerAddress: assignment.minerAddress || assignment.miner_address,
        minerPublicKey: '',
        user,
        intentId,
        fileRoot,
        segmentId: shard.segmentId,
        segmentRoot: segment.segmentRoot,
        shardIndex: shard.shardIndex,
        shardId: `${intentId}_${shard.segmentId}_${shard.shardIndex}`,
        shardHash: shard.hash,
        shardCID: assignment.shardCID || assignment.shard_cid || '',
        shardSize: shard.data.length,
        sectorCommitment: sha256Hex(shard.data),
        expiresAtUnix: deadline,
        minerEndpoint: assignment.endpoint || assignment.minerEndpoint,
        signature: '',
      });
    }

    shardsDone++;
    report({
      stage: 'uploading',
      intentId,
      segmentsTotal: totalSegments,
      segmentsDone: receiptEntries.size,
      shardsTotal,
      shardsDone,
      currentSegment: shard.segmentId,
    });
  }

  report({ stage: 'committing', intentId });

  for (const [segId, receipts] of receiptEntries.entries()) {
    await api.batchCommit({
      intentId,
      user,
      receipts,
    });
  }

  report({ stage: 'finalizing', intentId });

  const finalizeResp = await api.finalize({
    intentId,
    user,
    manifestRoot: sha256Hex(new TextEncoder().encode(intentId)),
  });

  report({ stage: 'done', intentId, dealId: finalizeResp.dealId });

  return { intentId, dealId: finalizeResp.dealId };
}

export async function downloadFile(
  api: ChainApi,
  intentId: string,
  user: string,
): Promise<{ fileName: string; data: Uint8Array }> {
  const manifest = await api.getManifest(intentId);
  const plan = manifest.plan;

  const fileSize = plan.fileSize;
  const dataShards = plan.erasure.dataShards;
  const parityShards = plan.erasure.parityShards;
  const segmentSize = 1024 * 1024;

  const result = new Uint8Array(fileSize);
  const assignments = plan.assignments || [];

  const segmentRoots = (manifest as any).plan?.segmentRoots || [];
  const totalSegments = segmentRoots.length || Math.ceil(fileSize / segmentSize);

  for (let segId = 0; segId < totalSegments; segId++) {
    const segAssignments = assignments.filter((a: any) => a.segmentId === segId);
    const shards: (Uint8Array | null)[] = [];

    for (const assign of segAssignments) {
      const shardIndex = assign.shardIndex;
      try {
        const endpoint = assign.endpoint || (assign as any).minerEndpoint;
        const data = await api.downloadShard(endpoint, assign.shardHash);
        shards[shardIndex] = data;
      } catch {
        shards[shardIndex] = null;
      }
    }

    const segEnd = Math.min((segId + 1) * segmentSize, fileSize);
    const segLen = segEnd - segId * segmentSize;
    const decoded = decodeShardsFromDownload(shards, dataShards, parityShards, segLen);

    if (decoded) {
      result.set(decoded, segId * segmentSize);
    }
  }

  return { fileName: plan.fileName, data: result };
}

function decodeShardsFromDownload(
  shards: (Uint8Array | null)[],
  dataShards: number,
  parityShards: number,
  originalSize: number,
): Uint8Array | null {
  const available = shards.filter((s): s is Uint8Array => s !== null);
  if (available.length < dataShards) return null;

  const shardSize = available[0].length;

  const filled: Uint8Array[] = [];
  for (let i = 0; i < dataShards; i++) {
    if (shards[i]) {
      filled.push(shards[i]!);
    } else {
      const recovered = new Uint8Array(shardSize);
      for (let j = 0; j < shardSize; j++) {
        let val = 0;
        for (const s of shards) {
          if (s && s.length > j) {
            val ^= s[j];
          }
        }
        recovered[j] = val;
      }
      filled.push(recovered);
    }
  }

  const result = new Uint8Array(originalSize);
  for (let i = 0; i < dataShards; i++) {
    const offset = i * shardSize;
    const copyLen = Math.min(shardSize, originalSize - offset);
    if (copyLen > 0) {
      result.set(filled[i].slice(0, copyLen), offset);
    }
  }

  return result;
}
