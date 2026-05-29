import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import type { ChainApi } from '@/lib/api';
import type { DataCollection } from '@/lib/types';
import { downloadFile } from '@/lib/storage';
import { downloadPrivateFile } from '@/lib/private-storage';
import { createCollection } from '@/lib/agent-key';
import {
  fetchCollectionFiles,
  downloadCollectionFiles,
  type CollectionFileStatus,
  type CollectionDownloadProgress,
} from '@/lib/collection-download';
import {
  ArrowDownCircle,
  Download,
  Search,
  Loader2,
  File,
  CheckCircle,
  XCircle,
  Lock,
  Globe,
  FolderOpen,
  Plus,
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

function truncateId(id: string, max = 12): string {
  if (id.length <= max) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

export function DownloadPage({ api }: Props) {
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const { t } = useI18n();

  const [mode, setMode] = useState<'single' | 'collection'>('single');

  // ── Single file state ──
  const [intentId, setIntentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [manifest, setManifest] = useState<{
    fileName: string;
    fileSize: number;
    status: string;
    encrypted: boolean;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Collection state ──
  const [collectionId, setCollectionId] = useState('');
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collection, setCollection] = useState<DataCollection | null>(null);
  const [collectionFiles, setCollectionFiles] = useState<CollectionFileStatus[]>([]);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<CollectionDownloadProgress | null>(null);
  const [batchComplete, setBatchComplete] = useState(false);
  const [batchResult, setBatchResult] = useState<{ succeeded: number; failed: number } | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  // ── My Collections state ──
  const [userCollections, setUserCollections] = useState<DataCollection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);

  // ── Single file handlers ──

  const handleSearch = async () => {
    if (!intentId.trim()) return;
    setLoading(true);
    setError(null);
    setManifest(null);
    setDownloadComplete(false);

    try {
      const result = await api.getManifest(intentId.trim());
      setManifest({
        fileName: (result.plan as any).fileName || (result.plan as any).file_name,
        fileSize: (result.plan as any).fileSize || (result.plan as any).file_size,
        status: result.status,
        encrypted: !!(result.plan as any).encryption,
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

      const result = manifest?.encrypted
        ? await downloadPrivateFile(api, intentId.trim(), {
          owner: selectedAccount,
          ownerPrivateKey: await getPrivateKey(selectedAccount),
        })
        : await downloadFile(api, intentId.trim(), selectedAccount);

      clearInterval(progressInterval);
      setDownloadProgress(100);

      const copy = new Uint8Array(result.data);
      const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
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

  // ── Load user collections when switching to collection mode ──
  useEffect(() => {
    if (mode !== 'collection' || !selectedAccount) return;
    let cancelled = false;
    setLoadingCollections(true);
    api
      .listUserCollections(selectedAccount)
      .then((resp) => {
        if (!cancelled) setUserCollections(resp.collections || []);
      })
      .catch(() => {
        if (!cancelled) setUserCollections([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCollections(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedAccount, api]);

  const handleSelectCollection = (c: DataCollection) => {
    setCollectionId(c.collection_id);
    setCollectionError(null);
    setCollection(null);
    setCollectionFiles([]);
    setBatchComplete(false);
    setBatchResult(null);
    setBatchProgress(null);
    // Auto-trigger search
    setCollectionLoading(true);
    fetchCollectionFiles(api, c.collection_id, (state) => {
      setBatchProgress(state);
    })
      .then((result) => {
        setCollection(result.collection);
        setCollectionFiles(result.files);
        if (result.files.length === 0) {
          setCollectionError(t.download.noRecords);
        }
      })
      .catch((err: any) => {
        setCollectionError(err?.message || t.download.collectionNotFound);
      })
      .finally(() => {
        setCollectionLoading(false);
        setBatchProgress(null);
      });
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim() || !selectedAccount) return;
    setCreatingCollection(true);
    setCollectionError(null);
    try {
      const privateKey = await getPrivateKey(selectedAccount);
      const result = await createCollection(
        api,
        selectedAccount,
        privateKey,
        newCollectionName.trim(),
      );
      setNewCollectionName('');
      setShowCreateForm(false);
      // Refresh list
      const resp = await api.listUserCollections(selectedAccount);
      setUserCollections(resp.collections || []);
      // Auto-select the new collection
      const newCol = (resp.collections || []).find(
        (c) => c.collection_id === result.collectionId,
      );
      if (newCol) {
        handleSelectCollection(newCol);
      } else {
        setCollectionId(result.collectionId);
      }
    } catch (err: any) {
      setCollectionError(err?.message || t.download.createCollectionFail);
    } finally {
      setCreatingCollection(false);
    }
  };

  // ── Collection handlers ──

  const handleCollectionSearch = async () => {
    if (!collectionId.trim()) return;
    setCollectionLoading(true);
    setCollectionError(null);
    setCollection(null);
    setCollectionFiles([]);
    setBatchComplete(false);
    setBatchResult(null);
    setBatchProgress(null);

    try {
      const result = await fetchCollectionFiles(api, collectionId.trim(), (state) => {
        setBatchProgress(state);
      });
      setCollection(result.collection);
      setCollectionFiles(result.files);
      if (result.files.length === 0) {
        setCollectionError(t.download.noRecords);
      }
    } catch (err: any) {
      setCollectionError(err?.message || t.download.collectionNotFound);
    } finally {
      setCollectionLoading(false);
      setBatchProgress(null);
    }
  };

  const handleBatchDownload = async () => {
    if (!selectedAccount || !collectionId.trim()) return;
    setBatchDownloading(true);
    setBatchComplete(false);
    setBatchResult(null);
    setCollectionError(null);

    try {
      const result = await downloadCollectionFiles(api, collectionId.trim(), {
        owner: selectedAccount,
        ownerPrivateKey: await getPrivateKey(selectedAccount),
        onProgress: (state) => setBatchProgress(state),
      });
      setCollectionFiles(result.files);
      setBatchResult({ succeeded: result.succeeded, failed: result.failed });
      setBatchComplete(true);
    } catch (err: any) {
      setCollectionError(err?.message || t.download.downloadFail);
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleCollectionReset = () => {
    setCollectionId('');
    setCollection(null);
    setCollectionFiles([]);
    setBatchComplete(false);
    setBatchResult(null);
    setBatchProgress(null);
    setCollectionError(null);
    setShowCreateForm(false);
  };

  // ── No account guard ──

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

  // ── Render ──

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-2">
        <ArrowDownCircle className="w-5 h-5 text-blue-400" />
        <h2 className="text-sm font-semibold text-white">{t.download.title}</h2>
      </div>

      {/* Mode Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          className={`py-2 rounded-lg text-xs font-medium transition-all ${
            mode === 'single'
              ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300'
              : 'bg-white/[0.02] border border-white/[0.06] text-slate-400 hover:border-white/[0.1]'
          }`}
          onClick={() => setMode('single')}
        >
          <File className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          {t.download.modeSingle}
        </button>
        <button
          className={`py-2 rounded-lg text-xs font-medium transition-all ${
            mode === 'collection'
              ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300'
              : 'bg-white/[0.02] border border-white/[0.06] text-slate-400 hover:border-white/[0.1]'
          }`}
          onClick={() => setMode('collection')}
        >
          <FolderOpen className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          {t.download.modeCollection}
        </button>
      </div>

      {/* ── Single File Mode ── */}
      {mode === 'single' && (
        downloadComplete ? (
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
                      {formatSize(manifest.fileSize)} · {manifest.encrypted ? t.download.modeCollection : t.download.modeSingle}
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
        )
      )}

      {/* ── Collection Mode ── */}
      {mode === 'collection' && (
        batchComplete ? (
          <div className="glass-card p-5 flex flex-col items-center gap-3">
            <CheckCircle className="w-10 h-10 text-green-400" />
            <h3 className="text-sm font-semibold text-white">{t.download.batchComplete}</h3>
            {batchResult && (
              <p className="text-xs text-slate-400">
                {t.download.batchSummary
                  .replace('{succeeded}', String(batchResult.succeeded))
                  .replace('{failed}', String(batchResult.failed))}
              </p>
            )}
            {collectionFiles.some((f) => f.status === 'error') && (
              <div className="w-full mt-2 flex flex-col gap-1">
                {collectionFiles.filter((f) => f.status === 'error').map((f) => (
                  <div key={f.recordId} className="flex items-center gap-2 text-xs text-red-400">
                    <XCircle className="w-3 h-3 shrink-0" />
                    <span className="truncate">{f.fileName}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-secondary w-full mt-1" onClick={handleCollectionReset}>
              {t.download.downloadAnotherCollection}
            </button>
          </div>
        ) : (
          <>
            {/* My Collections */}
            <div className="glass-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">
                  {t.download.myCollections}
                </span>
                <button
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  onClick={() => setShowCreateForm((v) => !v)}
                  disabled={creatingCollection}
                >
                  <Plus className="w-3 h-3" />
                  {t.download.createCollection}
                </button>
              </div>

              {showCreateForm && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input-field flex-1"
                    placeholder={t.download.collectionNamePlaceholder}
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
                    disabled={creatingCollection}
                  />
                  <button
                    className="btn-primary px-3 py-2 shrink-0"
                    onClick={handleCreateCollection}
                    disabled={creatingCollection || !newCollectionName.trim()}
                  >
                    {creatingCollection ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}

              {loadingCollections ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                </div>
              ) : userCollections.length === 0 ? (
                <p className="text-xs text-slate-500 py-2 text-center">
                  {t.download.noCollections}
                </p>
              ) : (
                <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                  {userCollections.map((c) => (
                    <button
                      key={c.collection_id}
                      className={`flex items-center gap-2 px-2 py-2 rounded-md text-left transition-all ${
                        collectionId === c.collection_id
                          ? 'bg-blue-500/15 border border-blue-500/25'
                          : 'hover:bg-white/[0.04] border border-transparent'
                      }`}
                      onClick={() => handleSelectCollection(c)}
                      disabled={collectionLoading || batchDownloading}
                    >
                      <FolderOpen
                        className={`w-4 h-4 shrink-0 ${
                          collectionId === c.collection_id
                            ? 'text-blue-400'
                            : 'text-slate-500'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {truncateId(c.collection_id, 18)}
                        </p>
                      </div>
                      {collectionLoading && collectionId === c.collection_id && (
                        <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Manual ID Search */}
            <div className="flex items-center gap-2 px-1">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[10px] text-slate-500">{t.download.orEnterId}</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            <div className="glass-card p-4 flex flex-wrap items-center gap-2">
              <input
                type="text"
                className="input-field flex-1 min-w-[180px]"
                placeholder={t.download.collectionPlaceholder}
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCollectionSearch()}
                disabled={collectionLoading || batchDownloading}
              />
              <button
                className="btn-primary flex items-center justify-center gap-1.5 px-3 py-2 shrink-0"
                onClick={handleCollectionSearch}
                disabled={collectionLoading || batchDownloading || !collectionId.trim()}
              >
                {collectionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span className="text-xs">{t.download.search}</span>
              </button>
            </div>

            {/* Error */}
            {collectionError && !collection && (
              <div className="glass-card p-3 flex items-start gap-2 border-red-500/20">
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 break-all">{collectionError}</p>
              </div>
            )}

            {/* Collection Info */}
            {collection && (
              <>
                <div className="glass-card p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-7 h-7 text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{collection.name}</p>
                      <p className="text-xs text-slate-400 truncate">{truncateId(collection.collection_id, 20)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">{t.download.collectionFiles}</span>
                    <span className="font-medium text-white">{collectionFiles.length}</span>
                  </div>
                  {collection.description && (
                    <p className="text-xs text-slate-500 truncate">{collection.description}</p>
                  )}
                </div>

                {/* File List */}
                {collectionFiles.length > 0 && (
                  <div className="glass-card p-3 flex flex-col gap-1 max-h-[300px] overflow-y-auto">
                    {collectionFiles.map((file) => (
                      <div
                        key={file.recordId}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.02]"
                      >
                        <File className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="text-xs text-slate-300 flex-1 truncate min-w-0">{file.fileName}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{formatSize(file.fileSize)}</span>
                        {file.encrypted ? (
                          <Lock className="w-3 h-3 text-yellow-500 shrink-0" />
                        ) : (
                          <Globe className="w-3 h-3 text-slate-500 shrink-0" />
                        )}
                        {file.status === 'complete' && <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />}
                        {file.status === 'error' && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                        {file.status === 'downloading' && <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />}
                      </div>
                    ))}
                  </div>
                )}

                {/* Progress */}
                {batchProgress && batchProgress.phase === 'downloading' && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-slate-400">
                      {t.download.downloadingBatch
                        .replace('{current}', String(batchProgress.completedFiles + batchProgress.failedFiles + 1))
                        .replace('{total}', String(batchProgress.totalFiles))}
                    </p>
                    <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                        style={{
                          width: `${batchProgress.totalFiles > 0 ? ((batchProgress.completedFiles + batchProgress.failedFiles) / batchProgress.totalFiles) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 truncate">{batchProgress.currentFileName}</p>
                  </div>
                )}

                {/* Download Button */}
                {collectionFiles.length > 0 && (
                  <button
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3"
                    onClick={handleBatchDownload}
                    disabled={batchDownloading}
                  >
                    {batchDownloading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t.download.downloading}
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        {t.download.downloadAll}
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
