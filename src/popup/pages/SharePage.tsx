import { useState } from 'react';
import type { ChainApi } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import {
  createPasscodeShare,
  downloadPrivateFile,
  openAddressShare,
  openPasscodeShare,
  parseShareLink,
  recoverOwnerDataKeyBase64,
  sharePrivateFileWithAddress,
} from '@/lib/private-storage';
import { Download, KeyRound, Link2, Loader2, Share2 } from 'lucide-react';

interface Props {
  api: ChainApi;
}

function downloadBlob(fileName: string, data: Uint8Array) {
  const copy = new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([copy.buffer]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SharePage({ api }: Props) {
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const [intentId, setIntentId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [fullLink, setFullLink] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [openShareId, setOpenShareId] = useState('');
  const [openCode, setOpenCode] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const requireWallet = async () => {
    if (!selectedAccount) throw new Error('请先选择钱包');
    const privateKey = await getPrivateKey(selectedAccount);
    if (!privateKey) throw new Error('当前钱包没有本机私钥');
    return privateKey;
  };

  const createPasscode = async () => {
    setBusy('passcode');
    setMessage('');
    try {
      const privateKey = await requireWallet();
      const dataKeyBase64 = await recoverOwnerDataKeyBase64(api, intentId.trim(), selectedAccount!, privateKey);
      const result = await createPasscodeShare(api, {
        intentId: intentId.trim(),
        owner: selectedAccount!,
        dataKeyBase64,
        appBaseUrl: 'falari://open',
        includeKeyInUrl: fullLink,
      });
      setShareUrl(result.url);
      setAccessCode(result.accessCode);
      setOpenShareId(result.shareId);
      setMessage('访问码分享已生成。');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '生成失败');
    } finally {
      setBusy('');
    }
  };

  const createAddress = async () => {
    setBusy('address');
    setMessage('');
    try {
      const privateKey = await requireWallet();
      const result = await sharePrivateFileWithAddress(api, {
        intentId: intentId.trim(),
        owner: selectedAccount!,
        ownerPrivateKey: privateKey,
        recipient: recipient.trim(),
        appBaseUrl: 'falari://open',
        includeKeyInUrl: true,
      });
      setOpenShareId(result.shareId);
      setShareUrl(result.url);
      setAccessCode(result.accessCode);
      setMessage('地址分享链接已生成。');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '地址分享失败');
    } finally {
      setBusy('');
    }
  };

  const openShare = async () => {
    setBusy('open');
    setMessage('');
    try {
      if (!selectedAccount) throw new Error('请先选择钱包');
      const parsed = parseShareLink(openShareId);
      const code = openCode.trim() || parsed.accessCode || '';
      if (!parsed.shareId) throw new Error('请输入分享 ID 或分享链接');
      if (!code) throw new Error('请输入访问码或分享链接里的密钥片段');
      const opened = await openShareWithCode(api, parsed.shareId, code, selectedAccount);
      const result = await downloadPrivateFile(api, opened.intentId, { dataKeyBase64: opened.dataKeyBase64 });
      downloadBlob(result.fileName, result.data);
      setMessage('分享文件已开始下载。');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '打开分享失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-2">
        <Share2 className="w-5 h-5 text-blue-400" />
        <h2 className="text-sm font-semibold text-white">分享</h2>
      </div>

      {message && (
        <div className="glass-card p-3 text-xs text-slate-300 break-all">{message}</div>
      )}

      <div className="glass-card p-4 space-y-3">
        <label className="text-[11px] text-slate-500">私有文件 Intent ID</label>
        <input className="input-field text-[13px]" value={intentId} onChange={(event) => setIntentId(event.target.value)} placeholder="intent_xxx" />

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary flex items-center justify-center gap-2 py-2.5" onClick={createPasscode} disabled={!intentId.trim() || busy === 'passcode'}>
            {busy === 'passcode' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            访问码分享
          </button>
          <label className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 text-[11px] text-slate-400">
            <input type="checkbox" checked={fullLink} onChange={(event) => setFullLink(event.target.checked)} />
            完整链接
          </label>
        </div>

        <input className="input-field text-[13px]" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="接收方地址 0x..." />
        <p className="text-[11px] text-slate-500 leading-relaxed">
          只需要输入合法 0x 地址，不查询这个地址是否已经存在。密钥片段只放在分享链接里，不写入链上。
        </p>
        <button className="btn-secondary w-full flex items-center justify-center gap-2 py-2.5" onClick={createAddress} disabled={!intentId.trim() || !recipient.trim() || busy === 'address'}>
          {busy === 'address' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          分享给地址
        </button>
      </div>

      {(shareUrl || accessCode) && (
        <div className="glass-card p-4 space-y-2">
          <div className="text-[11px] text-slate-500">分享链接</div>
          <div className="text-[11px] font-mono text-slate-300 break-all">{shareUrl}</div>
          <div className="text-[11px] text-slate-500">访问码</div>
          <div className="text-[12px] font-mono text-white">{accessCode}</div>
        </div>
      )}

      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-white">打开分享</span>
        </div>
        <input className="input-field text-[13px]" value={openShareId} onChange={(event) => setOpenShareId(event.target.value)} placeholder="share_xxx 或完整分享链接" />
        <input className="input-field text-[13px]" value={openCode} onChange={(event) => setOpenCode(event.target.value)} placeholder="访问码或链接密钥" />
        <button className="btn-primary w-full flex items-center justify-center gap-2 py-2.5" onClick={openShare} disabled={!openShareId.trim() || busy === 'open'}>
          {busy === 'open' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          打开并下载
        </button>
      </div>
    </div>
  );
}

async function openShareWithCode(
  api: ChainApi,
  shareId: string,
  code: string,
  recipient: string,
): Promise<{ intentId: string; dataKeyBase64: string }> {
  try {
    return await openPasscodeShare(api, shareId, code);
  } catch {
    return openAddressShare(api, {
      shareId,
      recipient,
      shareSecret: code,
    });
  }
}
