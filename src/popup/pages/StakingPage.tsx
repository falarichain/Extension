import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChainApi } from '@/lib/api';
import type { ValidatorInfo, StakeDelegation } from '@/lib/types';
import { TOKEN_UNIT } from '@/lib/types';
import { normalizeAddress, signTransactionHash } from '@/lib/crypto';
import { useI18n } from '@/lib/i18n';
import { ethers } from 'ethers';
import {
  ArrowLeft,
  Shield,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  X,
} from 'lucide-react';

interface StakingPageProps {
  api: ChainApi;
  onBack: () => void;
}

function formatBalance(amount: number): string {
  const v = amount / TOKEN_UNIT;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return parseFloat(v.toFixed(8)).toString();
}

function truncAddr(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

// Global default commission is 10% (1000 BPS), set in chain config
const DEFAULT_COMMISSION_BPS = 1000;

function effectiveCommissionBPS(validator: ValidatorInfo): number {
  return validator.commission_rate_bps || DEFAULT_COMMISSION_BPS;
}

function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

type SortKey = 'stake' | 'availability' | 'commission' | 'delegators';
type TabKey = 'validators' | 'my-delegations';

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400 bg-green-400/10 border-green-400/20',
  jailed: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  slashed: 'text-red-400 bg-red-400/10 border-red-400/20',
  exiting: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  exited: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
};

export function StakingPage({ api, onBack }: StakingPageProps) {
  const { t } = useI18n();
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const accounts = useAppStore((s) => s.accounts);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const account = accounts.find((a) => a.address === selectedAccount) ?? null;

  const [validators, setValidators] = useState<ValidatorInfo[]>([]);
  const [delegations, setDelegations] = useState<StakeDelegation[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('validators');
  const [expandedValidator, setExpandedValidator] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('stake');
  const [filterStatus, setFilterStatus] = useState('all');

  // Per-validator form state
  const [delegateAmount, setDelegateAmount] = useState('');
  const [undelegateAmount, setUndelegateAmount] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  const fetchData = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [valResp, delResp, balResp] = await Promise.all([
        api.listValidators(),
        selectedAccount ? api.getDelegations(selectedAccount) : Promise.resolve({ delegations: [] }),
        selectedAccount ? api.getBalance(selectedAccount) : Promise.resolve({ balance: 0, nonce: 0 }),
      ]);
      setValidators(valResp.validators || []);
      setDelegations(delResp.delegations || []);
      setBalance(balResp.balance);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [api, selectedAccount]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const delegationMap = useMemo(() => {
    const m = new Map<string, StakeDelegation>();
    for (const d of delegations) {
      m.set(d.validator.toLowerCase(), d);
    }
    return m;
  }, [delegations]);

  const totalDelegated = useMemo(() => {
    return delegations.reduce((sum, d) => sum + d.amount, 0);
  }, [delegations]);

  const medianBlocks = useMemo(() => {
    if (validators.length === 0) return 0;
    const sorted = [...validators].sort((a, b) => a.produced_blocks - b.produced_blocks);
    return sorted[Math.floor(sorted.length / 2)]?.produced_blocks ?? 0;
  }, [validators]);

  const sortedValidators = useMemo(() => {
    let filtered = validators;
    if (filterStatus !== 'all') {
      filtered = filtered.filter((v) => v.status === filterStatus);
    }
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'stake':
          return (b.stake + b.delegated_stake) - (a.stake + a.delegated_stake);
        case 'availability':
          return b.availability_score_bps - a.availability_score_bps;
        case 'commission':
          return effectiveCommissionBPS(a) - effectiveCommissionBPS(b);
        case 'delegators':
          return b.delegator_count - a.delegator_count;
        default:
          return 0;
      }
    });
  }, [validators, sortBy, filterStatus]);

  const handleDelegate = useCallback(async (validatorAddress: string) => {
    setError(''); setSuccess('');
    if (!account) { setError(t.staking.noAccount); return; }
    let amount: number;
    try {
      amount = parseFloat(delegateAmount);
      if (isNaN(amount) || amount <= 0) { setError(t.staking.invalidAmount); return; }
      amount = Math.round(amount * TOKEN_UNIT);
    } catch { setError(t.staking.invalidAmount); return; }

    try {
      setActionLoading(`delegate-${validatorAddress}`);
      const privateKey = await getPrivateKey(account.address);
      if (!privateKey) { setError(t.staking.pkNotFound); return; }
      const acc = await api.getAccount(account.address);
      if (acc.balance < amount) { setError(t.staking.insufficientBalance); return; }

      const signingPayload = {
        action: 'delegate_stake',
        amount,
        chain_id: '',
        delegator: normalizeAddress(account.address),
        nonce: acc.nonce,
        validator: validatorAddress,
      };
      const hash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(signingPayload))));
      const signature = await signTransactionHash(privateKey, hash);

      await api.delegateStake({
        delegator: account.address,
        validator: validatorAddress,
        amount,
        nonce: acc.nonce,
        signature,
        publicKey: account.publicKey,
      });

      setDelegateAmount('');
      setSuccess(t.staking.delegateSuccess);
      setTimeout(() => setSuccess(''), 3000);
      fetchData();
    } catch (err: any) {
      setError(`${t.staking.delegateFail}: ${err.message}`);
    } finally {
      setActionLoading('');
    }
  }, [account, delegateAmount, getPrivateKey, api, fetchData, t]);

  const handleUndelegate = useCallback(async (validatorAddress: string) => {
    setError(''); setSuccess('');
    if (!account) { setError(t.staking.noAccount); return; }
    let amount: number;
    try {
      amount = parseFloat(undelegateAmount);
      if (isNaN(amount) || amount <= 0) { setError(t.staking.invalidAmount); return; }
      amount = Math.round(amount * TOKEN_UNIT);
    } catch { setError(t.staking.invalidAmount); return; }

    try {
      setActionLoading(`undelegate-${validatorAddress}`);
      const privateKey = await getPrivateKey(account.address);
      if (!privateKey) { setError(t.staking.pkNotFound); return; }
      const acc = await api.getAccount(account.address);

      const signingPayload = {
        action: 'undelegate_stake',
        amount,
        chain_id: '',
        delegator: normalizeAddress(account.address),
        nonce: acc.nonce,
        validator: validatorAddress,
      };
      const hash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(signingPayload))));
      const signature = await signTransactionHash(privateKey, hash);

      await api.undelegateStake({
        delegator: account.address,
        validator: validatorAddress,
        amount,
        nonce: acc.nonce,
        signature,
        publicKey: account.publicKey,
      });

      setUndelegateAmount('');
      setSuccess(t.staking.undelegateSuccess);
      setTimeout(() => setSuccess(''), 3000);
      fetchData();
    } catch (err: any) {
      setError(`${t.staking.undelegateFail}: ${err.message}`);
    } finally {
      setActionLoading('');
    }
  }, [account, undelegateAmount, getPrivateKey, api, fetchData, t]);

  function estimateEarnings(validator: ValidatorInfo, delegationAmount: number): string {
    if (!validator.delegated_stake || !validator.rewards) return t.staking.insufficientData;
    const rate = validator.rewards / validator.delegated_stake;
    const commissionFactor = 1 - effectiveCommissionBPS(validator) / 10000;
    const estimated = delegationAmount * rate * commissionFactor;
    return `≈ ${formatBalance(estimated)} GF ${t.staking.perEpoch}`;
  }

  function getAvailabilityColor(bps: number): string {
    if (bps >= 9000) return 'bg-green-400';
    if (bps >= 6000) return 'bg-yellow-400';
    return 'bg-red-400';
  }

  function toggleExpand(address: string) {
    if (expandedValidator === address) {
      setExpandedValidator(null);
      setDelegateAmount('');
      setUndelegateAmount('');
    } else {
      setExpandedValidator(address);
      setDelegateAmount('');
      setUndelegateAmount('');
    }
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors">
            <ArrowLeft className="w-4 h-4 text-[var(--c-text)]" strokeWidth={2.5} />
          </button>
          <div className="flex items-center gap-2">
            <span className="icon-tile h-8 w-8"><Shield className="w-4 h-4" strokeWidth={2.5} /></span>
            <span className="text-sm font-semibold text-[var(--c-text)]">{t.staking.title}</span>
          </div>
        </div>
        <button onClick={fetchData} disabled={loading} className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors">
          <RefreshCw className={`w-4 h-4 text-[var(--c-text)] ${loading ? 'animate-spin' : ''}`} strokeWidth={2.5} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card p-3 flex flex-col gap-1.5">
          <span className="text-xs text-[var(--c-text-dim)] font-semibold">{t.staking.totalDelegated}</span>
          <span className="text-base font-bold text-[var(--c-text)] tabular-nums">{formatBalance(totalDelegated)} <span className="text-xs text-[var(--c-text-dim)]">GF</span></span>
        </div>
        <div className="glass-card p-3 flex flex-col gap-1.5">
          <span className="text-xs text-[var(--c-text-dim)] font-semibold">{t.staking.availableBalance}</span>
          <span className="text-base font-bold text-[var(--c-text)] tabular-nums">{formatBalance(balance)} <span className="text-xs text-[var(--c-text-dim)]">GF</span></span>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-400/10 border border-red-400/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-xs text-red-400 flex-1">{error}</p>
          <button onClick={() => setError('')}><X className="w-3.5 h-3.5 text-red-400" /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-400/10 border border-green-400/20">
          <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
          <p className="text-xs text-green-400">{success}</p>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-0.5">
        <button
          onClick={() => setActiveTab('validators')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors ${activeTab === 'validators' ? 'bg-white/[0.08] text-[var(--c-text)]' : 'text-slate-500 hover:text-[var(--c-text-dim)]'}`}
        >
          {t.staking.validators}
        </button>
        <button
          onClick={() => setActiveTab('my-delegations')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors ${activeTab === 'my-delegations' ? 'bg-white/[0.08] text-[var(--c-text)]' : 'text-slate-500 hover:text-[var(--c-text-dim)]'}`}
        >
          {t.staking.myDelegations} {delegations.length > 0 && `(${delegations.length})`}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-4">
              <div className="h-5 w-32 bg-white/[0.04] rounded animate-pulse mb-2" />
              <div className="h-4 w-48 bg-white/[0.04] rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Validators Tab */}
      {!loading && activeTab === 'validators' && (
        <>
          {/* Sort & Filter */}
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="input-field text-xs py-1.5 flex-1"
            >
              <option value="stake">{t.staking.sortStake}</option>
              <option value="availability">{t.staking.sortAvailability}</option>
              <option value="commission">{t.staking.sortCommission}</option>
              <option value="delegators">{t.staking.sortDelegators}</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field text-xs py-1.5 flex-1"
            >
              <option value="all">{t.staking.allStatuses}</option>
              <option value="active">{t.staking.active}</option>
              <option value="jailed">{t.staking.jailed}</option>
              <option value="slashed">{t.staking.slashed}</option>
              <option value="exiting">{t.staking.exiting}</option>
              <option value="exited">{t.staking.exited}</option>
            </select>
          </div>

          {sortedValidators.length === 0 && (
            <div className="glass-card p-6 flex flex-col items-center gap-3 text-center">
              <Shield className="w-10 h-10 text-[var(--c-text-dimmer)]" />
              <p className="text-sm text-[var(--c-text-dim)]">{t.staking.noValidators}</p>
            </div>
          )}

          {sortedValidators.map((v) => {
            const isExpanded = expandedValidator === v.address;
            const delegation = delegationMap.get(v.address.toLowerCase());
            const availabilityPct = v.availability_score_bps / 100;
            const isAboveMedian = v.produced_blocks >= medianBlocks;

            return (
              <div key={v.address} className={`glass-card ${isExpanded ? 'border-[rgba(var(--c-accent-rgb),0.3)]' : ''}`}>
                {/* Validator Header (clickable to expand) */}
                <button
                  onClick={() => toggleExpand(v.address)}
                  className="w-full p-3 flex items-center gap-3 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--c-text)] truncate">{truncAddr(v.address)}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[v.status] || STATUS_COLORS.exited}`}>
                        {v.status}
                      </span>
                      {v.consensus && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-blue-400 bg-blue-400/10 border-blue-400/20">
                          {t.staking.consensus}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[var(--c-text-dim)]">
                      <span>{t.staking.totalStake}: <span className="text-[var(--c-text)] font-semibold tabular-nums">{formatBalance(v.stake + v.delegated_stake)}</span></span>
                      <span>{t.staking.availabilityScore}: <span className={`font-semibold tabular-nums ${v.availability_score_bps >= 9000 ? 'text-green-400' : v.availability_score_bps >= 6000 ? 'text-yellow-400' : 'text-red-400'}`}>{availabilityPct.toFixed(1)}%</span></span>
                    </div>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-[var(--c-text-dim)] shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-[var(--c-text-dim)] shrink-0" />
                  }
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-white/[0.06] p-3 flex flex-col gap-3">
                    {/* Info Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.totalStake}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{formatBalance(v.stake + v.delegated_stake)} GF</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.selfStake}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{formatBalance(v.self_stake)} GF</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.delegatedStake}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{formatBalance(v.delegated_stake)} GF</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.delegatorCount}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{v.delegator_count}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.commissionRate}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{bpsToPercent(effectiveCommissionBPS(v))}{!v.commission_rate_bps && <span className="text-[var(--c-text-dim)] text-[10px] ml-1">({t.staking.defaultRate})</span>}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.producedBlocks}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{v.produced_blocks.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.rewards}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{formatBalance(v.rewards)} GF</span></div>
                      <div className="flex justify-between"><span className="text-[var(--c-text-dim)]">{t.staking.evidenceCount}</span><span className="text-[var(--c-text)] font-semibold tabular-nums">{v.evidence_count}</span></div>
                    </div>

                    {/* Availability Trend Bar */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--c-text-dim)]">{t.staking.availabilityScore}</span>
                        <div className="flex items-center gap-1">
                          {isAboveMedian
                            ? <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                            : <TrendingDown className="w-3.5 h-3.5 text-yellow-400" />
                          }
                          <span className="text-[var(--c-text)] font-semibold tabular-nums">{availabilityPct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getAvailabilityColor(v.availability_score_bps)}`}
                          style={{ width: `${Math.min(availabilityPct, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Current Delegation */}
                    {delegation && (
                      <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[var(--c-text-dim)] font-semibold">{t.staking.currentDelegation}</span>
                          <span className="text-[var(--c-text)] font-bold tabular-nums">{formatBalance(delegation.amount)} GF</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--c-text-dim)]">{t.staking.delegatedSince}</span>
                          <span className="text-[var(--c-text)] tabular-nums">{new Date(delegation.since_unix * 1000).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[var(--c-text-dim)]">{t.staking.earningsEstimate}</span>
                          <span className="text-green-400 font-semibold tabular-nums">{estimateEarnings(v, delegation.amount)}</span>
                        </div>
                      </div>
                    )}

                    {/* Delegate Form */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-[var(--c-text-dim)] font-semibold">{t.staking.delegate}</label>
                      <div className="flex gap-2">
                        <input
                          className="input-field text-sm flex-1"
                          type="number"
                          step="any"
                          min="0"
                          placeholder={t.staking.delegateAmount}
                          value={delegateAmount}
                          onChange={(e) => { setDelegateAmount(e.target.value); setError(''); }}
                        />
                        <button
                          onClick={() => handleDelegate(v.address)}
                          disabled={actionLoading === `delegate-${v.address}` || !delegateAmount}
                          className="btn-primary px-4 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                        >
                          {actionLoading === `delegate-${v.address}` ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : t.staking.delegate}
                        </button>
                      </div>
                    </div>

                    {/* Undelegate Form */}
                    {delegation && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-[var(--c-text-dim)] font-semibold">{t.staking.undelegate}</label>
                        <div className="flex gap-2">
                          <input
                            className="input-field text-sm flex-1"
                            type="number"
                            step="any"
                            min="0"
                            max={formatBalance(delegation.amount)}
                            placeholder={t.staking.undelegateAmount}
                            value={undelegateAmount}
                            onChange={(e) => { setUndelegateAmount(e.target.value); setError(''); }}
                          />
                          <button
                            onClick={() => handleUndelegate(v.address)}
                            disabled={actionLoading === `undelegate-${v.address}` || !undelegateAmount}
                            className="btn-secondary px-4 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                          >
                            {actionLoading === `undelegate-${v.address}` ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : t.staking.undelegate}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* My Delegations Tab */}
      {!loading && activeTab === 'my-delegations' && (
        <>
          {delegations.length === 0 && (
            <div className="glass-card p-6 flex flex-col items-center gap-3 text-center">
              <Shield className="w-10 h-10 text-[var(--c-text-dimmer)]" />
              <p className="text-sm font-semibold text-[var(--c-text)]">{t.staking.noDelegations}</p>
              <p className="text-xs text-[var(--c-text-dim)]">{t.staking.noDelegationsHint}</p>
            </div>
          )}

          {delegations.map((d) => {
            const validator = validators.find((v) => v.address.toLowerCase() === d.validator.toLowerCase());
            const isExpanded = expandedValidator === d.validator;

            return (
              <div key={d.validator} className={`glass-card ${isExpanded ? 'border-[rgba(var(--c-accent-rgb),0.3)]' : ''}`}>
                <button
                  onClick={() => toggleExpand(d.validator)}
                  className="w-full p-3 flex items-center gap-3 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--c-text)] truncate">{truncAddr(d.validator)}</span>
                      {validator && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[validator.status] || STATUS_COLORS.exited}`}>
                          {validator.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[var(--c-text-dim)]">
                      <span>{t.staking.currentDelegation}: <span className="text-[var(--c-text)] font-semibold tabular-nums">{formatBalance(d.amount)} GF</span></span>
                      <span>{t.staking.delegatedSince}: <span className="text-[var(--c-text)] tabular-nums">{new Date(d.since_unix * 1000).toLocaleDateString()}</span></span>
                    </div>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-[var(--c-text-dim)] shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-[var(--c-text-dim)] shrink-0" />
                  }
                </button>

                {isExpanded && validator && (
                  <div className="border-t border-white/[0.06] p-3 flex flex-col gap-3">
                    {validator && (
                      <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[var(--c-text-dim)]">{t.staking.earningsEstimate}</span>
                          <span className="text-green-400 font-semibold tabular-nums">{estimateEarnings(validator, d.amount)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--c-text-dim)]">{t.staking.commissionRate}</span>
                          <span className="text-[var(--c-text)] font-semibold tabular-nums">{bpsToPercent(effectiveCommissionBPS(validator))}{!validator.commission_rate_bps && <span className="text-[var(--c-text-dim)] text-[10px] ml-1">({t.staking.defaultRate})</span>}</span>
                        </div>
                      </div>
                    )}

                    {/* Quick delegate */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-[var(--c-text-dim)] font-semibold">{t.staking.delegate}</label>
                      <div className="flex gap-2">
                        <input
                          className="input-field text-sm flex-1"
                          type="number"
                          step="any"
                          min="0"
                          placeholder={t.staking.delegateAmount}
                          value={delegateAmount}
                          onChange={(e) => { setDelegateAmount(e.target.value); setError(''); }}
                        />
                        <button
                          onClick={() => handleDelegate(d.validator)}
                          disabled={actionLoading === `delegate-${d.validator}` || !delegateAmount}
                          className="btn-primary px-4 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                        >
                          {actionLoading === `delegate-${d.validator}` ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : t.staking.delegate}
                        </button>
                      </div>
                    </div>

                    {/* Quick undelegate */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-[var(--c-text-dim)] font-semibold">{t.staking.undelegate}</label>
                      <div className="flex gap-2">
                        <input
                          className="input-field text-sm flex-1"
                          type="number"
                          step="any"
                          min="0"
                          placeholder={t.staking.undelegateAmount}
                          value={undelegateAmount}
                          onChange={(e) => { setUndelegateAmount(e.target.value); setError(''); }}
                        />
                        <button
                          onClick={() => handleUndelegate(d.validator)}
                          disabled={actionLoading === `undelegate-${d.validator}` || !undelegateAmount}
                          className="btn-secondary px-4 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                        >
                          {actionLoading === `undelegate-${d.validator}` ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : t.staking.undelegate}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
