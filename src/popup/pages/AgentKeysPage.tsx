import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { ChainApi } from '@/lib/api';
import {
  generateLocalAgentKey,
  registerAgentKey,
  revokeAgentKey,
  updateAgentKeyEncodedString,
} from '@/lib/agent-key';
import type { LocalAgentKey } from '@/lib/types';
import { ALLOWED_PERMISSIONS } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import {
  Shield,
  Plus,
  Trash2,
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
  Clock,
  AlertCircle,
  Ban,
  RefreshCw,
  Download,
} from 'lucide-react';
import { normalizeAddress } from '@/lib/crypto';
import { accountAddressFromPublicKey } from '@/lib/crypto';

interface AgentKeysPageProps {
  api: ChainApi;
}

function formatExpiry(expiresAt: number, neverLabel: string, expiredLabel: string): string {
  if (expiresAt === 0) return neverLabel;
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return expiredLabel;
  const days = Math.ceil(diff / 86400);
  if (days > 365) return `${Math.floor(days / 365)}y ${days % 365}d`;
  if (days > 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  return `${days}d`;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function AgentKeysPage({ api }: AgentKeysPageProps) {
  const { t } = useI18n();

  const agentKeys = useAppStore((s) => s.agentKeys);
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const accounts = useAppStore((s) => s.accounts);
  const addAgentKey = useAppStore((s) => s.addAgentKey);
  const updateAgentKey = useAppStore((s) => s.updateAgentKey);
  const removeAgentKey = useAppStore((s) => s.removeAgentKey);
  const setAgentKeys = useAppStore((s) => s.setAgentKeys);
  const saveState = useAppStore((s) => s.saveState);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);

  const [tab, setTab] = useState<'my-keys' | 'create'>('my-keys');

  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState<Record<string, boolean>>({});
  const [copiedString, setCopiedString] = useState<string | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState('');

  const [name, setName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [dailyLimit, setDailyLimit] = useState('100');
  const [totalLimit, setTotalLimit] = useState('10000');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const currentAccount = accounts.find((a) => a.address === selectedAccount) ?? null;
  const masterAddress = currentAccount?.address ?? '';

  const fetchChainKeys = useCallback(async () => {
    if (!masterAddress) return;
    setFetchError('');
    setFetching(true);
    try {
      const result = await api.listAgentKeys(masterAddress);
      const keys = (result.keys || []) as any[];

      const existingMap = new Map<string, LocalAgentKey>();
      for (const k of agentKeys) {
        existingMap.set(k.keyId, k);
      }

      const mergedKeys = [...agentKeys];
      for (const chainKey of keys) {
        const keyId = chainKey.key_id || chainKey.keyId;
        const agentPub = chainKey.agent_pub || chainKey.agentPub || '';
        let agentAddress = chainKey.address || '';
        if (!agentAddress && agentPub) {
          try {
            agentAddress = accountAddressFromPublicKey(agentPub);
          } catch {
            agentAddress = agentPub;
          }
        }
        if (existingMap.has(keyId)) {
          const local = existingMap.get(keyId)!;
          const updated = {
            name: chainKey.name || local.name,
            permissions: chainKey.permissions || local.permissions,
            dailyLimit: chainKey.daily_limit ?? local.dailyLimit,
            totalLimit: chainKey.total_limit ?? local.totalLimit,
            expiresAt: chainKey.expires_at ?? local.expiresAt,
            createdAt: chainKey.created_at ?? local.createdAt,
            address: agentAddress || local.address,
            registered: true,
            revoked: chainKey.revoked || false,
            hasPrivateKey: !!local.privateKey,
            remoteOnly: !local.privateKey,
          };
          updateAgentKey(keyId, updated);
          const index = mergedKeys.findIndex((item) => item.keyId === keyId);
          if (index >= 0) {
            mergedKeys[index] = { ...mergedKeys[index], ...updated };
          }
        } else {
          mergedKeys.push({
            keyId,
            name: chainKey.name || keyId || 'Chain Agent Key',
            master: masterAddress,
            address: agentAddress,
            privateKey: '',
            encodedString: '',
            permissions: chainKey.permissions || [],
            dailyLimit: chainKey.daily_limit ?? 0,
            totalLimit: chainKey.total_limit ?? 0,
            expiresAt: chainKey.expires_at ?? 0,
            createdAt: chainKey.created_at ?? Math.floor(Date.now() / 1000),
            registered: true,
            revoked: chainKey.revoked || false,
            hasPrivateKey: false,
            remoteOnly: true,
          });
        }
      }
      setAgentKeys(mergedKeys);
      await saveState();
    } catch (err: any) {
      setFetchError(err.message || 'Failed to fetch agent keys from chain');
    } finally {
      setFetching(false);
    }
  }, [masterAddress, api, agentKeys, updateAgentKey, setAgentKeys, saveState]);

  useEffect(() => {
    if (masterAddress) {
      fetchChainKeys();
    }
  }, [masterAddress]);

  const handleCopyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedString(key);
      setTimeout(() => setCopiedString(null), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedString(key);
      setTimeout(() => setCopiedString(null), 2000);
    }
  }, []);

  const handleCreateKey = useCallback(async () => {
    setCreateError('');
    setCreateSuccess('');

    if (!name.trim()) {
      setCreateError(t.agentKeys.keyRequired);
      return;
    }
    if (!masterAddress) {
      setCreateError(t.agentKeys.noAccount);
      return;
    }
    if (selectedPermissions.length === 0) {
      setCreateError(t.agentKeys.permRequired);
      return;
    }

    const daily = parseInt(dailyLimit, 10);
    if (isNaN(daily) || daily < 0) {
      setCreateError(t.agentKeys.invalidDaily);
      return;
    }
    const total = parseInt(totalLimit, 10);
    if (isNaN(total) || total < 0) {
      setCreateError(t.agentKeys.invalidTotal);
      return;
    }
    const days = parseInt(expiresInDays, 10);
    if (isNaN(days) || days <= 0) {
      setCreateError(t.agentKeys.invalidExpiry);
      return;
    }

    try {
      setCreating(true);
      const masterPrivateKey = await getPrivateKey(masterAddress);
      if (!masterPrivateKey) {
        setCreateError(t.agentKeys.pkNotFound);
        return;
      }

      const expiresAt = Math.floor(Date.now() / 1000) + days * 86400;

      let key = await generateLocalAgentKey(
        masterAddress,
        masterPrivateKey,
        name.trim(),
        selectedPermissions,
        daily,
        total,
        expiresAt,
      );

      const result = await registerAgentKey(api, key, masterPrivateKey);
      if (!result.success) {
        setCreateError(t.agentKeys.registerFailed.replace('{error}', result.error || 'Unknown error'));
        return;
      }
      key = { ...key, keyId: result.keyId, registered: true };
      key = updateAgentKeyEncodedString(key);
      addAgentKey(key);
      await saveState();
      setCreateSuccess(t.agentKeys.registered);
      fetchChainKeys();

      setName('');
      setSelectedPermissions([]);
      setDailyLimit('100');
      setTotalLimit('10000');
      setExpiresInDays('30');
      setTab('my-keys');
      setTimeout(() => setCreateSuccess(''), 3000);
    } catch (err: any) {
      setCreateError(err.message || t.agentKeys.createFailed);
    } finally {
      setCreating(false);
    }
  }, [
    name,
    masterAddress,
    selectedPermissions,
    dailyLimit,
    totalLimit,
    expiresInDays,
    getPrivateKey,
    api,
    addAgentKey,
    saveState,
    fetchChainKeys,
    t,
  ]);

  const handleRevokeKey = useCallback(
    async (key: LocalAgentKey) => {
      setRevokeError('');
      if (!key.keyId || !key.registered) return;

      try {
        setRevokingKeyId(key.keyId);
        const masterPrivateKey = await getPrivateKey(key.master);
        if (!masterPrivateKey) {
          setRevokeError(t.agentKeys.masterPkNotFound);
          return;
        }

        const result = await revokeAgentKey(api, key.keyId, key.master, masterPrivateKey);
        if (result.success) {
          updateAgentKey(key.keyId, { revoked: true });
          await saveState();
        } else {
          setRevokeError(result.error || t.agentKeys.revokeFailed);
        }
      } catch (err: any) {
        setRevokeError(err.message || t.agentKeys.revokeFailedGeneric);
      } finally {
        setRevokingKeyId(null);
      }
    },
    [getPrivateKey, api, updateAgentKey, saveState, t],
  );

  const handleDeleteKey = useCallback(
    async (keyId: string) => {
      removeAgentKey(keyId);
      await saveState();
      setConfirmDeleteId(null);
      if (expandedKeyId === keyId) {
        setExpandedKeyId(null);
      }
    },
    [removeAgentKey, saveState, expandedKeyId],
  );

  const getStatusBadge = (key: LocalAgentKey) => {
    if (key.revoked) {
      return (
        <span className="badge bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
          <Ban className="w-3 h-3 mr-1" />
          {t.agentKeys.revoked}
        </span>
      );
    }
    if (key.registered) {
      return (
        <span className={`badge ${key.privateKey ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'} text-[10px]`}>
          <Shield className="w-3 h-3 mr-1" />
          {key.privateKey ? t.agentKeys.registeredStatus : '链上记录'}
        </span>
      );
    }
    return (
      <span className="badge bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-[10px]">
        <AlertCircle className="w-3 h-3 mr-1" />
        {t.agentKeys.localOnly}
      </span>
    );
  };

  const isExpired = (expiresAt: number) => {
    if (expiresAt === 0) return false;
    return expiresAt <= Math.floor(Date.now() / 1000);
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-4 h-4 text-purple-400" />
          <span className="text-[13px] font-semibold text-white truncate">{t.agentKeys.title}</span>
          <span className="text-[11px] text-slate-500">({agentKeys.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchChainKeys}
            disabled={fetching || !masterAddress}
            className="w-7 h-7 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
          >
            <RefreshCw className={`w-3 h-3 text-slate-400 ${fetching ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
            <button
              onClick={() => setTab('my-keys')}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                tab === 'my-keys'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.agentKeys.myKeys}
            </button>
            <button
              onClick={() => setTab('create')}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                tab === 'create'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.agentKeys.createKey}
            </button>
          </div>
        </div>
      </div>

      {fetchError && (
        <div className="glass-card p-3 flex items-center gap-2 border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-[11px] text-red-400">{fetchError}</p>
          <button
            onClick={() => setFetchError('')}
            className="ml-auto text-[11px] text-slate-500 hover:text-slate-300"
          >
            {t.agentKeys.dismiss}
          </button>
        </div>
      )}

      {revokeError && (
        <div className="glass-card p-3 flex items-center gap-2 border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-[11px] text-red-400">{revokeError}</p>
          <button
            onClick={() => setRevokeError('')}
            className="ml-auto text-[11px] text-slate-500 hover:text-slate-300"
          >
            {t.agentKeys.dismiss}
          </button>
        </div>
      )}

      {tab === 'my-keys' && (
        <>
          {!masterAddress ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8 px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-white/[0.06] flex items-center justify-center">
                <Key className="w-8 h-8 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-white">{t.agentKeys.selectAccountFirst}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Select a wallet address from the top dropdown to manage Agent Keys.
                </p>
              </div>
            </div>
          ) : agentKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8 px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-white/[0.06] flex items-center justify-center">
                <Key className="w-8 h-8 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-white">{t.agentKeys.noKeys}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {t.agentKeys.noKeysHint}
                </p>
              </div>
              <button
                onClick={() => setTab('create')}
                className="btn-primary flex items-center justify-center gap-2 py-3 px-6"
              >
                <Plus className="w-4 h-4" />
                <span>{t.agentKeys.createBtn}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {agentKeys.map((key) => {
                const expanded = expandedKeyId === (key.keyId || key.address);
                const expired = isExpired(key.expiresAt);

                return (
                  <div
                    key={key.keyId || key.address}
                    className={`glass-card flex flex-col transition-all duration-200 ${
                      expanded ? 'border-purple-400/30 ring-1 ring-purple-400/20' : ''
                    }`}
                  >
                    <div
                      className="p-3 flex items-center justify-between cursor-pointer"
                      onClick={() =>
                        setExpandedKeyId(
                          expanded ? null : (key.keyId || key.address),
                        )
                      }
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            expanded
                              ? 'bg-gradient-to-br from-purple-500/30 to-pink-600/30'
                              : 'bg-white/[0.04]'
                          }`}
                        >
                          <Key
                            className={`w-4 h-4 ${
                              expanded ? 'text-purple-400' : 'text-slate-400'
                            }`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[12px] font-medium text-white truncate">
                              {key.name}
                            </p>
                            {getStatusBadge(key)}
                          </div>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {key.keyId
                              ? `ID: ${truncateAddress(key.keyId)}`
                              : `Addr: ${truncateAddress(key.address)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {expired && (
                          <span className="badge bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                            <Clock className="w-3 h-3 mr-0.5" />
                            {t.agentKeys.expired}
                          </span>
                        )}
                        {key.registered && !key.revoked && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRevokeKey(key);
                            }}
                            disabled={revokingKeyId === key.keyId}
                            className="w-7 h-7 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
                          >
                            {revokingKeyId === key.keyId ? (
                              <RefreshCw className="w-3 h-3 text-red-400 animate-spin" />
                            ) : (
                              <Ban className="w-3 h-3 text-slate-500 hover:text-red-400" />
                            )}
                          </button>
                        )}
                        {confirmDeleteId === (key.keyId || key.address) ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteKey(key.keyId || key.address);
                              }}
                              className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-colors"
                            >
                              <Check className="w-3 h-3 text-red-400" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(null);
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
                              setConfirmDeleteId(key.keyId || key.address);
                            }}
                            className="w-7 h-7 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
                          >
                            <Trash2 className="w-3 h-3 text-slate-500" />
                          </button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="px-3 pb-3 flex flex-col gap-2.5 border-t border-white/[0.04] pt-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500">{t.agentKeys.dailyLimit}</span>
                            <span className="text-[12px] font-semibold text-white tabular-nums">
                              {key.dailyLimit.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500">{t.agentKeys.totalLimit}</span>
                            <span className="text-[12px] font-semibold text-white tabular-nums">
                              {key.totalLimit.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500">{t.agentKeys.expires}</span>
                            <span
                              className={`text-[12px] font-semibold tabular-nums ${expired ? 'text-red-400' : 'text-white'}`}
                            >
                              {formatExpiry(key.expiresAt, t.agentKeys.never, t.agentKeys.expired)}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500">{t.agentKeys.created}</span>
                            <span className="text-[12px] font-semibold text-white tabular-nums">
                              {new Date(key.createdAt * 1000).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500">{t.agentKeys.status}</span>
                            <span className="text-[12px] font-semibold text-white">
                              {key.revoked ? t.agentKeys.revoked : key.registered ? (key.privateKey ? t.agentKeys.registeredStatus : '链上存在，本机无私钥') : t.agentKeys.local}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500">{t.agentKeys.keyId}</span>
                            <span className="text-[12px] font-semibold text-white tabular-nums truncate">
                              {key.keyId ? truncateAddress(key.keyId) : '—'}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-500">{t.agentKeys.permissions}</span>
                          <div className="flex flex-wrap gap-1">
                            {key.permissions.map((perm) => (
                              <span
                                key={perm}
                                className="badge bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]"
                              >
                                {(t.agentKeys.permLabels as Record<string, string>)[perm] || perm}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-500">{t.agentKeys.agentAddress}</span>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[11px] text-slate-300 bg-white/[0.04] px-2 py-1 rounded flex-1 truncate">
                              {key.address}
                            </code>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyText(key.address, `addr-${key.address}`);
                              }}
                              className="w-6 h-6 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors shrink-0"
                            >
                              {copiedString === `addr-${key.address}` ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3 text-slate-500" />
                              )}
                            </button>
                          </div>
                        </div>

                        {key.privateKey ? (
                          <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-500">{t.agentKeys.encodedString}</span>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[10px] text-slate-300 bg-white/[0.04] px-2 py-1 rounded flex-1 break-all leading-relaxed">
                              {showPrivateKey[key.keyId || key.address]
                                ? key.encodedString
                                : key.encodedString.slice(0, 24) + '••••••••'}
                            </code>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const k = key.keyId || key.address;
                                setShowPrivateKey((p) => ({
                                  ...p,
                                  [k]: !p[k],
                                }));
                              }}
                              className="w-6 h-6 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors shrink-0"
                            >
                              {showPrivateKey[key.keyId || key.address] ? (
                                <EyeOff className="w-3 h-3 text-slate-500" />
                              ) : (
                                <Eye className="w-3 h-3 text-slate-500" />
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyText(
                                  key.encodedString,
                                  `encoded-${key.address}`,
                                );
                              }}
                              className="w-6 h-6 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors shrink-0"
                            >
                              {copiedString === `encoded-${key.address}` ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3 text-slate-500" />
                              )}
                            </button>
                          </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-2.5">
                            <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-blue-200 leading-relaxed">
                              这个 Agent Key 是从链上恢复的记录，本机没有私钥。你可以用主钱包撤销它，但不能继续使用它执行 Agent 操作。
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="glass-card p-4 flex flex-col items-center gap-2">
            <p className="text-[11px] text-slate-500 text-center">
              Agent Keys are always registered on-chain and fetched from the chain for the selected wallet address.
            </p>
            <button
              onClick={() => setTab('create')}
              className="btn-primary flex items-center justify-center gap-2 py-2 px-4 text-[13px]"
              disabled={!masterAddress}
            >
              <Plus className="w-4 h-4" />
              <span>{t.agentKeys.createBtn}</span>
            </button>
          </div>
        </>
      )}

      {tab === 'create' && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-purple-400" />
            <span className="text-[13px] font-semibold text-white">{t.agentKeys.createTitle}</span>
          </div>

          {!masterAddress && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0" />
              <p className="text-[11px] text-yellow-400">
                {t.agentKeys.selectAccountFirst}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500">{t.agentKeys.keyName}</label>
            <input
              className="input-field text-[13px]"
              placeholder={t.agentKeys.keyNamePlaceholder}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setCreateError('');
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500">{t.agentKeys.permissions}</label>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-1.5">
              {ALLOWED_PERMISSIONS.map((perm) => {
                const checked = selectedPermissions.includes(perm);
                return (
                  <label
                    key={perm}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                      checked
                        ? 'bg-purple-500/10 border-purple-500/30'
                        : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedPermissions((prev) =>
                          checked
                            ? prev.filter((p) => p !== perm)
                            : [...prev, perm],
                        );
                        setCreateError('');
                      }}
                      className="sr-only"
                    />
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        checked
                          ? 'bg-purple-500 border-purple-500'
                          : 'border-slate-600'
                      }`}
                    >
                      {checked && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span
                      className={`text-[11px] font-medium ${
                        checked ? 'text-purple-300' : 'text-slate-400'
                      } truncate min-w-0`}
                    >
                      {(t.agentKeys.permLabels as Record<string, string>)[perm] || perm}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-slate-500">{t.agentKeys.dailyLimit}</label>
              <input
                className="input-field text-[13px]"
                type="number"
                min="0"
                value={dailyLimit}
                onChange={(e) => {
                  setDailyLimit(e.target.value);
                  setCreateError('');
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-slate-500">{t.agentKeys.totalLimit}</label>
              <input
                className="input-field text-[13px]"
                type="number"
                min="0"
                value={totalLimit}
                onChange={(e) => {
                  setTotalLimit(e.target.value);
                  setCreateError('');
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-slate-500">{t.agentKeys.expiresIn}</label>
            <input
              className="input-field text-[13px]"
              type="number"
              min="1"
              value={expiresInDays}
              onChange={(e) => {
                setExpiresInDays(e.target.value);
                setCreateError('');
              }}
            />
            <p className="text-[10px] text-slate-600">
              {t.agentKeys.expires}{' '}
              {new Date(
                Date.now() + parseInt(expiresInDays || '0', 10) * 86400000,
              ).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Shield className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <span className="text-[12px] font-medium text-white">{t.agentKeys.registerOnChain}</span>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Agent Key will be registered on-chain using your wallet's master key signature.
              </p>
            </div>
          </div>

          {createError && (
            <p className="text-[11px] text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {createError}
            </p>
          )}
          {createSuccess && (
            <p className="text-[11px] text-green-400 flex items-center gap-1">
              <Check className="w-3 h-3" />
              {createSuccess}
            </p>
          )}

          <button
            onClick={handleCreateKey}
            disabled={creating || !masterAddress}
            className="btn-primary flex items-center justify-center gap-2 py-2.5 text-[13px] disabled:opacity-50"
          >
            {creating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span>
              {creating ? t.agentKeys.creating : t.agentKeys.createRegisterBtn}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
