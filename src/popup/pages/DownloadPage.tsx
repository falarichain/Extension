import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import type { ChainApi } from '@/lib/api';
import { downloadFile } from '@/lib/storage';
import {
  ArrowDownCircle,
  Download,
  Search,
  Loader2,
  File,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface Props {
  api: ChainApi;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DownloadPage({ api }: Props) {
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const { t } = useI18n();

  const [intentId, setIntentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [manifest, setManifest] = useState<{
    fileName: string;
    fileSize: number;
    status: string;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!intentId.trim()) return;
    setLoading(true);
    setError(null);
    setManifest(null);
    setDownloadComplete(false);

    try {
      const result = await api.getManifest(intentId.trim());
      setManifest({
        fileName: result.plan.fileName,
        fileSize: result.plan.fileSize,
        status: result.status,
      });
    } catch (err: any) {
      setError(err?.message || t.download.fetchFail);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!intentId.trim() || !selectedAccount) return;
    setDownloading(true);
    setDownloadProgress(0);
    setError(null);
    setDownloadComplete(false);

    try {
      const progressInterval = setInterval(() => {
        setDownloadProgress((p) => Math.min(p + 10, 90));
      }, 500);

      const result = await downloadFile(api, intentId.trim(), selectedAccount);

      clearInterval(progressInterval);
      setDownloadProgress(100);

      const blob = new Blob([result.data as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDownloadComplete(true);
    } catch (err: any) {
      setError(err?.message || t.download.downloadFail);
      setDownloadProgress(0);
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setIntentId('');
    setManifest(null);
    setDownloadComplete(false);
    setDownloadProgress(0);
    setError(null);
  };

  if (!selectedAccount) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
        <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center">
          <ArrowDownCircle className="w-6 h-6 text-slate-500" />
        </div>
        <p className="text-sm text-slate-400">{t.download.noAccount}</p>
        <p className="text-xs text-slate-500">{t.download.noAccountHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-2">
        <ArrowDownCircle className="w-5 h-5 text-blue-400" />
        <h2 className="text-sm font-semibold text-white">{t.download.title}</h2>
      </div>

      {downloadComplete ? (
        <div className="glass-card p-5 flex flex-col items-center gap-3">
          <CheckCircle className="w-10 h-10 text-green-400" />
          <h3 className="text-sm font-semibold text-white">{t.download.complete}</h3>
          {manifest && (
            <p className="text-xs text-slate-400 break-all text-center">{manifest.fileName}</p>
          )}
          <button className="btn-secondary w-full mt-1" onClick={handleReset}>
            {t.download.downloadAnother}
          </button>
        </div>
      ) : (
        <>
          <div className="glass-card p-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              className="input-field flex-1 min-w-[180px]"
              placeholder={t.download.placeholder}
              value={intentId}
              onChange={(e) => setIntentId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              disabled={loading || downloading}
            />
            <button
              className="btn-primary flex items-center justify-center gap-1.5 px-3 py-2 shrink-0"
              onClick={handleSearch}
              disabled={loading || downloading || !intentId.trim()}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span className="text-xs">{t.download.search}</span>
            </button>
          </div>

          {error && (
            <div className="glass-card p-3 flex items-start gap-2 border-red-500/20">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400 break-all">{error}</p>
            </div>
          )}

          {manifest && (
            <div className="glass-card p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <File className="w-8 h-8 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {manifest.fileName}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatSize(manifest.fileSize)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">{t.download.status}</span>
                <span
                  className={`font-medium ${
                    manifest.status === 'finalized'
                      ? 'text-green-400'
                      : 'text-yellow-400'
                  }`}
                >
                  {manifest.status}
                </span>
              </div>

              <button
                className="btn-primary w-full flex items-center justify-center gap-2 py-3"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.download.downloading}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    {t.download.downloadBtn}
                  </>
                )}
              </button>

              {downloading && (
                <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
