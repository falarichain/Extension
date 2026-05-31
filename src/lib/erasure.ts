import { sha256, stripHexPrefix } from './crypto';

function sha256Hex(data: Uint8Array): string {
  return stripHexPrefix(sha256(data));
}

export function computeSegmentRoots(data: Uint8Array, segmentSize: number): {
  fileSize: number;
  segmentRoots: string[];
  fileRoot: string;
} {
  const roots: string[] = [];
  for (let offset = 0; offset < data.length; offset += segmentSize) {
    const chunk = data.slice(offset, Math.min(offset + segmentSize, data.length));
    roots.push(sha256Hex(chunk));
  }
  return {
    fileSize: data.length,
    segmentRoots: roots,
    fileRoot: merkleRoot(roots),
  };
}

export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256Hex(new Uint8Array(0));
  let layer = hashes;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : layer[i];
      const combined = new Uint8Array([...hexToBytes(left), ...hexToBytes(right)]);
      next.push(sha256Hex(combined));
    }
    layer = next;
  }
  return layer[0];
}

// ─── GF(2^8) arithmetic ────────────────────────────────────────────
// Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1  (0x11d)
// Compatible with klauspost/reedsolomon (Go chain-side).

const GF_SIZE = 256;
const GF_POLY = 0x11d;

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x >= GF_SIZE) x ^= GF_POLY;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gfExp[gfLog[a] + gfLog[b]];
}

function gfInv(a: number): number {
  if (a === 0) throw new Error('GF(2^8): inverse of zero');
  return gfExp[255 - gfLog[a]];
}

// ─── Cauchy matrix encoder ─────────────────────────────────────────

function buildEncodingMatrix(dataShards: number, parityShards: number): Uint8Array[] {
  const total = dataShards + parityShards;
  const mat: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    mat.push(new Uint8Array(dataShards));
  }
  // Top rows: identity (data shards pass through)
  for (let i = 0; i < dataShards; i++) mat[i][i] = 1;
  // Bottom rows: Cauchy matrix
  //   X = {0, …, parityShards-1},  Y = {parityShards, …, total-1}
  //   M[p][j] = 1 / (X[p] ⊕ Y[j])   in GF(2^8)
  for (let p = 0; p < parityShards; p++) {
    for (let j = 0; j < dataShards; j++) {
      mat[dataShards + p][j] = gfInv(p ^ (parityShards + j));
    }
  }
  return mat;
}

function invertMatrix(src: Uint8Array[][], size: number): Uint8Array[][] | null {
  const work: Uint8Array[][] = [];
  const inv: Uint8Array[][] = [];
  for (let i = 0; i < size; i++) {
    work.push(new Uint8Array(src[i]));
    const id = new Uint8Array(size);
    id[i] = 1;
    inv.push(id);
  }
  for (let col = 0; col < size; col++) {
    let pivot = -1;
    for (let row = col; row < size; row++) {
      if (work[row][col] !== 0) { pivot = row; break; }
    }
    if (pivot === -1) return null;
    if (pivot !== col) {
      [work[col], work[pivot]] = [work[pivot], work[col]];
      [inv[col], inv[pivot]] = [inv[pivot], inv[col]];
    }
    const scale = gfInv(work[col][col]);
    for (let j = 0; j < size; j++) {
      work[col][j] = gfMul(work[col][j], scale);
      inv[col][j] = gfMul(inv[col][j], scale);
    }
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = work[row][col];
      if (factor === 0) continue;
      for (let j = 0; j < size; j++) {
        work[row][j] ^= gfMul(factor, work[col][j]);
        inv[row][j] ^= gfMul(factor, inv[col][j]);
      }
    }
  }
  return inv;
}

// ─── Public API ─────────────────────────────────────────────────────

export function encodeShards(
  data: Uint8Array,
  dataShards: number,
  parityShards: number,
): Uint8Array[] {
  const shardSize = Math.ceil(data.length / dataShards);
  const paddedSize = shardSize * dataShards;
  const padded = new Uint8Array(paddedSize);
  padded.set(data);

  const shards: Uint8Array[] = [];
  for (let i = 0; i < dataShards; i++) {
    shards.push(padded.slice(i * shardSize, (i + 1) * shardSize));
  }

  const encMatrix = buildEncodingMatrix(dataShards, parityShards);
  for (let p = 0; p < parityShards; p++) {
    const row = encMatrix[dataShards + p];
    const parity = new Uint8Array(shardSize);
    for (let j = 0; j < shardSize; j++) {
      let val = 0;
      for (let d = 0; d < dataShards; d++) {
        val ^= gfMul(row[d], shards[d][j]);
      }
      parity[j] = val;
    }
    shards.push(parity);
  }

  return shards;
}

export function decodeShards(
  shards: (Uint8Array | null)[],
  dataShards: number,
  parityShards: number,
  originalSize: number,
): Uint8Array | null {
  const total = dataShards + parityShards;
  if (shards.length !== total) return null;

  const available = shards.filter((s): s is Uint8Array => s !== null);
  if (available.length < dataShards) return null;

  // Fast path: all data shards present
  const allDataPresent = shards.slice(0, dataShards).every((s) => s !== null);
  if (allDataPresent) {
    const result = new Uint8Array(originalSize);
    for (let i = 0; i < dataShards; i++) {
      const offset = i * shards[i]!.length;
      const copyLen = Math.min(shards[i]!.length, originalSize - offset);
      if (copyLen > 0) result.set(shards[i]!.slice(0, copyLen), offset);
    }
    return result;
  }

  const shardSize = available[0].length;
  const encMatrix = buildEncodingMatrix(dataShards, parityShards);

  // Pick the first dataShards available shards to form a solvable sub-system
  const indices: number[] = [];
  const subRows: Uint8Array[][] = [];
  const subData: Uint8Array[] = [];

  for (let i = 0; i < total && indices.length < dataShards; i++) {
    if (shards[i] !== null) {
      indices.push(i);
      subRows.push(Array.from(encMatrix[i]) as unknown as Uint8Array);
      subData.push(shards[i]!);
    }
  }
  if (indices.length < dataShards) return null;

  // Convert subRows to proper Uint8Array[]
  const matrix: Uint8Array[][] = subRows.map((r) => new Uint8Array(r));
  const invMatrix = invertMatrix(matrix, dataShards);
  if (!invMatrix) return null;

  // Reconstruct missing data shards
  const recovered: (Uint8Array | null)[] = new Array(dataShards).fill(null);
  for (let d = 0; d < dataShards; d++) {
    if (shards[d] !== null) {
      recovered[d] = shards[d];
    } else {
      const shard = new Uint8Array(shardSize);
      const invRow = invMatrix[d];
      for (let j = 0; j < shardSize; j++) {
        let val = 0;
        for (let k = 0; k < dataShards; k++) {
          val ^= gfMul(invRow[k], subData[k][j]);
        }
        shard[j] = val;
      }
      recovered[d] = shard;
    }
  }

  const result = new Uint8Array(originalSize);
  for (let i = 0; i < dataShards; i++) {
    const offset = i * shardSize;
    const copyLen = Math.min(shardSize, originalSize - offset);
    if (copyLen > 0 && recovered[i]) {
      result.set(recovered[i]!.slice(0, copyLen), offset);
    }
  }
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
