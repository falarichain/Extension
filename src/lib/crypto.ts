import { ethers } from 'ethers';
import { AGENT_KEY_PREFIX } from './types';

export function importWalletFromMnemonic(mnemonic: string, pathIndex: number = 0): { address: string; publicKey: string; privateKey: string; pathIndex: number } {
  const hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic));
  const derived = hdNode.derivePath(`m/44'/60'/0'/0/${pathIndex}`);
  return {
    address: derived.address,
    publicKey: derived.signingKey.publicKey,
    privateKey: derived.privateKey,
    pathIndex,
  };
}

export function generateWallet(): { address: string; publicKey: string; privateKey: string; mnemonic: string | null } {
  const mnemonic = ethers.Mnemonic.fromEntropy(ethers.randomBytes(16));
  const hdNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/0`);
  return {
    address: hdNode.address,
    publicKey: hdNode.signingKey.publicKey,
    privateKey: hdNode.privateKey,
    mnemonic: mnemonic.phrase,
  };
}

export function deriveAddressFromMnemonic(mnemonic: string, pathIndex: number): { address: string; publicKey: string; privateKey: string } {
  const hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic));
  const derived = hdNode.derivePath(`m/44'/60'/0'/0/${pathIndex}`);
  return {
    address: derived.address,
    publicKey: derived.signingKey.publicKey,
    privateKey: derived.privateKey,
  };
}

export function importWallet(privateKeyHex: string): { address: string; publicKey: string; privateKey: string } {
  const wallet = new ethers.Wallet(privateKeyHex);
  return {
    address: wallet.address,
    publicKey: wallet.signingKey.publicKey,
    privateKey: wallet.privateKey,
  };
}

export async function signMessage(privateKey: string, message: string): Promise<string> {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.signMessage(message);
}

export async function signTransactionHash(privateKey: string, hash: Uint8Array): Promise<string> {
  const signingKey = new ethers.SigningKey(privateKey);
  return signingKey.sign(ethers.hexlify(hash)).serialized;
}

export function accountAddressFromPublicKey(publicKey: string): string {
  return ethers.computeAddress(publicKey);
}

export function encodeAgentKeyString(
  agentKeyId: string,
  master: string,
  address: string,
  privateKeyHex: string,
): string {
  const raw = `${agentKeyId}|${master}|${address}|${privateKeyHex}`;
  const encoder = new TextEncoder();
  const encoded = btoa(String.fromCharCode(...encoder.encode(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return AGENT_KEY_PREFIX + encoded;
}

export function decodeAgentKeyString(encoded: string): {
  agentKeyId: string;
  master: string;
  address: string;
  privateKey: string;
} | null {
  if (!encoded.startsWith(AGENT_KEY_PREFIX)) {
    return null;
  }
  try {
    const stripped = encoded.slice(AGENT_KEY_PREFIX.length);
    const padded = stripped + '=='.slice(0, (4 - (stripped.length % 4)) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    const parts = decoded.split('|');
    if (parts.length !== 4) {
      return null;
    }
    return {
      agentKeyId: parts[0],
      master: parts[1],
      address: parts[2],
      privateKey: parts[3],
    };
  } catch {
    return null;
  }
}

export function generateAgentKeyPair(): { publicKey: string; privateKey: string; address: string } {
  return generateWallet();
}

export function normalizeAddress(address: string): string {
  try {
    return ethers.getAddress(address);
  } catch {
    return address.toLowerCase();
  }
}

export function keccak256(data: Uint8Array): string {
  return ethers.keccak256(data);
}

export function hexToBytes(hex: string): Uint8Array {
  return ethers.getBytes(hex);
}

export function bytesToHex(bytes: Uint8Array): string {
  return ethers.hexlify(bytes);
}

export function encodeHex(data: Uint8Array): string {
  return ethers.hexlify(data);
}

export function decodeHex(hex: string): Uint8Array {
  return ethers.getBytes(hex);
}

export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

export function sha256(data: Uint8Array): string {
  return ethers.sha256(data);
}
