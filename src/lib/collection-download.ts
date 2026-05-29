import type { ChainApi } from './api';
import type { DataCollection, DataRecord } from './types';
import { downloadFile } from './storage';
import { downloadPrivateFile } from './private-storage';

export interface CollectionFileStatus {
  intentId: string;
  recordId: string;
  fileName: string;
  fileSize: number;
  encrypted: boolean;
  status: 'pending' | 'downloading' | 'complete' | 'error';
  error?: string;
}

export interface CollectionDownloadProgress {
  phase: 'fetching_records' | 'fetching_manifests' | 'downloading' | 'complete' | 'error';
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentIndex: number;
  currentFileName: string;
}

export interface CollectionDownloadResult {
  collection: DataCollection;
  files: CollectionFileStatus[];
  succeeded: number;
  failed: number;
}

export async function fetchCollectionFiles(
  api: ChainApi,
  collectionId: string,
  onProgress?: (state: CollectionDownloadProgress) => void,
): Promise<{ collection: DataCollection; files: CollectionFileStatus[] }> {
  const report = (state: CollectionDownloadProgress) => onProgress?.(state);

  report({ phase: 'fetching_records', totalFiles: 0, completedFiles: 0, failedFiles: 0, currentIndex: 0, currentFileName: '' });

  const { collection } = await api.getCollection(collectionId);
  const { records } = await api.getCollectionRecords(collectionId);

  report({ phase: 'fetching_manifests', totalFiles: records.length, completedFiles: 0, failedFiles: 0, currentIndex: 0, currentFileName: '' });

  const files: CollectionFileStatus[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    report({ phase: 'fetching_manifests', totalFiles: records.length, completedFiles: 0, failedFiles: 0, currentIndex: i, currentFileName: rec.intent_id });
    try {
      const manifest = await api.getManifest(rec.intent_id);
      const plan = manifest.plan as any;
      files.push({
        intentId: rec.intent_id,
        recordId: rec.record_id,
        fileName: plan.fileName || plan.file_name || `${rec.intent_id}.bin`,
        fileSize: plan.fileSize || plan.file_size || 0,
        encrypted: !!plan.encryption,
        status: 'pending',
      });
    } catch (err: any) {
      files.push({
        intentId: rec.intent_id,
        recordId: rec.record_id,
        fileName: `${rec.intent_id}.bin`,
        fileSize: 0,
        encrypted: false,
        status: 'error',
        error: err?.message || 'manifest fetch failed',
      });
    }
  }

  return { collection, files };
}

export async function downloadCollectionFiles(
  api: ChainApi,
  collectionId: string,
  options: {
    owner: string;
    ownerPrivateKey: string;
    onProgress?: (state: CollectionDownloadProgress) => void;
    signal?: AbortSignal;
  },
): Promise<CollectionDownloadResult> {
  const { owner, ownerPrivateKey, onProgress, signal } = options;
  const report = (state: CollectionDownloadProgress) => onProgress?.(state);

  const { collection, files } = await fetchCollectionFiles(api, collectionId, report);

  let succeeded = 0;
  let failed = 0;

  report({ phase: 'downloading', totalFiles: files.length, completedFiles: 0, failedFiles: 0, currentIndex: 0, currentFileName: '' });

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break;

    const file = files[i];
    if (file.status === 'error') {
      failed++;
      continue;
    }

    file.status = 'downloading';
    report({ phase: 'downloading', totalFiles: files.length, completedFiles: succeeded, failedFiles: failed, currentIndex: i, currentFileName: file.fileName });

    try {
      const result = file.encrypted
        ? await downloadPrivateFile(api, file.intentId, { owner, ownerPrivateKey })
        : await downloadFile(api, file.intentId, owner);

      saveBlob(result.data, result.fileName || file.fileName);
      file.status = 'complete';
      file.fileName = result.fileName || file.fileName;
      succeeded++;
    } catch (err: any) {
      file.status = 'error';
      file.error = err?.message || 'download failed';
      failed++;
    }

    report({ phase: 'downloading', totalFiles: files.length, completedFiles: succeeded, failedFiles: failed, currentIndex: i, currentFileName: file.fileName });
  }

  report({ phase: 'complete', totalFiles: files.length, completedFiles: succeeded, failedFiles: failed, currentIndex: files.length, currentFileName: '' });

  return { collection, files, succeeded, failed };
}

function saveBlob(data: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(data);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
