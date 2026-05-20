import type { LocalAgentKey, WalletAccount } from './types';
import { generateAgentKeyPair, encodeAgentKeyString } from './crypto';
import { ChainApi } from './api';
import { ethers } from 'ethers';

function computeAgentKeyId(master: string, nonce: number): string {
  const payload = JSON.stringify({ master: master.toLowerCase(), nonce });
  const hash = ethers.sha256(ethers.toUtf8Bytes(payload));
  return 'key_' + btoa(hash.slice(2).slice(0, 16))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generateLocalAgentKey(
  master: string,
  masterPrivateKey: string,
  name: string,
  permissions: string[],
  dailyLimit: number,
  totalLimit: number,
  expiresAt: number,
): Promise<LocalAgentKey> {
  const pair = generateAgentKeyPair();
  const encoded = encodeAgentKeyString(
    '',
    master,
    pair.address,
    pair.privateKey,
  );

  return {
    keyId: '',
    name,
    master,
    address: pair.address,
    privateKey: pair.privateKey,
    encodedString: encoded,
    permissions,
    dailyLimit,
    totalLimit,
    expiresAt,
    createdAt: Math.floor(Date.now() / 1000),
    registered: false,
    revoked: false,
  };
}

export async function computeRegisterAgentKeySignature(
  master: string,
  agentPub: string,
  permissions: string[],
  dailyLimit: number,
  totalLimit: number,
  expiresAt: number,
  masterPrivateKey: string,
): Promise<string> {
  const wallet = new ethers.Wallet(masterPrivateKey);
  const payload = {
    master: master.toLowerCase(),
    agent_pub: agentPub,
    permissions,
    daily_limit: dailyLimit,
    total_limit: totalLimit,
    expires_at: expiresAt,
  };
  const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
  return wallet.signingKey.sign(ethers.getBytes(hash)).serialized;
}

export async function registerAgentKey(
  api: ChainApi,
  key: LocalAgentKey,
  masterPrivateKey: string,
): Promise<{ success: boolean; keyId: string; error?: string }> {
  try {
    const agentPub = new ethers.Wallet(key.privateKey).signingKey.publicKey;
    const signature = await computeRegisterAgentKeySignature(
      key.master,
      agentPub,
      key.permissions,
      key.dailyLimit,
      key.totalLimit,
      key.expiresAt,
      masterPrivateKey,
    );

    const result = await api.registerAgentKey({
      master: key.master,
      name: key.name,
      agentPub,
      permissions: key.permissions,
      dailyLimit: key.dailyLimit,
      totalLimit: key.totalLimit,
      expiresAt: key.expiresAt,
      signature,
    });

    return { success: true, keyId: result.key.key_id };
  } catch (err: any) {
    return { success: false, keyId: '', error: err.message || String(err) };
  }
}

export async function revokeAgentKey(
  api: ChainApi,
  keyId: string,
  master: string,
  masterPrivateKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const account = await api.getAccount(master);
    const nonce = account.nonce;

    const wallet = new ethers.Wallet(masterPrivateKey);
    const payload = {
      key_id: keyId,
      master: master.toLowerCase(),
      nonce,
    };
    const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
    const signature = wallet.signingKey.sign(ethers.getBytes(hash)).serialized;

    await api.revokeAgentKey({
      keyId,
      master,
      nonce,
      signature,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export function decodeImportAgentKeyString(encoded: string): LocalAgentKey | null {
  if (!encoded.startsWith('fara_')) {
    return null;
  }
  const stripped = encoded.slice(5);
  const padded = stripped + '=='.slice(0, (4 - (stripped.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64);
  const parts = decoded.split('|');
  if (parts.length !== 4) {
    return null;
  }

  return {
    keyId: parts[0],
    name: parts[0] || 'Imported Key',
    master: parts[1],
    address: parts[2],
    privateKey: parts[3],
    encodedString: encoded,
    permissions: [],
    dailyLimit: 0,
    totalLimit: 0,
    expiresAt: 0,
    createdAt: Math.floor(Date.now() / 1000),
    registered: true,
    revoked: false,
  };
}

export function updateAgentKeyEncodedString(key: LocalAgentKey): LocalAgentKey {
  const encoded = encodeAgentKeyString(
    key.keyId,
    key.master,
    key.address,
    key.privateKey,
  );
  return { ...key, encodedString: encoded };
}

export async function signQueryPayload(
  agentPrivateKey: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const wallet = new ethers.Wallet(agentPrivateKey);
  const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
  return wallet.signingKey.sign(ethers.getBytes(hash)).serialized;
}
