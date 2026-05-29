import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import type { ChainApi } from '@/lib/api';
import { uploadFile } from '@/lib/storage';
import type { UploadProgress } from '@/lib/storage';
import { uploadPrivateFile } from '@/lib/private-storage';
import {
  ArrowUpCircle,
  File,
  Upload,
  CheckCircle,
  XCircle,
  Loader2,
  Activity,
  Coins,
  Copy,
  Check,
} from 'lucide-react';

interface Props {
  api: ChainApi;
}

const DURATION_OPTIONS = [
  { key: '90day' as const, value: 90 * 86400 },
  { key: '1year' as const, value: 365 * 86400 },
  { key: '5year' as const, value: 5 * 365 * 86400 },
  { key: '10year' as const, value: 10 * 365 * 86400 },
  { key: '30year' as const, value: 30 * 365 * 86400 },
  { key: 'forever' as const, value: 0 },
];

const DATA_SHARDS = 3;
const PARITY_SHARDS = 1;

function computeProgress(p: UploadProgress): number {
  switch (p.stage) {
    case 'init':
      return 5;
    case 'erasure':
      return 10;
    case 'uploading': {
      if (p.shardsTotal === 0) return 15;
      return 10 + Math.round((p.shardsDone / p.shardsTotal) * 60);
    }
    case 'committing':
      return 75;
    case 'finalizing':
      return 90;
    case 'done':
      return 100;
    case 'error':
      return 0;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UploadPage({ api }: Props) {
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(90 * 86400);
  const [accessMode, setAccessMode] = useState<'private' | 'public'>('private');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<{ intentId: string; dealId: string; dataKeyBase64?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [copiedDataKey, setCopiedDataKey] = useState(false);

  const [estimatedFee, setEstimatedFee] = useState<number | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  useEffect(() => {
    if (!file) {
      setEstimatedFee(null);
      return;
    }
    let cancelled = false;
    const fetchQuote = async () => {
      setFeeLoading(true);
      try {
        const quote = await api.getStorageQuote({
          fileSize: file.size,
          erasure: { dataShards: DATA_SHARDS, parityShards: PARITY_SHARDS },
          policy: { class: 'standard', duration, redundancy: 'erasure' },
        });
        if (!cancelled) {
          setEstimatedFee(quote.requiredFee);
        }
      } catch {
        if (!cancelled) setEstimatedFee(null);
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    };
    fetchQuote();
    return () => { cancelled = true; };
  }, [file, duration, api]);

  const stageLabels: Record<UploadProgress['stage'], string> = {
    init: t.upload.stages.init,
    erasure: t.upload.stages.erasure,
    uploading: t.upload.stages.uploading,
    committing: t.upload.stages.committing,
    finalizing: t.upload.stages.finalizing,
    done: t.upload.stages.done,
    error: t.upload.stages.error,
  };

  const resetState = useCallback(() => {
    setFile(null);
    setUploading(false);
    setProgress(null);
    setResult(null);
    setError(null);
    setEstimatedFee(null);
  }, []);

  const handleFile = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  }, [handleFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      handleFile(selected);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFile]);

  const handleUpload = useCallback(async () => {
    if (!file || !selectedAccount) return;

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      if (accessMode === 'private') {
        const masterPrivateKey = await getPrivateKey(selectedAccount);
        if (!masterPrivateKey) {
          throw new Error('Master private key is required for private upload recovery');
        }
        const res = await uploadPrivateFile(api, file, selectedAccount, {
          dataShards: DATA_SHARDS,
          parityShards: PARITY_SHARDS,
          duration,
          ownerPrivateKey: masterPrivateKey,
          ownerAddress: selectedAccount,
          onProgress: (stage) => setProgress({
            stage: stage === 'encrypting' ? 'erasure' : stage === 'creating_intent' ? 'init' : stage as UploadProgress['stage'],
            segmentsTotal: 0,
            segmentsDone: 0,
            shardsTotal: 0,
            shardsDone: 0,
            currentSegment: 0,
          }),
        });
        setResult({ intentId: res.intentId, dealId: res.dealId, dataKeyBase64: res.dataKeyBase64 });
      } else {
        const res = await uploadFile(api, file, selectedAccount, {
          dataShards: DATA_SHARDS,
          parityShards: PARITY_SHARDS,
          duration,
          onProgress: (p) => setProgress({ ...p }),
        });
        setResult(res);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setProgress((prev) =>
        prev
          ? { ...prev, stage: 'error', error: err?.message || String(err) }
          : {
              stage: 'error',
              segmentsTotal: 0,
              segmentsDone: 0,
              shardsTotal: 0,
              shardsDone: 0,
              currentSegment: 0,
              error: err?.message || String(err),
            },
      );
    } finally {
      setUploading(false);
    }
  }, [file, selectedAccount, api, duration, accessMode, getPrivateKey]);

  const percent = progress ? computeProgress(progress) : 0;

  if (!selectedAccount) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
        <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center">
          <ArrowUpCircle className="w-6 h-6 text-slate-500" />
        </div>
        <p className="text-sm text-slate-400">{t.upload.noAccount}</p>
        <p className="text-xs text-slate-500">{t.upload.noAccountHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-2">
        <ArrowUpCircle className="w-5 h-5 text-blue-400" />
        <h2 className="text-sm font-semibold text-white">{t.upload.title}</h2>
      </div>

      {result && !error ? (
        <div className="glass-card p-5 flex flex-col items-center gap-3">
          <CheckCircle className="w-10 h-10 text-green-400" />
          <h3 className="text-sm font-semibold text-white">{t.upload.complete}</h3>
          <div className="w-full space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">{t.upload.intentId}</span>
              <span className="text-slate-300 font-mono truncate ml-2 max-w-[180px]">
                {result.intentId}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">{t.upload.dealId}</span>
              <span className="text-slate-300 font-mono truncate ml-2 max-w-[180px]">
                {result.dealId}
              </span>
            </div>
          </div>
          {result.dataKeyBase64 && (
            <div className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-blue-300">
                  {t.wallet.dataKeyLabel}
                </span>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(result.dataKeyBase64!);
                    } catch {
                      const ta = document.createElement('textarea');
                      ta.value = result.dataKeyBase64!;
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                    setCopiedDataKey(true);
                    setTimeout(() => setCopiedDataKey(false), 2000);
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-300/80 hover:bg-blue-500/10 hover:text-blue-300"
                >
                  {copiedDataKey ? (
                    <Check className="h-3 w-3 text-green-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedDataKey ? t.wallet.copiedSecret : t.dashboard.copyAddress}
                </button>
              </div>
              <code className="block break-all text-[10px] leading-relaxed text-blue-300">
                {result.dataKeyBase64}
              </code>
              <p className="mt-1.5 text-[10px] leading-relaxed text-blue-300/70">
                {t.wallet.dataKeyWarning}
              </p>
            </div>
          )}
          <button className="btn-secondary w-full mt-1" onClick={resetState}>
            {t.upload.uploadAnother}
          </button>
        </div>
      ) : (
        <>
          <div
            className={`glass-card p-5 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 min-h-[140px] ${
              dragActive
                ? 'border-blue-400/50 bg-blue-500/[0.06]'
                : 'hover:border-white/[0.1]'
            } ${file ? 'border-green-500/30' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />

            {file ? (
              <div className="flex flex-col items-center gap-2">
                <File className="w-8 h-8 text-blue-400" />
                <p className="text-sm font-medium text-white truncate max-w-[260px]">
                  {file.name}
                </p>
                <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-slate-500" />
                <p className="text-sm text-slate-400">
                  {dragActive ? t.upload.dropHere : t.upload.clickOrDrag}
                </p>
                <p className="text-xs text-slate-500">{t.upload.anyType}</p>
              </div>
            )}
          </div>

          {file && (
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                <Coins className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400">{t.upload.estimatedFee}</p>
                {feeLoading ? (
                  <div className="w-24 h-5 bg-white/[0.04] rounded animate-pulse mt-0.5" />
                ) : estimatedFee !== null ? (
                  <p className="text-base font-bold text-[var(--c-text)] tabular-nums">
                    {estimatedFee.toFixed(4)} <span className="text-sm font-semibold text-[var(--c-text-dim)]">GF</span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-0.5">{t.upload.feeUnavailable}</p>
                )}
              </div>
            </div>
          )}

          <div className="glass-card p-4 space-y-3">
            <span className="text-xs text-slate-400">访问权限</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all duration-200 border min-w-0 ${
                  accessMode === 'private'
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                    : 'border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.1]'
                }`}
                onClick={() => setAccessMode('private')}
                disabled={uploading}
              >
                私有
              </button>
              <button
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-all duration-200 border min-w-0 ${
                  accessMode === 'public'
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                    : 'border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.1]'
                }`}
                onClick={() => setAccessMode('public')}
                disabled={uploading}
              >
                公开
              </button>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {accessMode === 'private'
                ? '客户端会用主钱包派生 Storage Vault Key，并为 owner 创建可恢复的 Key Envelope。换电脑导入主钱包后仍可解密。'
                : '公开模式保留共用 CID 语义，同一内容可被多用户复用。'}
            </p>
          </div>

          <div className="glass-card p-4 space-y-3">
            <span className="text-xs text-slate-400">{t.upload.duration}</span>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-all duration-200 border min-w-0 ${
                    duration === opt.value
                      ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                      : 'border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.1]'
                  }`}
                  onClick={() => setDuration(opt.value)}
                  disabled={uploading}
                >
                  {(t.upload.durationOptions as Record<string, string>)[opt.key] || opt.key}
                </button>
              ))}
            </div>
          </div>

          <button
            className={`btn-primary w-full flex items-center justify-center gap-2 py-3 ${
              uploading ? 'opacity-70' : ''
            }`}
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.upload.uploading}
              </>
            ) : (
              <>
                <ArrowUpCircle className="w-4 h-4" />
                {t.upload.uploadBtn}
              </>
            )}
          </button>

          {progress && (
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                {progress.stage === 'error' ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : progress.stage === 'done' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
                )}
                <span className="text-xs font-medium text-white">
                  {stageLabels[progress.stage]}
                </span>
              </div>

              <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    progress.stage === 'error'
                      ? 'bg-red-500'
                      : progress.stage === 'done'
                        ? 'bg-green-500'
                        : 'bg-gradient-to-r from-blue-500 to-purple-500'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              {progress.stage !== 'error' && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2 text-xs">
                  <div className="flex justify-between gap-2 text-slate-500 min-w-0">
                    <span>{t.upload.segments}</span>
                    <span className="text-slate-300">
                      {progress.segmentsDone}/{progress.segmentsTotal}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-slate-500 min-w-0">
                    <span>{t.upload.shards}</span>
                    <span className="text-slate-300">
                      {progress.shardsDone}/{progress.shardsTotal}
                    </span>
                  </div>
                </div>
              )}

              {progress.stage === 'error' && progress.error && (
                <p className="text-xs text-red-400 break-all">{progress.error}</p>
              )}
            </div>
          )}

          {error && !progress && (
            <div className="glass-card p-3 flex items-start gap-2 border-red-500/20">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400 break-all">{error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
