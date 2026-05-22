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

export function encodeShards(
  data: Uint8Array,
  dataShards: number,
  parityShards: number,
): Uint8Array[] {
  const total = dataShards + parityShards;
  const shardSize = Math.ceil(data.length / dataShards);
  const paddedSize = shardSize * dataShards;
  const padded = new Uint8Array(paddedSize);
  padded.set(data);

  const shards: Uint8Array[] = [];
  for (let i = 0; i < dataShards; i++) {
    shards.push(padded.slice(i * shardSize, (i + 1) * shardSize));
  }

  for (let p = 0; p < parityShards; p++) {
    const parity = new Uint8Array(shardSize);
    for (let i = 0; i < shardSize; i++) {
      let sum = 0;
      for (let d = 0; d < dataShards; d++) {
        sum ^= shards[d][i];
      }
      parity[i] = sum;
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
  if (shards.length < dataShards) return null;

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
        let count = 0;
        for (const s of shards) {
          if (s && s.length > j) {
            val ^= s[j];
            count++;
          }
        }
        if (count < dataShards) return null;
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
