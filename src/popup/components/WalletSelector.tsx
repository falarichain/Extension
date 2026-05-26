import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore, generateId } from '@/lib/store';
import { ChainApi } from '@/lib/api';
import { generateWallet, importWallet, normalizeAddress } from '@/lib/crypto';
import { useI18n } from '@/lib/i18n';
import { TOKEN_UNIT } from '@/lib/types';
import {
  Wallet,
  ChevronDown,
  Plus,
  Download,
  Copy,
  Check,
  Trash2,
  X,
} from 'lucide-react';

interface WalletSelectorProps {
  api: ChainApi;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletSelector({ api }: WalletSelectorProps) {
  const { t } = useI18n();
  const accounts = useAppStore((s) => s.accounts);
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const addAccount = useAppStore((s) => s.addAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const storePrivateKey = useAppStore((s) => s.storePrivateKey);
  const saveState = useAppStore((s) => s.saveState);

  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importLabel, setImportLabel] = useState('');
  const [importPk, setImportPk] = useState('');
  const [importError, setImportError] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const selectedWallet = accounts.find((a) => a.address === selectedAccount) ?? null;

  const recalcPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, []);

  useEffect(() => {
    const fetchBalances = async () => {
      for (const acc of accounts) {
        try {
          const result = await api.getBalance(acc.address);
          setBalances((p) => ({ ...p, [acc.address]: result.balance }));
        } catch {}
      }
    };
    fetchBalances();
  }, [accounts, api]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowImport(false);
        setImportError('');
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleOpen = () => {
    if (!open) recalcPosition();
    setOpen(!open);
  };

  const handleSelectAccount = useCallback(
    (address: string) => {
      setSelectedAccount(address);
      setOpen(false);
    },
    [setSelectedAccount],
  );

  const handleCreateAccount = useCallback(async () => {
    try {
      const wallet = generateWallet();
      const label = `Account ${accounts.length + 1}`;
      const walletId = generateId();
      const newAccount = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        walletId,
        pathIndex: 0,
        label,
        createdAt: Math.floor(Date.now() / 1000),
      };
      addAccount(newAccount);
      await storePrivateKey(wallet.address, wallet.privateKey);
      await saveState();
      setSelectedAccount(wallet.address);
      setOpen(false);
    } catch (err) {
      console.error('Failed to create account:', err);
    }
  }, [accounts.length, addAccount, storePrivateKey, saveState, setSelectedAccount]);

  const handleImportAccount = useCallback(async () => {
    setImportError('');
    try {
      const wallet = importWallet(importPk.trim());
      const exists = accounts.some(
        (a) => normalizeAddress(a.address) === normalizeAddress(wallet.address),
      );
      if (exists) {
        setImportError(t.wallet.alreadyImported);
        return;
      }
      const label = importLabel.trim() || `Imported ${wallet.address.slice(0, 6)}`;
      const walletId = generateId();
      const newAccount = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        walletId,
        pathIndex: 0,
        label,
        createdAt: Math.floor(Date.now() / 1000),
      };
      addAccount(newAccount);
      await storePrivateKey(wallet.address, wallet.privateKey);
      await saveState();
      setImportPk('');
      setImportLabel('');
      setShowImport(false);
      setSelectedAccount(wallet.address);
      setOpen(false);
    } catch {
      setImportError(t.wallet.invalidPk);
    }
  }, [importPk, importLabel, accounts, addAccount, storePrivateKey, saveState, setSelectedAccount, t]);

  const handleDeleteAccount = useCallback(
    async (address: string) => {
      removeAccount(address);
      await saveState();
      setConfirmDelete(null);
    },
    [removeAccount, saveState],
  );

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

  const displayBal = (address: string) => {
    const b = balances[address];
    if (b === undefined) return '--';
    const v = b / TOKEN_UNIT;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
    return parseFloat(v.toFixed(8)).toString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--c-surface)] border border-[var(--c-border)] hover:bg-[var(--c-surface-hover)] transition-colors max-w-[180px]"
      >
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-600/30 flex items-center justify-center shrink-0">
          <Wallet className="w-3 h-3 text-blue-400" />
        </div>
        <span className="text-[11px] font-medium text-[var(--c-text)] truncate">
          {selectedWallet ? truncateAddress(selectedWallet.address) : t.dashboard.noAccount}
        </span>
        <ChevronDown className={`w-3 h-3 text-[var(--c-text-dim)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
          className="w-[260px] bg-[var(--c-bg)] border border-[var(--c-border)] rounded-xl shadow-2xl flex flex-col max-h-[380px] overflow-hidden"
        >
          <div className="p-2 border-b border-[var(--c-border)]">
            <span className="text-[11px] text-[var(--c-text-dim)] px-1">{t.wallet.accounts}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
            {accounts.map((account) => {
              const isSelected = selectedAccount === account.address;
              const isDeleting = confirmDelete === account.address;

              return (
                <div
                  key={account.address}
                  className={`flex flex-col rounded-lg transition-colors ${
                    isSelected ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-[var(--c-surface-hover)] border border-transparent'
                  }`}
                >
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer"
                    onClick={() => handleSelectAccount(account.address)}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-gradient-to-br from-blue-500/30 to-purple-600/30'
                          : 'bg-[var(--c-surface)]'
                      }`}
                    >
                      <Wallet className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-400' : 'text-[var(--c-text-dimmer)]'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-[var(--c-text)] truncate">{account.label}</p>
                      <p className="text-[10px] text-[var(--c-text-dimmer)] truncate">{truncateAddress(account.address)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-[var(--c-text-dim)] tabular-nums">{displayBal(account.address)} GF</span>
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="flex items-center gap-1 px-2 pb-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyAddress(account.address);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--c-text-dim)] hover:text-[var(--c-text)] hover:bg-[var(--c-surface-hover)] transition-colors"
                      >
                        {copiedAddress === account.address ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedAddress === account.address ? t.dashboard.copied : t.dashboard.copyAddress}
                      </button>
                      {isDeleting ? (
                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAccount(account.address);
                            }}
                            className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(null);
                            }}
                            className="px-2 py-1 rounded text-[10px] text-[var(--c-text-dim)] hover:bg-[var(--c-surface-hover)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        accounts.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(account.address);
                            }}
                            className="ml-auto px-1.5 py-1 rounded text-[10px] text-[var(--c-text-dimmer)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {showImport && (
            <div className="border-t border-[var(--c-border)] p-2 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--c-text)]">{t.wallet.importTitle}</span>
                <button
                  onClick={() => { setShowImport(false); setImportError(''); }}
                  className="text-[var(--c-text-dimmer)] hover:text-[var(--c-text)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                className="input-field text-[12px]"
                placeholder={t.wallet.pkPlaceholder}
                value={importPk}
                onChange={(e) => { setImportPk(e.target.value); setImportError(''); }}
              />
              <input
                className="input-field text-[12px]"
                placeholder={t.wallet.labelPlaceholder}
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
              />
              {importError && (
                <p className="text-[10px] text-red-400">{importError}</p>
              )}
              <button onClick={handleImportAccount} className="btn-primary py-1.5 text-[12px]">
                {t.wallet.importBtnLabel}
              </button>
            </div>
          )}

          <div className="border-t border-[var(--c-border)] p-1.5 flex gap-1.5">
            <button
              onClick={handleCreateAccount}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--c-surface)] hover:bg-[var(--c-surface-hover)] text-[11px] text-[var(--c-text)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.wallet.createBtn}
            </button>
            <button
              onClick={() => setShowImport(!showImport)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--c-surface)] hover:bg-[var(--c-surface-hover)] text-[11px] text-[var(--c-text)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {t.wallet.importBtn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
