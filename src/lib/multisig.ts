import { ethers } from 'ethers';
import { normalizeAddress, keccak256, signTransactionHash, encodeHex, decodeHex } from './crypto';
import type { MultisigExecRequest, MultisigSignature } from './types';
import { MULTISIG_PROPOSAL_PREFIX } from './types';

const MULTISIG_VERSION_BYTE = 0x01;

/**
 * Compute the deterministic address for a multisig wallet.
 * Must match the Go implementation in wire/multisig.go.
 */
export function computeMultisigAddress(signers: string[], threshold: number, salt: number): string {
  const sorted = signers.map(normalizeAddress).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Build buffer: version_byte || addr_1 (20 bytes) || addr_2 (20 bytes) || ... || threshold (1 byte) || salt (8 bytes big-endian)
  const parts: number[] = [MULTISIG_VERSION_BYTE];
  for (const addr of sorted) {
    const bytes = decodeHex(addr);
    for (let i = 0; i < bytes.length; i++) {
      parts.push(bytes[i]);
    }
  }
  parts.push(threshold & 0xff);
  // Salt as 8 bytes big-endian
  for (let i = 7; i >= 0; i--) {
    parts.push((salt >>> (i * 8)) & 0xff);
  }

  const buf = new Uint8Array(parts);
  const hash = decodeHex(keccak256(buf));
  // Take last 20 bytes and apply EIP-55 checksum
  const addrBytes = hash.slice(hash.length - 20);
  return ethers.getAddress(encodeHex(addrBytes));
}

/**
 * Validate a list of signers: 2-16, all valid hex addresses, no duplicates, sorted.
 */
export function validateMultisigSigners(signers: string[]): string | null {
  if (signers.length < 2) return 'At least 2 signers are required';
  if (signers.length > 16) return 'At most 16 signers are supported';

  const seen = new Set<string>();
  let prev = '';
  for (let i = 0; i < signers.length; i++) {
    let norm: string;
    try {
      norm = normalizeAddress(signers[i]);
    } catch {
      return `Signer ${i + 1} is not a valid address`;
    }
    const lower = norm.toLowerCase();
    if (seen.has(lower)) return `Duplicate signer: ${signers[i]}`;
    seen.add(lower);
    if (i > 0 && prev.localeCompare(lower) >= 0) {
      return 'Signers must be sorted by address (ascending)';
    }
    prev = lower;
  }
  return null;
}

/**
 * Compute the signing hash for a multisig execution request.
 * Must match the Go implementation in wire/multisig.go MultisigExecHash.
 */
export function multisigExecHash(req: MultisigExecRequest): Uint8Array {
  const innerJson = JSON.stringify(req.payload);
  const innerBytes = new TextEncoder().encode(innerJson);
  const innerHash = keccak256(innerBytes);

  const signingPayload = {
    wallet: normalizeAddress(req.wallet),
    operation: req.operation,
    payload_hash: innerHash,
    nonce: req.nonce,
    fee: req.fee,
  };

  const canonicalJson = JSON.stringify(signingPayload);
  const canonicalBytes = new TextEncoder().encode(canonicalJson);
  return decodeHex(keccak256(canonicalBytes));
}

/**
 * Compute the signing hash for a multisig creation request.
 * Must match the Go implementation in wire/multisig.go MultisigCreateHash.
 */
export function multisigCreateHash(signers: string[], threshold: number, salt: number): Uint8Array {
  const sorted = signers.map(normalizeAddress).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const payload = {
    signers: sorted,
    threshold,
    salt,
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return decodeHex(keccak256(bytes));
}

/**
 * Sign a multisig creation request with the given private key.
 */
export async function signMultisigCreate(
  signers: string[],
  threshold: number,
  salt: number,
  privateKey: string,
): Promise<string> {
  const hash = multisigCreateHash(signers, threshold, salt);
  return signTransactionHash(privateKey, hash);
}

/**
 * Sign a multisig execution request and return the signature.
 */
export async function signMultisigExec(
  req: MultisigExecRequest,
  signer: string,
  privateKey: string,
): Promise<MultisigSignature> {
  const hash = multisigExecHash(req);
  const signature = await signTransactionHash(privateKey, hash);
  return { signer: normalizeAddress(signer), signature };
}

/**
 * Build a multisig execution request for a transfer.
 */
export function buildMultisigTransferRequest(
  wallet: string,
  to: string,
  amount: number,
  nonce: number,
  fee: number,
): MultisigExecRequest {
  return {
    wallet: normalizeAddress(wallet),
    operation: 'transfer',
    payload: { to: normalizeAddress(to), amount },
    nonce,
    fee,
    signatures: [],
  };
}

/**
 * Encode a multisig proposal as a shareable string.
 */
export function encodeMultisigProposal(req: MultisigExecRequest): string {
  const json = JSON.stringify(req);
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return MULTISIG_PROPOSAL_PREFIX + encoded;
}

/**
 * Decode a multisig proposal from a shareable string.
 */
export function decodeMultisigProposal(encoded: string): MultisigExecRequest | null {
  if (!encoded.startsWith(MULTISIG_PROPOSAL_PREFIX)) return null;
  try {
    const stripped = encoded.slice(MULTISIG_PROPOSAL_PREFIX.length);
    const padded = stripped + '=='.slice(0, (4 - (stripped.length % 4)) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    return JSON.parse(decoded) as MultisigExecRequest;
  } catch {
    return null;
  }
}

/**
 * Sort signatures by signer address (ascending, case-insensitive).
 */
export function sortSignatures(sigs: MultisigSignature[]): MultisigSignature[] {
  return [...sigs].sort((a, b) => a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()));
}
