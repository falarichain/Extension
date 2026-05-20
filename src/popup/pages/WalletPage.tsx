import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { ChainApi } from '@/lib/api';
import { normalizeAddress, generateWallet, importWallet, signTransactionHash } from '@/lib/crypto';
import { useI18n } from '@/lib/i18n';
import { ethers } from 'ethers';
import {
  Wallet,
  Plus,
  Trash2,
  Send,
  Download,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  Coins,
  RefreshCw,
} from 'lucide-react';

interface WalletPageProps {
  api: ChainApi;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatBalance(amount: number): string {
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(2)}K`;
  }
  return amount.toFixed(4);
}

export function WalletPage({ api }: WalletPageProps) {
  const { t } = useI18n();
  const accounts = useAppStore((s) => s.accounts);
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const addAccount = useAppStore((s) => s.addAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const storePrivateKey = useAppStore((s) => s.storePrivateKey);
  const saveState = useAppStore((s) => s.saveState);

  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loadingBalances, setLoadingBalances] = useState<Record<string, boolean>>({});
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importLabel, setImportLabel] = useState('');
  const [importPk, setImportPk] = useState('');
  const [importError, setImportError] = useState('');

  const [showSend, setShowSend] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  const selectedWallet = accounts.find((a) => a.address === selectedAccount) ?? null;

  const fetchBalance = useCallback(
    async (address: string) => {
      if (loadingBalances[address]) return;
      try {
        setLoadingBalances((p) => ({ ...p, [address]: true }));
        const result = await api.getBalance(address);
        setBalances((p) => ({ ...p, [address]: result.balance }));
      } catch {
        setBalances((p) => ({ ...p, [address]: NaN }));
      } finally {
        setLoadingBalances((p) => ({ ...p, [address]: false }));
      }
    },
    [api, loadingBalances],
  );

  useEffect(() => {
    for (const acc of accounts) {
      fetchBalance(acc.address);
    }
  }, [accounts, fetchBalance]);

  const handleCreateAccount = useCallback(async () => {
    try {
      const wallet = generateWallet();
      const label = `Account ${accounts.length + 1}`;
      const walletId = `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    } catch (err: any) {
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
      const walletId = `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    } catch (err: any) {
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
      // fallback for non-https contexts
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

  const handleSelectAccount = useCallback(
    (address: string) => {
      setSelectedAccount(address);
    },
    [setSelectedAccount],
  );

  const handleSend = useCallback(async () => {
    setSendError('');
    setSendSuccess('');

    if (!selectedWallet) {
      setSendError(t.wallet.noAccount);
      return;
    }

    const to = sendTo.trim();
    let amount: number;

    try {
      amount = parseFloat(sendAmount);
      if (isNaN(amount) || amount <= 0) {
        setSendError(t.wallet.invalidAmount);
        return;
      }
    } catch {
      setSendError(t.wallet.invalidAmount);
      return;
    }

    if (!to) {
      setSendError(t.wallet.recipientRequired);
      return;
    }

    let normalizedTo: string;
    try {
      normalizedTo = normalizeAddress(to);
    } catch {
      setSendError(t.wallet.invalidRecipient);
      return;
    }

    if (normalizeAddress(selectedWallet.address) === normalizedTo) {
      setSendError(t.wallet.sendToSelf);
      return;
    }

    try {
      setSendLoading(true);
      const privateKey = await getPrivateKey(selectedWallet.address);
      if (!privateKey) {
        setSendError(t.wallet.pkNotFound);
        return;
      }

      const account = await api.getAccount(selectedWallet.address);
      const nonce = account.nonce;

      if (account.balance < amount) {
        setSendError(t.wallet.insufficient);
        return;
      }

      const fee = 1;
      const payload = {
        from: selectedWallet.address,
        to: normalizedTo,
        amount,
        nonce,
        fee,
      };
      const payloadJson = JSON.stringify(payload);
      const hash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(payloadJson)));
      const signature = await signTransactionHash(privateKey, hash);

      await api.transfer({
        from: selectedWallet.address,
        to: normalizedTo,
        amount,
        nonce,
        fee,
        signature,
        publicKey: selectedWallet.publicKey,
      });

      setSendTo('');
      setSendAmount('');
      setSendSuccess(t.wallet.success);
      setTimeout(() => setSendSuccess(''), 3000);

      fetchBalance(selectedWallet.address);
      fetchBalance(normalizedTo);
    } catch (err: any) {
      setSendError(err.message || t.wallet.fail);
    } finally {
      setSendLoading(false);
    }
  }, [
    selectedWallet,
    sendTo,
    sendAmount,
    getPrivateKey,
    api,
    fetchBalance,
    t,
  ]);

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-white/[0.06] flex items-center justify-center">
          <Wallet className="w-8 h-8 text-blue-400" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-semibold text-white">{t.wallet.noAccounts}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {t.wallet.noAccountsHint}
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full max-w-[240px]">
          <button onClick={handleCreateAccount} className="btn-primary flex items-center justify-center gap-2 py-3">
            <Plus className="w-4 h-4" />
            <span>{t.wallet.createBtn}</span>
          </button>
          <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center justify-center gap-2 py-3">
            <Download className="w-4 h-4" />
            <span>{t.wallet.importBtn}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-blue-400" />
          <span className="text-[13px] font-semibold text-white">{t.wallet.accounts}</span>
          <span className="text-[11px] text-slate-500">({accounts.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setShowImport(!showImport);
              setImportError('');
              setImportPk('');
              setImportLabel('');
            }}
            className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button
            onClick={handleCreateAccount}
            className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

      {showImport && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <p className="text-[12px] font-medium text-slate-300">{t.wallet.importTitle}</p>
          <input
            className="input-field text-[13px]"
            placeholder={t.wallet.pkPlaceholder}
            value={importPk}
            onChange={(e) => {
              setImportPk(e.target.value);
              setImportError('');
            }}
          />
          <input
            className="input-field text-[13px]"
            placeholder={t.wallet.labelPlaceholder}
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
          />
          {importError && (
            <p className="text-[11px] text-red-400">{importError}</p>
          )}
          <div className="flex gap-2">
            <button onClick={handleImportAccount} className="btn-primary flex-1 py-2 text-[13px]">
              {t.wallet.importBtnLabel}
            </button>
            <button
              onClick={() => {
                setShowImport(false);
                setImportError('');
                setImportPk('');
                setImportLabel('');
              }}
              className="btn-secondary py-2 px-4 text-[13px]"
            >
              {t.wallet.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {accounts.map((account) => {
          const balance = balances[account.address];
          const loading = loadingBalances[account.address];
          const isSelected = selectedAccount === account.address;

          return (
            <div
              key={account.address}
              onClick={() => handleSelectAccount(account.address)}
              className={`glass-card p-3 flex flex-col gap-2 cursor-pointer transition-all duration-200 ${
                isSelected
                  ? 'border-blue-400/30 ring-1 ring-blue-400/20'
                  : 'hover:border-white/[0.1]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-gradient-to-br from-blue-500/30 to-purple-600/30'
                        : 'bg-white/[0.04]'
                    }`}
                  >
                    <Wallet className={`w-4 h-4 ${isSelected ? 'text-blue-400' : 'text-slate-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-white truncate">
                      {account.label}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate tabular-nums">
                      {truncateAddress(account.address)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyAddress(account.address);
                    }}
                    className="w-7 h-7 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                  >
                    {copiedAddress === account.address ? (
                      <Check className="w-3 h-3 text-green-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-slate-500" />
                    )}
                  </button>
                  {confirmDelete === account.address ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAccount(account.address);
                        }}
                        className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-colors"
                      >
                        <Check className="w-3 h-3 text-red-400" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(null);
                        }}
                        className="w-7 h-7 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                      >
                        <span className="text-[10px] text-slate-400">✕</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(account.address);
                      }}
                      className="w-7 h-7 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3 text-slate-500" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Coins className="w-3 h-3 text-slate-500" />
                  {loading ? (
                    <div className="w-16 h-4 bg-white/[0.04] rounded animate-pulse" />
                  ) : balance !== undefined && !isNaN(balance) ? (
                    <span className="text-[13px] font-semibold text-slate-200 tabular-nums">
                      {formatBalance(balance)} FAI
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">--</span>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchBalance(account.address);
                  }}
                  className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/[0.04] transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedWallet && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-purple-400" />
              <span className="text-[13px] font-semibold text-white">{t.wallet.sendTitle}</span>
            </div>
            <button
              onClick={() => {
                setShowSend(!showSend);
                setSendError('');
                setSendSuccess('');
                if (showSend) {
                  setSendTo('');
                  setSendAmount('');
                }
              }}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors"
            >
              <span>{showSend ? t.wallet.cancel : t.wallet.open}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showSend ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showSend && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-slate-500">{t.wallet.from}</label>
                <div className="input-field text-[12px] text-slate-400 select-all cursor-default">
                  {truncateAddress(selectedWallet.address)} ({selectedWallet.label})
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-slate-500">{t.wallet.recipient}</label>
                <input
                  className="input-field text-[13px]"
                  placeholder="0x..."
                  value={sendTo}
                  onChange={(e) => {
                    setSendTo(e.target.value);
                    setSendError('');
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-slate-500">{t.wallet.amount}</label>
                <input
                  className="input-field text-[13px]"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={sendAmount}
                  onChange={(e) => {
                    setSendAmount(e.target.value);
                    setSendError('');
                  }}
                />
              </div>

              {sendError && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                  <p className="text-[11px] text-red-400">{sendError}</p>
                </div>
              )}

              {sendSuccess && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <p className="text-[11px] text-green-400">{sendSuccess}</p>
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={sendLoading}
                className="btn-primary flex items-center justify-center gap-2 py-3 text-[13px]"
              >
                {sendLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{t.wallet.sending}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>{t.wallet.sendBtn}</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}

      {!selectedWallet && accounts.length > 0 && (
        <div className="glass-card p-4 flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 rounded-full bg-blue-400/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-blue-400" />
          </div>
          <p className="text-[12px] text-slate-400">
            {t.wallet.selectHint}
          </p>
        </div>
      )}
    </div>
  );
}
