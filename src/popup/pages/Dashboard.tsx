import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChainApi } from '@/lib/api';
import type { ChainStatus } from '@/lib/types';
import { normalizeAddress, signTransactionHash } from '@/lib/crypto';
import { useI18n } from '@/lib/i18n';
import { ethers } from 'ethers';
import QRCode from 'qrcode';
import {
  Wallet,
  Activity,
  Layers,
  Shield,
  TrendingUp,
  Database,
  Coins,
  RefreshCw,
  Zap,
  Send,
  QrCode,
  ArrowLeftRight,
  Copy,
  Check,
  X,
} from 'lucide-react';

interface DashboardProps {
  api: ChainApi;
  chainStatus: ChainStatus | null;
}

function formatBalance(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(4);
}

function formatFiat(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function StatCard({ icon: Icon, label, value, suffix }: {
  icon: typeof Activity;
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="glass-card p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[var(--c-text-dim)]">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-base font-bold text-[var(--c-text)]">{value}</span>
        {suffix && <span className="text-[11px] text-[var(--c-text-dim)]">{suffix}</span>}
      </div>
    </div>
  );
}

export function Dashboard({ api, chainStatus }: DashboardProps) {
  const { t } = useI18n();
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const accounts = useAppStore((s) => s.accounts);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');
  const [receiveCopied, setReceiveCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const account = accounts.find((a) => a.address === selectedAccount) ?? null;

  const fetchBalance = useCallback(async () => {
    if (!selectedAccount) { setBalance(null); setLoading(false); return; }
    try {
      setLoading(true);
      const result = await api.getBalance(selectedAccount);
      setBalance(result.balance);
    } catch { setBalance(null); }
    finally { setLoading(false); }
  }, [api, selectedAccount]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  useEffect(() => {
    if (showReceive && account) {
      QRCode.toDataURL(account.address, { width: 180, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [showReceive, account]);

  const connected = chainStatus !== null;

  const handleSend = useCallback(async () => {
    setSendError(''); setSendSuccess('');
    if (!account) { setSendError(t.dashboard.noAccount); return; }
    const to = sendTo.trim();
    let amount: number;
    try { amount = parseFloat(sendAmount); if (isNaN(amount) || amount <= 0) { setSendError(t.dashboard.invalidAmount); return; } } catch { setSendError(t.dashboard.invalidAmount); return; }
    if (!to) { setSendError(t.dashboard.recipientRequired); return; }
    let normalizedTo: string;
    try { normalizedTo = normalizeAddress(to); } catch { setSendError(t.dashboard.invalidRecipient); return; }
    if (normalizeAddress(account.address) === normalizedTo) { setSendError(t.dashboard.sendToSelf); return; }
    try {
      setSendLoading(true);
      const privateKey = await getPrivateKey(account.address);
      if (!privateKey) { setSendError(t.dashboard.pkNotFound); return; }
      const acc = await api.getAccount(account.address);
      if (acc.balance < amount) { setSendError(t.dashboard.insufficient); return; }
      const payload = { from: account.address, to: normalizedTo, amount, nonce: acc.nonce, fee: 1 };
      const hash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload))));
      const signature = await signTransactionHash(privateKey, hash);
      await api.transfer({ from: account.address, to: normalizedTo, amount, nonce: acc.nonce, fee: 1, signature, publicKey: account.publicKey });
      setSendTo(''); setSendAmount('');
      setSendSuccess(t.dashboard.success);
      setTimeout(() => setSendSuccess(''), 3000);
      fetchBalance();
    } catch (err: any) { setSendError(err.message || t.dashboard.fail); }
    finally { setSendLoading(false); }
  }, [account, sendTo, sendAmount, getPrivateKey, api, fetchBalance, t]);

  const handleCopyReceiveAddress = async () => {
    if (!account) return;
    try { await navigator.clipboard.writeText(account.address); }
    catch {
      const ta = document.createElement('textarea'); ta.value = account.address;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setReceiveCopied(true); setTimeout(() => setReceiveCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'}`} />
          <span className="text-sm font-semibold text-[var(--c-text)]">{connected ? t.dashboard.connected : t.dashboard.disconnected}</span>
        </div>
        {connected && chainStatus && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--c-text-dim)]">
            <Layers className="w-4 h-4" />
            <span>{t.dashboard.height}</span>
            <span className="text-[var(--c-text)] font-semibold tabular-nums">#{chainStatus.height.toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-white/[0.06] flex items-center justify-center">
              <Wallet className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-[var(--c-text-dim)]">{t.dashboard.balance}</p>
              {account && <p className="text-xs text-[var(--c-text-dimmer)] truncate max-w-[140px]">{account.label || truncateAddress(account.address)}</p>}
            </div>
          </div>
          <button onClick={fetchBalance} disabled={loading} className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors">
            <RefreshCw className={`w-4 h-4 text-[var(--c-text-dim)] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {!selectedAccount ? <p className="text-xs text-[var(--c-text-dim)]">{t.dashboard.noAccount}</p>
        : loading && balance === null ? <div className="h-8 flex items-center"><div className="w-24 h-5 bg-white/[0.04] rounded animate-pulse" /></div>
        : balance !== null ? <div><p className="text-2xl font-bold text-[var(--c-text)] tabular-nums">{formatBalance(balance)}<span className="text-base font-semibold text-[var(--c-text-dim)] ml-1.5">FAI</span></p></div>
        : <p className="text-xs text-[var(--c-text-dim)]">{t.dashboard.loadBalanceFail}</p>}
      </div>

      {selectedAccount && (
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
          <button onClick={() => { setShowSend(!showSend); setShowReceive(false); setSendError(''); setSendSuccess(''); if (showSend) { setSendTo(''); setSendAmount(''); } }}
            className={`glass-card p-3 flex flex-col items-center gap-1.5 transition-all min-w-0 ${showSend ? 'border-blue-400/30 ring-1 ring-blue-400/20' : ''}`}>
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center"><Send className="w-5 h-5 text-blue-400" /></div>
            <span className="text-xs font-semibold text-[var(--c-text)] truncate max-w-full">{t.dashboard.send}</span>
          </button>
          <button onClick={() => { setShowReceive(!showReceive); setShowSend(false); setSendError(''); setSendSuccess(''); }}
            className={`glass-card p-3 flex flex-col items-center gap-1.5 transition-all min-w-0 ${showReceive ? 'border-green-400/30 ring-1 ring-green-400/20' : ''}`}>
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center"><QrCode className="w-5 h-5 text-green-400" /></div>
            <span className="text-xs font-semibold text-[var(--c-text)] truncate max-w-full">{t.dashboard.receive}</span>
          </button>
          <button className="glass-card p-3 flex flex-col items-center gap-1.5 min-w-0">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center"><ArrowLeftRight className="w-5 h-5 text-emerald-400" /></div>
            <span className="text-xs font-semibold text-[var(--c-text)] truncate max-w-full">{t.dashboard.bridge}</span>
          </button>
        </div>
      )}

      {showSend && selectedAccount && account && (
        <div className="glass-card p-4 flex flex-col gap-3 border-blue-400/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Send className="w-5 h-5 text-purple-400" /><span className="text-sm font-semibold text-[var(--c-text)]">{t.dashboard.sendTitle}</span></div>
            <button onClick={() => { setShowSend(false); setSendError(''); setSendTo(''); setSendAmount(''); }} className="text-[var(--c-text-dimmer)] hover:text-[var(--c-text)]"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-col gap-1.5"><label className="text-xs text-[var(--c-text-dim)]">{t.dashboard.from}</label><div className="input-field text-sm text-[var(--c-text)] select-all cursor-default">{truncateAddress(account.address)} ({account.label})</div></div>
          <div className="flex flex-col gap-1.5"><label className="text-xs text-[var(--c-text-dim)]">{t.dashboard.recipient}</label><input className="input-field text-sm" placeholder="0x..." value={sendTo} onChange={(e) => { setSendTo(e.target.value); setSendError(''); }} /></div>
          <div className="flex flex-col gap-1.5"><label className="text-xs text-[var(--c-text-dim)]">{t.dashboard.amount}</label><input className="input-field text-sm" type="number" step="any" min="0" placeholder="0.00" value={sendAmount} onChange={(e) => { setSendAmount(e.target.value); setSendError(''); }} /></div>
          {sendError && <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" /><p className="text-xs text-red-400">{sendError}</p></div>}
          {sendSuccess && <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" /><p className="text-xs text-green-400">{sendSuccess}</p></div>}
          <button onClick={handleSend} disabled={sendLoading} className="btn-primary flex items-center justify-center gap-2 py-3 text-sm font-semibold">
            {sendLoading ? <><RefreshCw className="w-4 h-4 animate-spin" /><span>{t.dashboard.sending}</span></> : <><Send className="w-4 h-4" /><span>{t.dashboard.sendBtn}</span></>}
          </button>
        </div>
      )}

      {showReceive && selectedAccount && account && (
        <div className="glass-card p-4 flex flex-col gap-3 border-green-400/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 7h.01" /><path d="M7 17h.01" /><path d="M17 7h.01" /><path d="M12 7v10" /><path d="M17 12h.01" /></svg>
              <span className="text-sm font-semibold text-[var(--c-text)]">{t.dashboard.receiveTitle}</span>
            </div>
            <button onClick={() => setShowReceive(false)} className="text-[var(--c-text-dimmer)] hover:text-[var(--c-text)]"><X className="w-4 h-4" /></button>
          </div>

          {qrDataUrl && (
            <div className="flex justify-center p-3 bg-white rounded-xl">
              <img src={qrDataUrl} alt="QR Code" className="w-[160px] h-[160px]" />
            </div>
          )}

          <p className="text-xs text-[var(--c-text-dim)]">{t.dashboard.receiveHint}</p>
          <div className="flex items-center gap-2 p-3 bg-white/[0.04] rounded-lg border border-white/[0.06]">
            <code className="text-sm text-[var(--c-text)] break-all flex-1">{account.address}</code>
            <button onClick={handleCopyReceiveAddress} className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors shrink-0">
              {receiveCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-[var(--c-text-dimmer)]" />}
            </button>
          </div>
          <button onClick={() => setShowReceive(false)} className="btn-secondary flex items-center justify-center gap-2 py-2.5 text-sm font-semibold">{t.dashboard.cancel}</button>
        </div>
      )}

      {connected && chainStatus && (<>
        <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-blue-400" /><span className="text-xs font-semibold text-[var(--c-text-dim)]">{t.dashboard.networkStats}</span></div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard icon={Zap} label={t.dashboard.activeMiners} value={chainStatus.activeMiners.toLocaleString()} />
          <StatCard icon={Database} label={t.dashboard.deals} value={chainStatus.deals.toLocaleString()} />
          <StatCard icon={Layers} label={t.dashboard.intents} value={chainStatus.intents.toLocaleString()} />
          <StatCard icon={Shield} label={t.dashboard.validators} value={chainStatus.validators.toLocaleString()} />
        </div>
        <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-purple-400" /><span className="text-xs font-semibold text-[var(--c-text-dim)]">{t.dashboard.tokenEconomy}</span></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="glass-card p-3 flex flex-col gap-1.5"><div className="flex items-center gap-1.5 text-[var(--c-text-dim)]"><Coins className="w-4 h-4" /><span className="text-xs font-semibold">{t.dashboard.totalSupply}</span></div><span className="text-base font-bold text-[var(--c-text)] tabular-nums">{formatBalance(chainStatus.totalSupply)} FAI</span></div>
          <div className="glass-card p-3 flex flex-col gap-1.5"><div className="flex items-center gap-1.5 text-[var(--c-text-dim)]"><Activity className="w-4 h-4" /><span className="text-xs font-semibold">{t.dashboard.baseFee}</span></div><span className="text-base font-bold text-[var(--c-text)] tabular-nums">{chainStatus.feeMarket.baseFee.toFixed(4)} FAI</span></div>
          <div className="glass-card p-3 flex flex-col gap-1.5 col-span-2"><div className="flex items-center gap-1.5 text-[var(--c-text-dim)]"><Database className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold truncate">{t.dashboard.storagePrice}</span></div><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-base font-bold text-[var(--c-text)] tabular-nums">{formatFiat(chainStatus.storagePricing.basePricePerGiBMonth)} FAI</span><span className="text-xs text-[var(--c-text-dim)]">{t.dashboard.perGibMonth}</span><span className="text-xs text-[var(--c-text-dim)]">{t.dashboard.minFee} {chainStatus.storagePricing.minimumFee.toFixed(4)}</span></div></div>
        </div>
      </>)}

      {!connected && (
        <div className="glass-card p-4 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-red-400/10 flex items-center justify-center"><Activity className="w-6 h-6 text-red-400" /></div>
          <div><p className="text-sm font-semibold text-[var(--c-text)]">{t.dashboard.cannotConnect}</p><p className="text-xs text-[var(--c-text-dim)] mt-1">{t.dashboard.checkSettings}</p></div>
        </div>
      )}
    </div>
  );
}
