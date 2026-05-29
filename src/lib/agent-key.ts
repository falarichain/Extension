import type { LocalAgentKey } from './types';
import { generateAgentKeyPair, encodeAgentKeyString, normalizeAddress } from './crypto';
import { ChainApi } from './api';
import { ethers } from 'ethers';

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
  chainId: string,
  master: string,
  agentPub: string,
  permissions: string[],
  dailyLimit: number,
  totalLimit: number,
  expiresAt: number,
  nonce: number,
  masterPrivateKey: string,
): Promise<string> {
  const wallet = new ethers.Wallet(masterPrivateKey);
  const payload = {
    chain_id: chainId,
    master: normalizeAddress(master),
    agent_pub: agentPub,
    permissions: [...permissions].sort(),
    daily_limit: dailyLimit,
    total_limit: totalLimit,
    expires_at: expiresAt,
    nonce,
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
    const [status, account] = await Promise.all([
      api.getStatus(),
      api.getAccount(key.master),
    ]);
    const chainId = status.chainId || status.chain_id || '';
    const nonce = account.nonce;

    const agentPub = new ethers.Wallet(key.privateKey).signingKey.publicKey;
    const signature = await computeRegisterAgentKeySignature(
      chainId,
      key.master,
      agentPub,
      key.permissions,
      key.dailyLimit,
      key.totalLimit,
      key.expiresAt,
      nonce,
      masterPrivateKey,
    );

    const result = await api.registerAgentKey({
      chainId,
      master: key.master,
      name: key.name,
      agentPub,
      permissions: key.permissions,
      dailyLimit: key.dailyLimit,
      totalLimit: key.totalLimit,
      expiresAt: key.expiresAt,
      nonce,
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
    const [status, account] = await Promise.all([
      api.getStatus(),
      api.getAccount(master),
    ]);
    const chainId = status.chainId || status.chain_id || '';
    const nonce = account.nonce;

    const wallet = new ethers.Wallet(masterPrivateKey);
    const payload = {
      chain_id: chainId,
      key_id: keyId,
      master: normalizeAddress(master),
      nonce,
    };
    const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
    const signature = wallet.signingKey.sign(ethers.getBytes(hash)).serialized;

    await api.revokeAgentKey({
      chainId,
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

export async function extendAgentKey(
  api: ChainApi,
  keyId: string,
  master: string,
  expiresAt: number,
  masterPrivateKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [status, account] = await Promise.all([
      api.getStatus(),
      api.getAccount(master),
    ]);
    const chainId = status.chainId || status.chain_id || '';
    const nonce = account.nonce;

    const wallet = new ethers.Wallet(masterPrivateKey);
    const payload = {
      chain_id: chainId,
      key_id: keyId,
      master: normalizeAddress(master),
      expires_at: expiresAt,
      nonce,
    };
    const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
    const signature = wallet.signingKey.sign(ethers.getBytes(hash)).serialized;

    await api.extendAgentKey({
      chainId,
      keyId,
      master,
      expiresAt,
      nonce,
      signature,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function topupAgentKey(
  api: ChainApi,
  keyId: string,
  master: string,
  totalLimit: number,
  masterPrivateKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [status, account] = await Promise.all([
      api.getStatus(),
      api.getAccount(master),
    ]);
    const chainId = status.chainId || status.chain_id || '';
    const nonce = account.nonce;

    const wallet = new ethers.Wallet(masterPrivateKey);
    const payload = {
      chain_id: chainId,
      key_id: keyId,
      master: normalizeAddress(master),
      total_limit: totalLimit,
      nonce,
    };
    const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
    const signature = wallet.signingKey.sign(ethers.getBytes(hash)).serialized;

    await api.topupAgentKey({
      chainId,
      keyId,
      master,
      totalLimit,
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
  if (!key.privateKey) {
    return { ...key, encodedString: '', hasPrivateKey: false, remoteOnly: true };
  }
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

export async function createCollection(
  api: ChainApi,
  user: string,
  userPrivateKey: string,
  name: string,
  description?: string,
): Promise<{ collectionId: string }> {
  const [status, account] = await Promise.all([
    api.getStatus(),
    api.getAccount(user),
  ]);
  const chainId = (status as any).chainId || (status as any).chain_id || '';
  const nonce = account.nonce;

  const wallet = new ethers.Wallet(userPrivateKey);
  const payload = {
    chain_id: chainId,
    user: normalizeAddress(user),
    name,
    description: description || '',
    metadata: {},
    nonce,
  };
  const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));
  const signature = wallet.signingKey.sign(ethers.getBytes(hash)).serialized;

  const resp = await api.createCollection({
    chainId,
    user,
    name,
    description,
    nonce,
    publicKey: wallet.signingKey.publicKey,
    signature,
  });
  return { collectionId: resp.collection.collection_id };
}
