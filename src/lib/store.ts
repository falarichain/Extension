import { create } from 'zustand';
import type { WalletAccount, LocalAgentKey, ChainNodeConfig, WalletGroup, MultisigWalletInfo, MultisigProposal, MultisigSignature } from './types';

const STORAGE_KEY = 'falari_wallet_state';
const VAULT_PARAMS_KEY = 'falari_vault_params';
const SESSION_KEY = 'falari_unlocked';

const PBKDF2_ITERATIONS = 310_000;
const SALT_LENGTH = 16;
const ENCRYPTED_PREFIX = 'v1:';

export function generateId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `wallet_${Date.now()}_${hex}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveVaultKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function vaultEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, new TextEncoder().encode(plaintext)),
  );
  return ENCRYPTED_PREFIX + bytesToHex(iv) + bytesToHex(encrypted);
}

async function vaultDecrypt(key: CryptoKey, ciphertext: string): Promise<string> {
  const raw = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const iv = hexToBytes(raw.slice(0, 24));
  const data = hexToBytes(raw.slice(24));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(data));
  return new TextDecoder().decode(decrypted);
}

async function encryptAgentKeys(keys: LocalAgentKey[], key: CryptoKey): Promise<LocalAgentKey[]> {
  return Promise.all(keys.map(async (k) => ({
    ...k,
    privateKey: k.privateKey ? await vaultEncrypt(key, k.privateKey) : k.privateKey,
    encodedString: k.encodedString ? await vaultEncrypt(key, k.encodedString) : k.encodedString,
  })));
}

async function decryptAgentKeys(keys: LocalAgentKey[], key: CryptoKey): Promise<LocalAgentKey[]> {
  return Promise.all(keys.map(async (k) => ({
    ...k,
    privateKey: k.privateKey ? await vaultDecrypt(key, k.privateKey) : k.privateKey,
    encodedString: k.encodedString ? await vaultDecrypt(key, k.encodedString) : k.encodedString,
  })));
}

// Module-level vault key, held in memory only while unlocked.
let _vaultKey: CryptoKey | null = null;

interface AppStore {
  accounts: WalletAccount[];
  selectedAccount: string | null;
  wallets: WalletGroup[];
  agentKeys: LocalAgentKey[];
  multisigWallets: MultisigWalletInfo[];
  multisigProposals: MultisigProposal[];
  chainNode: ChainNodeConfig;
  isLocked: boolean;
  stateLoaded: boolean;

  setAccounts: (accounts: WalletAccount[]) => void;
  setSelectedAccount: (address: string | null) => void;
  addAccount: (account: WalletAccount) => void;
  removeAccount: (address: string) => void;
  setAgentKeys: (keys: LocalAgentKey[]) => void;
  addAgentKey: (key: LocalAgentKey) => void;
  updateAgentKey: (keyId: string, update: Partial<LocalAgentKey>) => void;
  removeAgentKey: (keyId: string) => void;
  setChainNode: (node: ChainNodeConfig) => void;
  setLocked: (locked: boolean) => void;
  loadState: () => Promise<void>;
  saveState: () => Promise<void>;

  addWallet: (wallet: WalletGroup) => void;
  removeWallet: (walletId: string) => void;
  renameWallet: (walletId: string, name: string) => void;
  renameAccount: (address: string, label: string) => void;

  hasPassword: () => Promise<boolean>;
  setPassword: (password: string) => Promise<void>;
  verifyPassword: (password: string) => Promise<boolean>;
  checkSessionUnlocked: () => Promise<boolean>;
  markUnlocked: () => Promise<void>;
  clearSession: () => Promise<void>;

  addMultisigWallet: (wallet: MultisigWalletInfo) => void;
  removeMultisigWallet: (address: string) => void;
  addMultisigProposal: (proposal: MultisigProposal) => void;
  addSignatureToProposal: (proposalId: string, signature: MultisigSignature) => void;
  markProposalExecuted: (proposalId: string) => void;
  getPrivateKey: (address: string) => Promise<string>;
  storePrivateKey: (address: string, privateKey: string) => Promise<void>;
  getMnemonic: (walletId: string) => Promise<string | null>;
  storeMnemonic: (walletId: string, mnemonic: string) => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  accounts: [],
  selectedAccount: null,
  wallets: [],
  agentKeys: [],
  multisigWallets: [],
  multisigProposals: [],
  chainNode: {
    url: 'http://localhost:8080',
    label: 'Local Devnet',
  },
  isLocked: true,
  stateLoaded: false,

  setAccounts: (accounts) => set({ accounts }),
  setSelectedAccount: (address) => set({ selectedAccount: address }),
  addAccount: (account) => set((s) => ({ accounts: [...s.accounts, account] })),
  removeAccount: (address) =>
    set((s) => {
      const accounts = s.accounts.filter((a) => a.address !== address);
      return {
        accounts,
        selectedAccount: s.selectedAccount === address
          ? accounts[0]?.address ?? null
          : s.selectedAccount,
      };
    }),
  removeWallet: (walletId) =>
    set((s) => {
      const removedSelected = s.accounts.some(
        (a) => a.walletId === walletId && a.address === s.selectedAccount,
      );
      const accounts = s.accounts.filter((a) => a.walletId !== walletId);
      return {
        wallets: s.wallets.filter((w) => w.id !== walletId),
        accounts,
        selectedAccount: removedSelected ? accounts[0]?.address ?? null : s.selectedAccount,
      };
    }),
  addWallet: (wallet) => set((s) => ({ wallets: [...s.wallets, wallet] })),
  renameWallet: (walletId, name) =>
    set((s) => ({
      wallets: s.wallets.map((w) => (w.id === walletId ? { ...w, name } : w)),
    })),
  renameAccount: (address, label) =>
    set((s) => ({
      accounts: s.accounts.map((a) => (a.address === address ? { ...a, label } : a)),
    })),

  setAgentKeys: (agentKeys) => set({ agentKeys }),
  addAgentKey: (key) => set((s) => ({ agentKeys: [...s.agentKeys, key] })),
  updateAgentKey: (keyId, update) =>
    set((s) => ({
      agentKeys: s.agentKeys.map((k) =>
        k.keyId === keyId ? { ...k, ...update } : k,
      ),
    })),
  removeAgentKey: (keyId) =>
    set((s) => ({
      agentKeys: s.agentKeys.filter((k) => k.keyId !== keyId),
    })),

  addMultisigWallet: (wallet) =>
    set((s) => ({ multisigWallets: [...s.multisigWallets, wallet] })),
  removeMultisigWallet: (address) =>
    set((s) => ({
      multisigWallets: s.multisigWallets.filter((w) => w.wallet.address !== address),
      multisigProposals: s.multisigProposals.filter((p) => p.wallet !== address),
    })),
  addMultisigProposal: (proposal) =>
    set((s) => ({ multisigProposals: [...s.multisigProposals, proposal] })),
  addSignatureToProposal: (proposalId, signature) =>
    set((s) => ({
      multisigProposals: s.multisigProposals.map((p) =>
        p.id === proposalId
          ? { ...p, signatures: [...p.signatures.filter((sig) => sig.signer !== signature.signer), signature] }
          : p,
      ),
    })),
  markProposalExecuted: (proposalId) =>
    set((s) => ({
      multisigProposals: s.multisigProposals.map((p) =>
        p.id === proposalId ? { ...p, status: 'executed' as const } : p,
      ),
    })),

  setChainNode: (node) => set({ chainNode: node }),
  setLocked: (locked) => {
    if (locked) _vaultKey = null;
    set({ isLocked: locked });
  },

  loadState: async () => {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const state = result[STORAGE_KEY];
      if (state) {
        const accounts = (state.accounts || []) as WalletAccount[];
        const wallets = (state.wallets || []) as WalletGroup[];
        const upgraded = accounts.map((a) => ({
          ...a,
          walletId: a.walletId || 'wallet_legacy',
          pathIndex: a.pathIndex ?? 0,
        }));
        const rawAgentKeys = (state.agentKeys || []) as LocalAgentKey[];
        // Decrypt agent key secrets if vault key is already available (e.g. session restore)
        const agentKeys = _vaultKey ? await decryptAgentKeys(rawAgentKeys, _vaultKey) : rawAgentKeys;
        const multisigWallets = (state.multisigWallets || []) as MultisigWalletInfo[];
        const multisigProposals = (state.multisigProposals || []) as MultisigProposal[];
        set({
          accounts: upgraded,
          selectedAccount: state.selectedAccount || null,
          wallets,
          agentKeys,
          multisigWallets,
          multisigProposals,
          chainNode: state.chainNode || { url: 'http://localhost:8080', label: 'Local Devnet' },
          isLocked: true,
        });
      }
    } catch (err) {
      console.error('Failed to load wallet state:', err);
    } finally {
      set({ stateLoaded: true });
    }
  },

  saveState: async () => {
    try {
      const agentKeys = _vaultKey
        ? await encryptAgentKeys(get().agentKeys, _vaultKey)
        : get().agentKeys;
      const state = {
        accounts: get().accounts,
        selectedAccount: get().selectedAccount,
        wallets: get().wallets,
        agentKeys,
        multisigWallets: get().multisigWallets,
        multisigProposals: get().multisigProposals,
        chainNode: get().chainNode,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (err) {
      console.error('Failed to save wallet state:', err);
    }
  },

  hasPassword: async () => {
    try {
      const result = await chrome.storage.local.get(VAULT_PARAMS_KEY);
      return !!result[VAULT_PARAMS_KEY];
    } catch {
      return false;
    }
  },

  setPassword: async (password: string) => {
    const salt = new Uint8Array(SALT_LENGTH);
    crypto.getRandomValues(salt);
    const key = await deriveVaultKey(password, salt, PBKDF2_ITERATIONS);
    const verifier = await vaultEncrypt(key, 'falari-vault-v1');
    await chrome.storage.local.set({
      [VAULT_PARAMS_KEY]: {
        salt: bytesToHex(salt),
        iterations: PBKDF2_ITERATIONS,
        verifier,
      },
    });
    _vaultKey = key;
    set({ isLocked: false });
  },

  verifyPassword: async (password: string) => {
    try {
      const result = await chrome.storage.local.get(VAULT_PARAMS_KEY);
      const params = result[VAULT_PARAMS_KEY];
      if (!params) return true;
      const key = await deriveVaultKey(password, hexToBytes(params.salt), params.iterations);
      const decrypted = await vaultDecrypt(key, params.verifier);
      if (decrypted === 'falari-vault-v1') {
        _vaultKey = key;
        const currentKeys = get().agentKeys;
        const unlocked = currentKeys.length > 0
          ? await decryptAgentKeys(currentKeys, key)
          : currentKeys;
        set({ agentKeys: unlocked, isLocked: false });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  checkSessionUnlocked: async () => {
    try {
      const result = await chrome.storage.session.get(SESSION_KEY);
      return !!result[SESSION_KEY];
    } catch {
      return false;
    }
  },

  markUnlocked: async () => {
    try {
      // Only store a session-unlock timestamp — NEVER export the vault key.
      // The CryptoKey stays in module-level memory (_vaultKey) only.
      await chrome.storage.session.set({ [SESSION_KEY]: Date.now() });
      set({ isLocked: false });
    } catch {}
  },

  clearSession: async () => {
    _vaultKey = null;
    try {
      await chrome.storage.session.remove([SESSION_KEY]);
      set({ isLocked: true });
    } catch {}
  },

  getPrivateKey: async (address: string) => {
    if (!_vaultKey) return '';
    const result = await chrome.storage.local.get(`pk_${address}`);
    const stored = result[`pk_${address}`];
    if (!stored) return '';
    try {
      return await vaultDecrypt(_vaultKey, stored);
    } catch {
      return '';
    }
  },

  storePrivateKey: async (address: string, privateKey: string) => {
    if (!_vaultKey) return;
    const encrypted = await vaultEncrypt(_vaultKey, privateKey);
    await chrome.storage.local.set({ [`pk_${address}`]: encrypted });
  },

  getMnemonic: async (walletId: string) => {
    if (!_vaultKey) return null;
    const result = await chrome.storage.local.get(`mnemonic_${walletId}`);
    const stored = result[`mnemonic_${walletId}`];
    if (!stored) return null;
    try {
      return await vaultDecrypt(_vaultKey, stored);
    } catch {
      return null;
    }
  },

  storeMnemonic: async (walletId: string, mnemonic: string) => {
    if (!_vaultKey) return;
    const encrypted = await vaultEncrypt(_vaultKey, mnemonic);
    await chrome.storage.local.set({ [`mnemonic_${walletId}`]: encrypted });
  },
}));
