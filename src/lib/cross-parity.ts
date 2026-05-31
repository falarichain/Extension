/**
 * Cross-parity encoding for Repair Pools.
 *
 * Pairs two consecutive segments and computes per-shard XOR parity.
 * Repairing a single lost shard requires only 2 downloads (peer +
 * cross-parity) instead of k data shards.
 */

export function computeCrossParityShards(
  shardsA: Uint8Array[],
  shardsB: Uint8Array[],
): Uint8Array[] {
  if (shardsA.length !== shardsB.length) {
    throw new Error('cross-parity: shard count mismatch');
  }
  if (shardsA.length === 0) {
    throw new Error('cross-parity: empty shard slices');
  }
  const cross: Uint8Array[] = [];
  for (let i = 0; i < shardsA.length; i++) {
    const a = shardsA[i];
    const b = shardsB[i];
    const size = Math.max(a.length, b.length);
    const out = new Uint8Array(size);
    for (let j = 0; j < size; j++) {
      out[j] = (j < a.length ? a[j] : 0) ^ (j < b.length ? b[j] : 0);
    }
    cross.push(out);
  }
  return cross;
}

export function repairFromCrossParity(
  peerShard: Uint8Array,
  crossParityShard: Uint8Array,
): Uint8Array {
  if (peerShard.length !== crossParityShard.length) {
    throw new Error('cross-parity repair: shard size mismatch');
  }
  const out = new Uint8Array(peerShard.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = peerShard[i] ^ crossParityShard[i];
  }
  return out;
}
