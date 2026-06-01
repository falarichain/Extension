import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChainApi } from '@/lib/api';
import { TOKEN_UNIT } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { FileText, RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle, HardDrive } from 'lucide-react';

interface DataPageProps {
  api: ChainApi;
}

interface IntentRow {
  intent_id: string;
  file_name: string;
  file_size: number;
  status: string;
  storage_status?: string;
  locked_fee: number;
  burned_fee?: number;
  paid_fee?: number;
  refunded_fee?: number;
  burn_deferred?: boolean;
  uploaded_size: number;
  committed_segments?: number;
  created_at_unix?: number;
  expires_at_unix?: number;
  deal_id?: string;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatFee(amount: number): string {
  const v = amount / TOKEN_UNIT;
  if (v === 0) return '0';
  if (v >= 1) return parseFloat(v.toFixed(4)).toString();
  return parseFloat(v.toFixed(8)).toString();
}

function statusIcon(status: string) {
  switch (status) {
    case 'active':
    case 'finalized':
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    case 'pending':
    case 'committed':
      return <Clock className="w-4 h-4 text-yellow-400" />;
    case 'expired':
    case 'settled':
      return <AlertCircle className="w-4 h-4 text-orange-400" />;
    case 'terminated':
      return <XCircle className="w-4 h-4 text-red-400" />;
    default:
      return <Clock className="w-4 h-4 text-[var(--c-text-dimmer)]" />;
  }
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending',
    committed: 'Committed',
    finalized: 'Finalized',
    active: 'Active',
    expired: 'Expired',
    settled: 'Settled',
    terminated: 'Terminated',
  };
  return labels[status] || status;
}

export function DataPage({ api }: DataPageProps) {
  const { t } = useI18n();
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchIntents = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await api.listUserIntents(selectedAccount);
      const list = (resp as any)?.intents || [];
      setIntents(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load intents');
      setIntents([]);
    } finally {
      setLoading(false);
    }
  }, [api, selectedAccount]);

  useEffect(() => {
    fetchIntents();
  }, [fetchIntents]);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="icon-tile icon-tile-blue w-8 h-8">
            <HardDrive className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[var(--c-text)]">
              {t.data?.title || 'Data Management'}
            </h2>
            <p className="text-[11px] text-[var(--c-text-dim)]">
              {t.data?.subtitle || 'Your storage intents'}
            </p>
          </div>
        </div>
        <button
          onClick={fetchIntents}
          disabled={loading}
          className="w-8 h-8 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] flex items-center justify-center hover:bg-[var(--c-surface-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-[var(--c-text-dim)] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* No account */}
      {!selectedAccount && (
        <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] px-4 py-8 text-center">
          <p className="text-xs text-[var(--c-text-dim)]">{t.dashboard?.noAccount || 'No account selected'}</p>
        </div>
      )}

      {/* Empty */}
      {selectedAccount && !loading && intents.length === 0 && !error && (
        <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] px-4 py-8 text-center">
          <FileText className="w-8 h-8 text-[var(--c-text-dimmer)] mx-auto mb-2" />
          <p className="text-xs text-[var(--c-text-dim)]">{t.data?.empty || 'No storage intents found'}</p>
        </div>
      )}

      {/* Intent list */}
      <div className="flex flex-col gap-2">
        {intents.map((intent) => {
          const expanded = expandedId === intent.intent_id;
          return (
            <button
              key={intent.intent_id}
              onClick={() => setExpandedId(expanded ? null : intent.intent_id)}
              className={`w-full text-left rounded-lg border bg-[var(--c-surface)] px-3 py-2.5 transition-colors ${
                expanded ? 'border-[var(--c-accent)]/40' : 'border-[var(--c-border)] hover:border-[var(--c-border-hover)]'
              }`}
            >
              {/* Row header */}
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--c-bg)] shrink-0">
                  <FileText className="w-4 h-4 text-[var(--c-text-dim)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--c-text)] truncate">
                      {intent.file_name || intent.intent_id.slice(0, 12)}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {statusIcon(intent.status)}
                      <span className="text-[11px] font-medium text-[var(--c-text-dim)]">
                        {statusLabel(intent.status)}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[11px] text-[var(--c-text-dimmer)]">
                      {formatSize(intent.file_size)}
                    </span>
                    <span className="text-[11px] text-[var(--c-text-dimmer)]">
                      {formatFee(intent.locked_fee)} Token
                    </span>
                    {intent.burn_deferred && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">
                        Deferred
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className={`w-4 h-4 text-[var(--c-text-dimmer)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>

              {/* Expanded details */}
              {expanded && (
                <div className="mt-2.5 pt-2.5 border-t border-[var(--c-border)] flex flex-col gap-1.5">
                  <DetailRow label="Intent ID" value={intent.intent_id} mono />
                  {intent.deal_id && <DetailRow label="Deal ID" value={intent.deal_id} mono />}
                  <DetailRow label="Locked Fee" value={`${formatFee(intent.locked_fee)} Token`} />
                  {intent.burned_fee != null && intent.burned_fee > 0 && (
                    <DetailRow label="Burned" value={`${formatFee(intent.burned_fee)} Token`} />
                  )}
                  {intent.paid_fee != null && intent.paid_fee > 0 && (
                    <DetailRow label="Paid" value={`${formatFee(intent.paid_fee)} Token`} />
                  )}
                  {intent.refunded_fee != null && intent.refunded_fee > 0 && (
                    <DetailRow label="Refunded" value={`${formatFee(intent.refunded_fee)} Token`} />
                  )}
                  <DetailRow label="Size" value={`${formatSize(intent.file_size)} (${formatSize(intent.uploaded_size)} uploaded)`} />
                  {intent.committed_segments != null && (
                    <DetailRow label="Segments" value={`${intent.committed_segments} committed`} />
                  )}
                  {intent.expires_at_unix != null && intent.expires_at_unix > 0 && (
                    <DetailRow label="Expires" value={new Date(intent.expires_at_unix * 1000).toLocaleString()} />
                  )}
                  {intent.created_at_unix != null && intent.created_at_unix > 0 && (
                    <DetailRow label="Created" value={new Date(intent.created_at_unix * 1000).toLocaleString()} />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[var(--c-text-dimmer)] shrink-0">{label}</span>
      <span className={`text-[11px] text-[var(--c-text-dim)] truncate ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
