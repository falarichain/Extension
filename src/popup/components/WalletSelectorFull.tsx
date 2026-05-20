import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { ChainApi } from '@/lib/api';
import {
  generateWallet,
  importWallet,
  importWalletFromMnemonic,
  deriveAddressFromMnemonic,
  normalizeAddress,
} from '@/lib/crypto';
import { useI18n } from '@/lib/i18n';
import type { WalletGroup, WalletAccount } from '@/lib/types';
import { X, Plus, Download, Copy, Check, Trash2, Wallet, ChevronRight, ChevronDown, Eye, EyeOff, Key, Shield, AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  api: ChainApi;
}

function generateId(): string {
  return `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletSelectorFull({ open, onClose, api }: Props) {
  const { t } = useI18n();
  const accounts = useAppStore((s) => s.accounts);
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const wallets = useAppStore((s) => s.wallets);
  const addAccount = useAppStore((s) => s.addAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const addWallet = useAppStore((s) => s.addWallet);
  const removeWallet = useAppStore((s) => s.removeWallet);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const storePrivateKey = useAppStore((s) => s.storePrivateKey);
  const storeMnemonic = useAppStore((s) => s.storeMnemonic);
  const getMnemonic = useAppStore((s) => s.getMnemonic);
  const saveState = useAppStore((s) => s.saveState);

  const [balances, setBalances] = useState<Record<string, number>>({});
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null);
  const [confirmDeleteWallet, setConfirmDeleteWallet] = useState<string | null>(null);
  const [confirmDeleteAddr, setConfirmDeleteAddr] = useState<string | null>(null);

  const [mode, setMode] = useState<'list' | 'create' | 'import'>('list');
  const [importTab, setImportTab] = useState<'pk' | 'mnemonic'>('pk');
  const [importPk, setImportPk] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importMnemonicStr, setImportMnemonicStr] = useState('');
  const [importError, setImportError] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [createStep, setCreateStep] = useState<'mnemonic' | 'verify'>('mnemonic');
  const [newMnemonic, setNewMnemonic] = useState('');
  const [newWalletData, setNewWalletData] = useState<{ address: string; privateKey: string } | null>(null);
  const [mnemonicRevealed, setMnemonicRevealed] = useState(false);
  const [blankIndices, setBlankIndices] = useState<number[]>([]);
  const [verifyValues, setVerifyValues] = useState<Record<number, string>>({});
  const [verifyError, setVerifyError] = useState('');

  useEffect(() => {
    if (!open) return;
    const fetchBalances = async () => {
      for (const acc of accounts) {
        try {
          const result = await api.getBalance(acc.address);
          setBalances((p) => ({ ...p, [acc.address]: result.balance }));
        } catch {}
      }
    };
    fetchBalances();
    setExpandedWallet(accounts.find((a) => a.address === selectedAccount)?.walletId || null);
  }, [open, accounts, api, selectedAccount]);

  const displayBal = (address: string) => {
    const b = balances[address];
    if (b === undefined) return '--';
    if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)}M`;
    if (b >= 1_000) return `${(b / 1_000).toFixed(2)}K`;
    return b.toFixed(4);
  };

  const handleSelectAccount = useCallback((address: string) => {
    setSelectedAccount(address);
    onClose();
  }, [setSelectedAccount, onClose]);

  const handleCreateAddress = useCallback(async (walletId: string) => {
    console.log('handleCreateAddress called for walletId:', walletId);
    const mnemonic = await getMnemonic(walletId);
    if (!mnemonic) {
      return;
    }
    const wallet = wallets.find((w) => w.id === walletId);
    const walletAccounts = accounts.filter((a) => a.walletId === walletId);
    const pathIndex = walletAccounts.length > 0
      ? Math.max(...walletAccounts.map((a) => a.pathIndex)) + 1
      : 0;

    try {
      const derived = deriveAddressFromMnemonic(mnemonic, pathIndex);
      await storePrivateKey(derived.address, derived.privateKey);
      const newAccount: WalletAccount = {
        address: derived.address,
        publicKey: derived.publicKey,
        walletId,
        pathIndex,
        label: `${wallet?.name || 'Wallet'} #${pathIndex + 1}`,
        createdAt: Date.now(),
      };
      addAccount(newAccount);
      setSelectedAccount(derived.address);
      await saveState();
      onClose();
    } catch (err) {
      console.error('Failed to create address:', err);
    }
  }, [accounts, wallets, getMnemonic, storePrivateKey, addAccount, setSelectedAccount, saveState, onClose]);

  const handleDeleteAddress = useCallback(async (address: string) => {
    removeAccount(address);
    await saveState();
    setConfirmDeleteAddr(null);
  }, [removeAccount, saveState]);

  const handleDeleteWallet = useCallback(async (walletId: string) => {
    removeWallet(walletId);
    await saveState();
    setConfirmDeleteWallet(null);
  }, [removeWallet, saveState]);

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = address;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    }
  }, []);

  const handleCreateWallet = () => {
    const wallet = generateWallet();
    setNewMnemonic(wallet.mnemonic || '');
    setNewWalletData({ address: wallet.address, privateKey: wallet.privateKey });
    setMnemonicRevealed(false);
    setCreateStep('mnemonic');
    setMode('create');
  };

  const handleGoVerify = () => {
    if (!newMnemonic) return;
    const words = newMnemonic.split(' ');
    const indices = new Set<number>();
    while (indices.size < 2) {
      indices.add(Math.floor(Math.random() * words.length));
    }
    setBlankIndices(Array.from(indices).sort((a, b) => a - b));
    setVerifyValues({});
    setVerifyError('');
    setCreateStep('verify');
  };

  const handleCompleteCreate = async () => {
    if (!newWalletData || !newMnemonic) return;
    const words = newMnemonic.trim().toLowerCase().split(' ');
    for (const idx of blankIndices) {
      if ((verifyValues[idx] || '').trim().toLowerCase() !== words[idx]) {
        setVerifyError(t.welcome.verifyMismatch);
        return;
      }
    }
    const walletId = generateId();
    await storePrivateKey(newWalletData.address, newWalletData.privateKey);
    await storeMnemonic(walletId, newMnemonic);
    const walletGroup = { id: walletId, name: `Wallet ${wallets.length + 1}`, createdAt: Date.now() };
    addWallet(walletGroup);
    const account = {
      address: newWalletData.address,
      publicKey: '',
      walletId,
      pathIndex: 0,
      label: `Wallet ${wallets.length + 1} #1`,
      createdAt: Date.now(),
    };
    addAccount(account);
    setSelectedAccount(newWalletData.address);
    await saveState();
    setMode('list');
    setNewMnemonic('');
    setNewWalletData(null);
    onClose();
  };

  const handleImportAccount = useCallback(async () => {
    setImportError('');
    try {
      const wallet = importWallet(importPk.trim());
      const exists = accounts.some(
        (a) => normalizeAddress(a.address) === normalizeAddress(wallet.address),
      );
      if (exists) { setImportError(t.wallet.alreadyImported); return; }
      const walletId = generateId();
      await storePrivateKey(wallet.address, wallet.privateKey);
      const walletGroup = { id: walletId, name: importLabel.trim() || t.welcome.importedWallet, createdAt: Date.now() };
      addWallet(walletGroup);
      const account = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        walletId,
        pathIndex: 0,
        label: importLabel.trim() || t.welcome.importedWallet,
        createdAt: Date.now(),
      };
      addAccount(account);
      setSelectedAccount(wallet.address);
      await saveState();
      setImportPk(''); setImportLabel(''); setMode('list');
      onClose();
    } catch { setImportError(t.wallet.invalidPk); }
  }, [importPk, importLabel, accounts, addAccount, addWallet, storePrivateKey, saveState, setSelectedAccount, onClose, t]);

  const handleImportMnemonic = useCallback(async () => {
    setImportError('');
    try {
      const wallet = importWalletFromMnemonic(importMnemonicStr.trim(), 0);
      const walletId = generateId();
      await storePrivateKey(wallet.address, wallet.privateKey);
      await storeMnemonic(walletId, importMnemonicStr.trim());
      const walletGroup = { id: walletId, name: t.welcome.importedWallet, createdAt: Date.now() };
      addWallet(walletGroup);
      const account = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        walletId,
        pathIndex: 0,
        label: `${t.welcome.importedWallet} #1`,
        createdAt: Date.now(),
      };
      addAccount(account);
      setSelectedAccount(wallet.address);
      await saveState();
      setImportMnemonicStr(''); setMode('list');
      onClose();
    } catch { setImportError(t.welcome.invalidMnemonic); }
  }, [importMnemonicStr, accounts, addAccount, addWallet, storePrivateKey, storeMnemonic, saveState, setSelectedAccount, onClose, t]);

  if (!open) return null;

  const grouped = new Map<string, { wallet: WalletGroup; addrs: WalletAccount[] }>();
  for (const w of wallets) {
    const addrs = accounts.filter((a) => a.walletId === w.id);
    grouped.set(w.id, { wallet: w, addrs });
  }
  const ungrouped = accounts.filter((a) => !wallets.some((w) => w.id === a.walletId));

  return (
    <div className="absolute inset-0 z-50 bg-[var(--c-bg)] flex flex-col">
      <header className="h-14 px-4 flex items-center justify-between border-b border-[var(--c-border)] shrink-0">
        <h2 className="text-sm font-bold text-[var(--c-text)]">{t.wallet.manageWallets}</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--c-surface)] border border-[var(--c-border)] flex items-center justify-center hover:bg-[var(--c-surface-hover)]">
          <X className="w-4 h-4 text-[var(--c-text)]" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {mode === 'list' && (
          <>
            {grouped.size === 0 && ungrouped.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <Wallet className="w-12 h-12 text-[var(--c-text-dimmer)]" />
                <p className="text-[13px] font-semibold text-[var(--c-text)]">{t.wallet.noWallets}</p>
                <p className="text-[11px] text-[var(--c-text-dim)] text-center">{t.wallet.noWalletsHint}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={handleCreateWallet} className="btn-primary flex items-center gap-1.5 py-2 px-4 text-[12px]">
                    <Plus className="w-3.5 h-3.5" />{t.wallet.createWalletBtn}
                  </button>
                  <button onClick={() => setMode('import')} className="btn-secondary flex items-center gap-1.5 py-2 px-4 text-[12px]">
                    <Download className="w-3.5 h-3.5" />{t.wallet.importWalletBtn}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {Array.from(grouped.entries()).map(([walletId, { wallet: w, addrs }]) => {
                  const expanded = expandedWallet === walletId;
                  const isDeleting = confirmDeleteWallet === walletId;
                  return (
                    <div key={walletId} className="glass-card overflow-hidden">
                      <div
                        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-[var(--c-surface-hover)]"
                        onClick={() => setExpandedWallet(expanded ? null : walletId)}
                      >
                        {expanded ? <ChevronDown className="w-4 h-4 text-[var(--c-text-dim)]" /> : <ChevronRight className="w-4 h-4 text-[var(--c-text-dim)]" />}
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center">
                          <Wallet className="w-4 h-4 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--c-text)]">{w.name}</p>
                          <p className="text-[11px] text-[var(--c-text-dim)]">{addrs.length} {addrs.length === 1 ? 'address' : 'addresses'}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {isDeleting ? (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteWallet(walletId); }} className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400">Confirm</button>
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteWallet(null); }} className="px-2 py-1 rounded text-[10px] text-[var(--c-text-dim)]">Cancel</button>
                            </>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteWallet(walletId); }} className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-500/10 text-[var(--c-text-dimmer)] hover:text-red-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {expanded && (
                        <div className="border-t border-[var(--c-border)]">
                          {addrs.map((account) => {
                            const isSelected = selectedAccount === account.address;
                            const isDeletingAddr = confirmDeleteAddr === account.address;
                            return (
                              <div key={account.address} className="flex flex-col border-b border-[var(--c-border)] last:border-b-0">
                                <div
                                  className={`flex items-center gap-2 p-2.5 pl-8 cursor-pointer hover:bg-[var(--c-surface-hover)] ${isSelected ? 'bg-blue-500/10' : ''}`}
                                  onClick={() => handleSelectAccount(account.address)}
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium text-[var(--c-text)] truncate">{account.label}</p>
                                    <p className="text-[10px] text-[var(--c-text-dimmer)] truncate">{truncateAddress(account.address)}</p>
                                  </div>
                                  <span className="text-[10px] text-[var(--c-text-dim)] tabular-nums">{displayBal(account.address)} FAI</span>
                                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                                </div>
                                {isSelected && (
                                  <div className="flex items-center gap-1 px-2 pb-2 pl-8">
                                    <button onClick={(e) => { e.stopPropagation(); handleCopyAddress(account.address); }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--c-text-dim)] hover:text-[var(--c-text)] hover:bg-[var(--c-surface-hover)]">
                                      {copiedAddress === account.address ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                                      {copiedAddress === account.address ? t.dashboard.copied : t.dashboard.copyAddress}
                                    </button>
                                    {isDeletingAddr ? (
                                      <div className="flex gap-1 ml-auto">
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteAddress(account.address); }} className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400">Confirm</button>
                                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteAddr(null); }} className="px-2 py-1 rounded text-[10px] text-[var(--c-text-dim)]">Cancel</button>
                                      </div>
                                    ) : (
                                      addrs.length > 1 && (
                                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteAddr(account.address); }} className="ml-auto px-1.5 py-1 rounded text-[10px] text-[var(--c-text-dimmer)] hover:text-red-400 hover:bg-red-500/10">
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <button
                            onClick={() => handleCreateAddress(walletId)}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-[var(--c-text-dim)] hover:text-[var(--c-text)] hover:bg-[var(--c-surface-hover)] transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {t.wallet.createAddressBtn}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {ungrouped.length > 0 && (() => {
                  const legacyGroups = new Map<string, WalletAccount[]>();
                  for (const a of ungrouped) {
                    const list = legacyGroups.get(a.walletId) || [];
                    list.push(a);
                    legacyGroups.set(a.walletId, list);
                  }
                  return Array.from(legacyGroups.entries()).map(([wid, addrs]) => (
                    <div key={wid} className="glass-card overflow-hidden">
                      <div className="flex items-center gap-2 p-3">
                        <Wallet className="w-4 h-4 text-[var(--c-text-dimmer)]" />
                        <span className="text-[13px] font-semibold text-[var(--c-text)]">Legacy Accounts</span>
                      </div>
                      {addrs.map((account) => (
                        <div key={account.address} className="border-t border-[var(--c-border)] p-2.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--c-surface-hover)]" onClick={() => handleSelectAccount(account.address)}>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-[var(--c-text)] truncate">{account.label}</p>
                            <p className="text-[11px] text-[var(--c-text-dimmer)] truncate">{truncateAddress(account.address)}</p>
                          </div>
                          <span className="text-[11px] text-[var(--c-text-dim)]">{displayBal(account.address)} FAI</span>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={handleCreateWallet} className="flex-1 btn-secondary flex items-center justify-center gap-1.5 py-2.5 text-[12px]">
                <Plus className="w-3.5 h-3.5" />{t.wallet.createWalletBtn}
              </button>
              <button onClick={() => setMode('import')} className="flex-1 btn-secondary flex items-center justify-center gap-1.5 py-2.5 text-[12px]">
                <Download className="w-3.5 h-3.5" />{t.wallet.importWalletBtn}
              </button>
            </div>
          </>
        )}

        {mode === 'create' && createStep === 'mnemonic' && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[var(--c-text)]">{t.welcome.createBtn}</h3>
            <div className="glass-card p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--c-text-dim)]">{t.welcome.mnemonicPhrase}</span>
                {!mnemonicRevealed ? (
                  <button onClick={() => setMnemonicRevealed(true)} className="text-xs text-blue-400 flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" />{t.welcome.reveal}
                  </button>
                ) : (
                  <button onClick={() => { navigator.clipboard.writeText(newMnemonic); }} className="text-xs text-[var(--c-text-dim)] flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {mnemonicRevealed ? (
                <div className="recovery-grid p-3 bg-[var(--c-surface)] rounded-lg border border-[var(--c-border)]">
                  {newMnemonic.split(' ').map((word, i) => (
                    <div key={i} className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] text-[var(--c-text-dimmer)] w-4 text-right">{i + 1}</span>
                      <span className="text-xs text-[var(--c-text)] truncate">{word}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 p-6 bg-[var(--c-surface)] rounded-lg">
                  <Shield className="w-8 h-8 text-[var(--c-text-dimmer)]" />
                  <p className="text-xs text-[var(--c-text-dim)] text-center">{t.welcome.mnemonicHidden}</p>
                </div>
              )}
              <div className="flex gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-red-300/80">{t.welcome.saveWarning}</div>
              </div>
            </div>
            <button onClick={handleGoVerify} disabled={!mnemonicRevealed} className="btn-primary py-3 text-[13px]">
              {t.welcome.saved}
            </button>
            <button onClick={() => { setMode('list'); setNewMnemonic(''); setNewWalletData(null); setMnemonicRevealed(false); }} className="btn-secondary py-3 text-[13px] flex items-center justify-center gap-2">
              <RotateCcw className="w-4 h-4" />{t.welcome.back}
            </button>
          </div>
        )}

        {mode === 'create' && createStep === 'verify' && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[var(--c-text)]">{t.welcome.verifyTitle}</h3>
            <p className="text-xs text-[var(--c-text-dim)]">{t.welcome.verifyFillBlanks}</p>
            <div className="recovery-grid">
              {newMnemonic.split(' ').map((word, i) => {
                const isBlank = blankIndices.includes(i);
                return (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--c-text-dimmer)] text-center">#{i + 1}</span>
                    {isBlank ? (
                      <input
                        className="input-field text-center text-xs font-mono py-2"
                        value={verifyValues[i] || ''}
                        onChange={(e) => { setVerifyValues((p) => ({ ...p, [i]: e.target.value })); setVerifyError(''); }}
                        placeholder="?"
                        autoComplete="off"
                      />
                    ) : (
                      <div className="input-field text-center text-xs font-mono py-2 text-[var(--c-text)] bg-[var(--c-surface)] opacity-50 select-none cursor-default">{word}</div>
                    )}
                  </div>
                );
              })}
            </div>
            {verifyError && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{verifyError}</p>
              </div>
            )}
            <button onClick={handleCompleteCreate} disabled={blankIndices.some((i) => !(verifyValues[i] || '').trim())} className="btn-primary py-3 text-[13px]">
              {t.welcome.verifyBtn}
            </button>
            <button onClick={() => setCreateStep('mnemonic')} className="btn-secondary py-3 text-[13px] flex items-center justify-center gap-2">
              <RotateCcw className="w-4 h-4" />{t.welcome.back}
            </button>
          </div>
        )}

        {mode === 'import' && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[var(--c-text)]">{t.welcome.importTitle}</h3>
            <div className="flex gap-0.5 bg-[var(--c-surface)] rounded-lg p-0.5 border border-[var(--c-border)]">
              <button onClick={() => { setImportTab('pk'); setImportError(''); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-medium ${importTab === 'pk' ? 'bg-white/[0.08] text-[var(--c-text)]' : 'text-[var(--c-text-dimmer)]'}`}>
                {t.welcome.privateKey}
              </button>
              <button onClick={() => { setImportTab('mnemonic'); setImportError(''); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-medium ${importTab === 'mnemonic' ? 'bg-white/[0.08] text-[var(--c-text)]' : 'text-[var(--c-text-dimmer)]'}`}>
                {t.welcome.mnemonicPhrase}
              </button>
            </div>
            {importTab === 'pk' ? (
              <>
                <p className="text-xs text-[var(--c-text-dim)]">{t.welcome.importHint}</p>
                <div className="relative">
                  <input type={showKey ? 'text' : 'password'} value={importPk} onChange={(e) => { setImportPk(e.target.value); setImportError(''); }} placeholder="0x..." className="input-field pr-10 font-mono text-sm" />
                  <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--c-text-dimmer)]">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <input className="input-field text-[12px]" placeholder={t.wallet.labelPlaceholder} value={importLabel} onChange={(e) => setImportLabel(e.target.value)} />
              </>
            ) : (
              <>
                <p className="text-xs text-[var(--c-text-dim)]">{t.welcome.mnemonicImportHint}</p>
                <textarea value={importMnemonicStr} onChange={(e) => { setImportMnemonicStr(e.target.value); setImportError(''); }} placeholder={t.welcome.mnemonicPlaceholder} className="input-field font-mono text-sm resize-none h-24" />
              </>
            )}
            {importError && <p className="text-xs text-red-400">{importError}</p>}
            <button onClick={importTab === 'pk' ? handleImportAccount : handleImportMnemonic} disabled={!(importTab === 'pk' ? importPk.trim() : importMnemonicStr.trim())} className="btn-primary py-3 text-[13px]">
              {t.welcome.importBtnLabel}
            </button>
            <button onClick={() => { setMode('list'); setImportError(''); setImportPk(''); setImportMnemonicStr(''); }} className="btn-secondary py-3 text-[13px] flex items-center justify-center gap-2">
              <RotateCcw className="w-4 h-4" />{t.welcome.back}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
