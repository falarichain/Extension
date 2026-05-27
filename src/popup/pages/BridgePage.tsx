import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChainApi } from '@/lib/api';
import type { BridgeConfig, BridgeOutbound } from '@/lib/types';
import { TOKEN_UNIT } from '@/lib/types';
import { signBridgeOut } from '@/lib/bridge';
import { useI18n } from '@/lib/i18n';
import { ethers } from 'ethers';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ArrowLeftRight,
} from 'lucide-react';

interface BridgePageProps {
  api: ChainApi;
}

function formatBalance(amount: number): string {
  const v = amount / TOKEN_UNIT;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return parseFloat(v.toFixed(8)).toString();
}

function truncAddr(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function formatCountdown(targetUnix: number): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = targetUnix - now;
  if (remaining <= 0) return 'Ready';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'locked':
    case 'pending':
      return 'text-yellow-400';
    case 'claimed':
    case 'completed':
      return 'text-green-400';
    case 'failed':
      return 'text-red-400';
    default:
      return 'text-[var(--c-text-dim)]';
  }
}

export function BridgePage({ api }: BridgePageProps) {
  const { t } = useI18n();
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const accounts = useAppStore((s) => s.accounts);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);

  const [bridgeAmount, setBridgeAmount] = useState('');
  const [ethRecipient, setEthRecipient] = useState('');
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [pendingOutbounds, setPendingOutbounds] = useState<BridgeOutbound[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const currentAccount = accounts.find((a) => a.address === selectedAccount) ?? null;

  const fetchData = useCallback(async () => {
    try {
      const [config, pending] = await Promise.all([
        api.getBridgeConfig(),
        api.getBridgePending(),
      ]);
      setBridgeConfig(config);
      if (selectedAccount) {
        setPendingOutbounds(
          pending.outbounds.filter(
            (op) => op.sender.toLowerCase() === selectedAccount.toLowerCase()
          )
        );
      }
    } catch {
      // silent
    }
    if (selectedAccount) {
      try {
        const acc = await api.getAccount(selectedAccount);
        setBalance(acc.balance);
      } catch {
        setBalance(null);
      }
    }
  }, [api, selectedAccount]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      if (!currentAccount) throw new Error(t.bridge.noAccount);
      if (!ethRecipient || !ethers.isAddress(ethRecipient)) throw new Error(t.bridge.invalidRecipient);

      const amountNum = parseFloat(bridgeAmount);
      if (isNaN(amountNum) || amountNum <= 0) throw new Error(t.bridge.invalidAmount || 'Invalid amount');

      const amountUnits = Math.round(amountNum * TOKEN_UNIT);
      if (bridgeConfig && amountUnits < bridgeConfig.minBridgeAmount) {
        throw new Error(`${t.bridge.belowMinimum} (${formatBalance(bridgeConfig.minBridgeAmount)} FAL)`);
      }
      if (balance !== null && amountUnits > balance) {
        throw new Error(t.bridge.insufficientBalance);
      }

      const privateKey = await getPrivateKey(currentAccount.address);
      if (!privateKey) throw new Error(t.bridge.pkNotFound);

      const [account, status] = await Promise.all([
        api.getAccount(currentAccount.address),
        api.getStatus(),
      ]);

      const chainId = status.chainId || status.chain_id || 'falari';
      const targetChainId = bridgeConfig?.targetChainId || 'ethereum';

      const { signature, publicKey } = await signBridgeOut(privateKey, {
        chainId,
        sender: currentAccount.address,
        recipient: ethRecipient,
        targetChainId,
        amount: amountUnits,
        fee: 1,
        nonce: account.nonce + 1,
      });

      const result = await api.bridgeOut({
        sender: currentAccount.address,
        recipient: ethRecipient,
        targetChainId,
        amount: amountUnits,
        fee: 1,
        nonce: account.nonce + 1,
        signature,
        publicKey,
      });

      setSuccess(`${t.bridge.success} #${result.nonce}`);
      setBridgeAmount('');
      setEthRecipient('');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.bridge.fail);
    } finally {
      setLoading(false);
    }
  };

  const isPaused = bridgeConfig?.paused ?? false;
  void tick;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <div className="icon-tile w-8 h-8 rounded-lg">
          <ArrowLeftRight className="w-4 h-4" strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-[var(--c-text)]">{t.bridge.title}</h2>
          <p className="text-[11px] text-[var(--c-text-dim)]">{t.bridge.falariToEth}</p>
        </div>
        <button onClick={fetchData} className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--c-surface-hover)] transition-colors">
          <RefreshCw className="w-3.5 h-3.5 text-[var(--c-text-dim)]" />
        </button>
      </div>

      {/* Bridge config summary */}
      {bridgeConfig && (
        <div className="glass-card p-3">
          {isPaused && (
            <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold mb-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t.bridge.bridgePaused}</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-[var(--c-text-dim)] font-medium">{t.bridge.minAmount}</p>
              <p className="text-xs font-bold text-[var(--c-text)] font-mono">{formatBalance(bridgeConfig.minBridgeAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--c-text-dim)] font-medium">{t.bridge.delay}</p>
              <p className="text-xs font-bold text-[var(--c-text)] font-mono">{Math.floor(bridgeConfig.delaySeconds / 3600)}h</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--c-text-dim)] font-medium">{t.bridge.poolAddress}</p>
              <p className="text-xs font-bold text-[var(--c-text)] font-mono">{truncAddr(bridgeConfig.bridgePoolAddress)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Balance */}
      {balance !== null && currentAccount && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[var(--c-text-dim)]">{currentAccount.label || truncAddr(currentAccount.address)}</span>
          <span className="text-xs font-bold text-accent font-mono">{formatBalance(balance)} FAL</span>
        </div>
      )}

      {/* Form */}
      <div className="glass-card p-3 space-y-3">
        <div>
          <label className="block text-[11px] font-bold text-[var(--c-text-dim)] uppercase tracking-wider mb-1">
            {t.bridge.amount}
          </label>
          <input
            type="number"
            value={bridgeAmount}
            onChange={(e) => setBridgeAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full bg-[var(--c-surface)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--c-text)] outline-none focus:border-accent transition-colors placeholder:text-[var(--c-text-dimmer)]"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[var(--c-text-dim)] uppercase tracking-wider mb-1">
            {t.bridge.ethRecipient}
          </label>
          <input
            type="text"
            value={ethRecipient}
            onChange={(e) => setEthRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full bg-[var(--c-surface)] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--c-text)] outline-none focus:border-accent transition-colors placeholder:text-[var(--c-text-dimmer)]"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || isPaused || !currentAccount}
          className="w-full flex items-center justify-center gap-2 bg-accent text-black font-bold text-sm py-2.5 rounded-lg hover:bg-[#00cc44] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {t.bridge.bridging}</>
          ) : (
            <><ArrowRight className="w-4 h-4" /> {t.bridge.bridgeBtn}</>
          )}
        </button>
      </div>

      {/* Status messages */}
      {error && !loading && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-950/30 border border-red-900/50 text-red-400 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-green-950/20 border border-green-900/30 text-green-400 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Pending operations */}
      <div>
        <h3 className="text-[11px] font-bold text-[var(--c-text-dim)] uppercase tracking-wider mb-2 px-1">
          {t.bridge.pendingOps}
        </h3>
        {pendingOutbounds.length === 0 ? (
          <p className="text-xs text-[var(--c-text-dimmer)] text-center py-4">{t.bridge.noPending}</p>
        ) : (
          <div className="space-y-2">
            {pendingOutbounds.map((op) => (
              <div key={op.nonce} className="glass-card p-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="tag text-[10px]">#{op.nonce}</span>
                  <div>
                    <p className="text-xs font-bold text-[var(--c-text)] font-mono">{formatBalance(op.amount)} FAL</p>
                    <p className="text-[10px] text-[var(--c-text-dim)] font-mono">→ {truncAddr(op.recipient)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-[10px] font-bold uppercase ${statusColor(op.status)}`}>{op.status}</p>
                  {op.claimableAfter > 0 && (
                    <p className="text-[10px] text-[var(--c-text-dim)] flex items-center gap-0.5 justify-end">
                      <Clock className="w-3 h-3" />
                      {formatCountdown(op.claimableAfter)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
