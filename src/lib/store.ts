import { create } from 'zustand';
import type { WalletAccount, LocalAgentKey, ChainNodeConfig, WalletGroup } from './types';

const STORAGE_KEY = 'falari_wallet_state';
const PASSWORD_KEY = 'falari_password_hash';
const SESSION_KEY = 'falari_unlocked';

function generateId(): string {
  return `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function sha256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface AppStore {
  accounts: WalletAccount[];
  selectedAccount: string | null;
  wallets: WalletGroup[];
  agentKeys: LocalAgentKey[];
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

  hasPassword: () => Promise<boolean>;
  setPassword: (password: string) => Promise<void>;
  verifyPassword: (password: string) => Promise<boolean>;
  checkSessionUnlocked: () => Promise<boolean>;
  markUnlocked: () => Promise<void>;
  clearSession: () => Promise<void>;

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

  setChainNode: (node) => set({ chainNode: node }),
  setLocked: (locked) => set({ isLocked: locked }),

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
        set({
          accounts: upgraded,
          selectedAccount: state.selectedAccount || null,
          wallets,
          agentKeys: state.agentKeys || [],
          chainNode: state.chainNode || { url: 'http://localhost:8080', label: 'Local Devnet' },
          isLocked: true,
          stateLoaded: true,
        });
      }
    } catch (err) {
      console.error('Failed to load wallet state:', err);
      set({ stateLoaded: true });
    }
  },

  saveState: async () => {
    try {
      const state = {
        accounts: get().accounts,
        selectedAccount: get().selectedAccount,
        wallets: get().wallets,
        agentKeys: get().agentKeys,
        chainNode: get().chainNode,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (err) {
      console.error('Failed to save wallet state:', err);
    }
  },

  hasPassword: async () => {
    try {
      const result = await chrome.storage.local.get(PASSWORD_KEY);
      return !!result[PASSWORD_KEY];
    } catch {
      return false;
    }
  },

  setPassword: async (password: string) => {
    const hash = await sha256Hash(password);
    await chrome.storage.local.set({ [PASSWORD_KEY]: hash });
    set({ isLocked: false });
  },

  verifyPassword: async (password: string) => {
    try {
      const result = await chrome.storage.local.get(PASSWORD_KEY);
      const storedHash = result[PASSWORD_KEY];
      if (!storedHash) return true;
      const inputHash = await sha256Hash(password);
      return inputHash === storedHash;
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
      await chrome.storage.session.set({ [SESSION_KEY]: Date.now() });
      set({ isLocked: false });
    } catch {}
  },

  clearSession: async () => {
    try {
      await chrome.storage.session.remove(SESSION_KEY);
      set({ isLocked: true });
    } catch {}
  },

  getPrivateKey: async (address: string) => {
    const result = await chrome.storage.local.get(`pk_${address}`);
    return result[`pk_${address}`] || '';
  },

  storePrivateKey: async (address: string, privateKey: string) => {
    await chrome.storage.local.set({ [`pk_${address}`]: privateKey });
  },

  getMnemonic: async (walletId: string) => {
    const result = await chrome.storage.local.get(`mnemonic_${walletId}`);
    return result[`mnemonic_${walletId}`] || null;
  },

  storeMnemonic: async (walletId: string, mnemonic: string) => {
    await chrome.storage.local.set({ [`mnemonic_${walletId}`]: mnemonic });
  },
}));
