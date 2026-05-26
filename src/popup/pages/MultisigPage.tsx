import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChainApi } from '@/lib/api';
import {
  computeMultisigAddress,
  validateMultisigSigners,
  buildMultisigTransferRequest,
  signMultisigCreate,
  signMultisigExec,
  encodeMultisigProposal,
  decodeMultisigProposal,
  sortSignatures,
} from '@/lib/multisig';
import type { MultisigWalletInfo, MultisigProposal, MultisigExecRequest } from '@/lib/types';
import { TOKEN_UNIT } from '@/lib/types';
import {
  Users,
  Plus,
  Trash2,
  Send,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  FileSignature,
  Import,
  Upload,
  Shield,
  X,
} from 'lucide-react';

interface MultisigPageProps {
  api: ChainApi;
}

function trunc(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function fmtBal(n: number): string {
  const v = n / TOKEN_UNIT;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return parseFloat(v.toFixed(8)).toString();
}

export function MultisigPage({ api }: MultisigPageProps) {
  const accounts = useAppStore((s) => s.accounts);
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const msWallets = useAppStore((s) => s.multisigWallets);
  const msProposals = useAppStore((s) => s.multisigProposals);
  const addMsWallet = useAppStore((s) => s.addMultisigWallet);
  const removeMsWallet = useAppStore((s) => s.removeMultisigWallet);
  const addProposal = useAppStore((s) => s.addMultisigProposal);
  const addSig = useAppStore((s) => s.addSignatureToProposal);
  const markExecuted = useAppStore((s) => s.markProposalExecuted);
  const getPrivateKey = useAppStore((s) => s.getPrivateKey);
  const saveState = useAppStore((s) => s.saveState);

  // ── Local account address set (for quick lookups) ──
  const localAddrs = useMemo(() => new Set(accounts.map((a) => a.address.toLowerCase())), [accounts]);
  const addrLabel = (addr: string) => accounts.find((a) => a.address.toLowerCase() === addr.toLowerCase())?.label;

  // ── Create wallet state ──
  const [showCreate, setShowCreate] = useState(false);
  const [signerInputs, setSignerInputs] = useState<string[]>(['', '']);
  const [threshold, setThreshold] = useState(2);
  const [salt] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [createErr, setCreateErr] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [previewAddr, setPreviewAddr] = useState<string | null>(null);

  // ── Transfer state ──
  const [showTransfer, setShowTransfer] = useState(false);
  const [selWallet, setSelWallet] = useState<string | null>(null);
  const [txTo, setTxTo] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txFee, setTxFee] = useState('1');
  const [txErr, setTxErr] = useState('');
  const [txShareStr, setTxShareStr] = useState('');

  // ── Import state ──
  const [showImport, setShowImport] = useState(false);
  const [importStr, setImportStr] = useState('');
  const [importErr, setImportErr] = useState('');

  // ── Sign state ──
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signAddr, setSignAddr] = useState('');
  const [signErr, setSignErr] = useState('');

  // ── Balance state ──
  const [balances, setBalances] = useState<Record<string, number>>({});

  // ── Copy state ──
  const [copied, setCopied] = useState<string | null>(null);

  // ── Confirm remove state ──
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    for (const w of msWallets) {
      try {
        const r = await api.getBalance(w.wallet.address);
        setBalances((p) => ({ ...p, [w.wallet.address]: r.balance }));
      } catch {
        setBalances((p) => ({ ...p, [w.wallet.address]: NaN }));
      }
    }
  }, [api, msWallets]);

  useEffect(() => {
    fetchBalances();
    const iv = setInterval(fetchBalances, 20000);
    return () => clearInterval(iv);
  }, [fetchBalances]);

  // Preview address
  useEffect(() => {
    const valid = signerInputs.filter((s) => s.trim().length > 0);
    if (valid.length >= 2 && !validateMultisigSigners(valid)) {
      try { setPreviewAddr(computeMultisigAddress(valid, threshold, salt)); } catch { setPreviewAddr(null); }
    } else { setPreviewAddr(null); }
  }, [signerInputs, threshold, salt]);

  const handleCopy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(text); setTimeout(() => setCopied(null), 2000);
  }, []);

  // Open create form: auto-fill current account, threshold = all signers
  const openCreate = () => {
    const initial = [selectedAccount || '', ''];
    setSignerInputs(initial);
    setThreshold(initial.filter(Boolean).length || 2);
    setCreateErr('');
    setPreviewAddr(null);
    setShowCreate(true);
  };

  // ── Create wallet ──
  const handleCreate = useCallback(async () => {
    setCreateErr('');
    const signers = signerInputs.map((s) => s.trim()).filter(Boolean);
    const err = validateMultisigSigners(signers);
    if (err) { setCreateErr(err); return; }
    if (threshold > signers.length) { setCreateErr('阈值不能超过签名者总数'); return; }
    if (threshold < 1) { setCreateErr('阈值至少为 1'); return; }

    let creatorPk = '';
    for (const s of signers) {
      const pk = await getPrivateKey(s);
      if (pk) { creatorPk = pk; break; }
    }
    if (!creatorPk) { setCreateErr('至少需要一个本地签名者来签署创建请求'); return; }

    try {
      setCreateLoading(true);
      const sig = await signMultisigCreate(signers, threshold, salt, creatorPk);
      const result = await api.createMultisigWallet({ signers, threshold, salt, signature: sig });
      addMsWallet({ wallet: result, balance: 0 });
      await saveState();
      setShowCreate(false);
    } catch (err: any) {
      setCreateErr(err.message || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  }, [signerInputs, threshold, salt, api, addMsWallet, saveState, getPrivateKey]);

  // ── Remove wallet ──
  const handleRemove = useCallback(async (address: string) => {
    removeMsWallet(address);
    await saveState();
    setConfirmRemove(null);
  }, [removeMsWallet, saveState]);

  // ── Self-sign transfer proposal ──
  const handleCreateTransfer = useCallback(async () => {
    setTxErr('');
    if (!selWallet) { setTxErr('请先选择多签钱包'); return; }
    const wInfo = msWallets.find((w) => w.wallet.address === selWallet);
    if (!wInfo) { setTxErr('找不到该钱包'); return; }
    const amount = parseFloat(txAmount);
    if (isNaN(amount) || amount <= 0) { setTxErr('请输入有效金额'); return; }
    const amountUnit = Math.round(amount * TOKEN_UNIT);
    if (!txTo.trim()) { setTxErr('请输入收款地址'); return; }
    const fee = parseFloat(txFee) || 1;

    let signerAddr = '', signerPk = '';
    for (const s of wInfo.wallet.signers) {
      const pk = await getPrivateKey(s);
      if (pk) { signerAddr = s; signerPk = pk; break; }
    }
    if (!signerPk) { setTxErr('该钱包没有可用的本地签名者'); return; }

    try {
      const req = buildMultisigTransferRequest(selWallet, txTo.trim(), amountUnit, wInfo.wallet.nonce, fee);
      const sig = await signMultisigExec(req, signerAddr, signerPk);
      req.signatures = [sig];
      const prop: MultisigProposal = {
        id: `msig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        wallet: req.wallet, operation: req.operation, payload: req.payload,
        nonce: req.nonce, fee: req.fee, signatures: req.signatures,
        status: 'pending', createdAt: Date.now(),
      };
      addProposal(prop);
      await saveState();
      setTxShareStr(encodeMultisigProposal(req));
      setTxTo(''); setTxAmount('');
    } catch (err: any) { setTxErr(err.message || '创建提案失败'); }
  }, [selWallet, txTo, txAmount, txFee, msWallets, getPrivateKey, addProposal, saveState]);

  // ── Sign proposal ──
  const handleSign = useCallback(async (propId: string) => {
    setSignErr('');
    if (!signAddr) { setSignErr('请选择签名者'); return; }
    const prop = msProposals.find((p) => p.id === propId);
    if (!prop) return;
    const pk = await getPrivateKey(signAddr);
    if (!pk) { setSignErr('该地址的私钥不可用'); return; }
    if (prop.signatures.some((s) => s.signer.toLowerCase() === signAddr.toLowerCase())) { setSignErr('该签名者已签署'); return; }
    const wInfo = msWallets.find((w) => w.wallet.address === prop.wallet);
    if (!wInfo) { setSignErr('本地找不到该多签钱包'); return; }
    if (!wInfo.wallet.signers.some((s) => s.toLowerCase() === signAddr.toLowerCase())) { setSignErr('该地址不是此钱包的签名者'); return; }

    try {
      const execReq: MultisigExecRequest = { wallet: prop.wallet, operation: prop.operation, payload: prop.payload, nonce: prop.nonce, fee: prop.fee, signatures: [] };
      const sig = await signMultisigExec(execReq, signAddr, pk);
      addSig(propId, sig);
      await saveState();
      setSigningId(null); setSignAddr('');
    } catch (err: any) { setSignErr(err.message || '签名失败'); }
  }, [signAddr, msProposals, msWallets, getPrivateKey, addSig, saveState]);

  // ── Import proposal ──
  const handleImport = useCallback(async () => {
    setImportErr('');
    const req = decodeMultisigProposal(importStr.trim());
    if (!req) { setImportErr('无效的提案字符串'); return; }
    if (!msWallets.find((w) => w.wallet.address === req.wallet)) { setImportErr('对应的多签钱包不存在，请先创建或导入'); return; }
    if (msProposals.find((p) => p.wallet === req.wallet && p.nonce === req.nonce && p.status === 'pending')) {
      setImportErr('该 nonce 的待处理提案已存在'); return;
    }
    const prop: MultisigProposal = {
      id: `msig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      wallet: req.wallet, operation: req.operation, payload: req.payload,
      nonce: req.nonce, fee: req.fee, signatures: req.signatures || [],
      status: 'pending', createdAt: Date.now(),
    };
    addProposal(prop);
    await saveState();
    setShowImport(false); setImportStr('');
  }, [importStr, msWallets, msProposals, addProposal, saveState]);

  // ── Submit proposal ──
  const handleSubmit = useCallback(async (propId: string) => {
    const prop = msProposals.find((p) => p.id === propId);
    if (!prop) return;
    const wInfo = msWallets.find((w) => w.wallet.address === prop.wallet);
    if (!wInfo || prop.signatures.length < wInfo.wallet.threshold) return;
    try {
      await api.multisigExec({ wallet: prop.wallet, operation: prop.operation, payload: prop.payload, nonce: prop.nonce, fee: prop.fee, signatures: sortSignatures(prop.signatures) });
      markExecuted(propId);
      await saveState();
      fetchBalances();
    } catch (err: any) { console.error('Multisig exec failed:', err); }
  }, [msProposals, msWallets, api, markExecuted, saveState, fetchBalances]);

  const pending = msProposals.filter((p) => p.status === 'pending');

  // Helpers for threshold display
  const validSignerCount = signerInputs.filter((s) => s.trim().length > 0).length;

  return (
    <div className="flex flex-col gap-3 pb-2">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-purple-400" />
          <span className="text-[13px] font-semibold text-white">多签钱包</span>
          <span className="text-[11px] text-slate-500">({msWallets.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowImport(!showImport); setImportErr(''); setImportStr(''); }}
            className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            title="导入提案"
          >
            <Import className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button
            onClick={() => { showCreate ? setShowCreate(false) : openCreate(); }}
            className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            title="创建多签钱包"
          >
            {showCreate ? <X className="w-3.5 h-3.5 text-slate-400" /> : <Plus className="w-3.5 h-3.5 text-slate-400" />}
          </button>
        </div>
      </div>

      {/* ─── 创建多签钱包 ─── */}
      {showCreate && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" />
            <p className="text-[13px] font-semibold text-white">创建多签钱包</p>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            添加 2~16 个签名者地址。转账需要至少 M 个签名者共同授权。默认要求全部签名者同意（M=N），你可以手动调低阈值。
          </p>

          <div className="flex flex-col gap-2.5">
            {signerInputs.map((val, i) => {
              const isLocal = val.trim() ? localAddrs.has(val.trim().toLowerCase()) : false;
              const label = val.trim() ? addrLabel(val.trim()) : null;
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 w-5 shrink-0 font-semibold">#{i + 1}</span>
                    <input
                      className={`input-field text-[12px] flex-1 ${isLocal ? 'border-purple-400/20' : ''}`}
                      placeholder="签名者地址 0x...  或从下方选择"
                      value={val}
                      onChange={(e) => {
                        const next = [...signerInputs];
                        next[i] = e.target.value;
                        setSignerInputs(next);
                        setCreateErr('');
                      }}
                    />
                    {signerInputs.length > 2 && (
                      <button
                        onClick={() => {
                          const next = signerInputs.filter((_, j) => j !== i);
                          setSignerInputs(next);
                          if (threshold > next.filter(Boolean).length) setThreshold(next.filter(Boolean).length || 1);
                        }}
                        className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="w-3 h-3 text-slate-500" />
                      </button>
                    )}
                  </div>
                  {isLocal && (
                    <div className="flex items-center gap-1.5 ml-7">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      <span className="text-[9px] text-purple-400 font-medium">本地账户{label ? ` · ${label}` : ''}</span>
                    </div>
                  )}
                  {accounts.length > 0 && (
                    <select
                      className="input-field text-[10px] ml-7 py-1 opacity-70"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const next = [...signerInputs];
                          next[i] = e.target.value;
                          setSignerInputs(next);
                          setCreateErr('');
                        }
                      }}
                    >
                      <option value="">从本地账户选择...</option>
                      {accounts.map((a) => (
                        <option key={a.address} value={a.address}>{a.label} ({trunc(a.address)})</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}

            <button
              onClick={() => {
                const next = [...signerInputs, ''];
                setSignerInputs(next);
                setThreshold(next.filter(Boolean).length || threshold);
              }}
              className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors self-start font-medium"
            >
              + 添加签名者
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-slate-400 font-medium">
                签名阈值：{validSignerCount > 0 ? `${threshold} / ${validSignerCount} 签名者需同意` : '—'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  className="input-field text-[13px] w-20"
                  type="number"
                  min={1}
                  max={validSignerCount || 16}
                  value={threshold}
                  onChange={(e) => setThreshold(Math.max(1, Math.min(parseInt(e.target.value) || 1, validSignerCount || 16)))}
                />
                <button
                  onClick={() => setThreshold(validSignerCount || 1)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                    threshold === validSignerCount
                      ? 'border-purple-400/30 bg-purple-400/10 text-purple-400'
                      : 'border-white/[0.06] text-slate-400 hover:bg-white/[0.04]'
                  }`}
                >
                  全部 (N={validSignerCount})
                </button>
                <button
                  onClick={() => setThreshold(Math.ceil(validSignerCount / 2) || 1)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                    threshold === Math.ceil(validSignerCount / 2)
                      ? 'border-blue-400/30 bg-blue-400/10 text-blue-400'
                      : 'border-white/[0.06] text-slate-400 hover:bg-white/[0.04]'
                  }`}
                >
                  多数 ({Math.ceil(validSignerCount / 2)}/{validSignerCount})
                </button>
              </div>
            </div>
          </div>

          {previewAddr && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-medium">多签地址（预览）</label>
              <div className="flex items-center gap-1.5 p-2 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                <code className="text-[10px] text-slate-300 break-all flex-1 tabular-nums">{previewAddr}</code>
                <button onClick={() => handleCopy(previewAddr)} className="shrink-0">
                  {copied === previewAddr ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                </button>
              </div>
            </div>
          )}

          {createErr && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              <p className="text-[11px] text-red-400">{createErr}</p>
            </div>
          )}

          <button onClick={handleCreate} disabled={createLoading} className="btn-primary flex items-center justify-center gap-2 py-2.5 text-[13px]">
            {createLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>创建多签钱包</span>
          </button>
        </div>
      )}

      {/* ─── 导入提案 ─── */}
      {showImport && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Import className="w-4 h-4 text-blue-400" />
            <p className="text-[13px] font-semibold text-white">导入提案</p>
          </div>
          <p className="text-[11px] text-slate-400">粘贴其他签名者分享的 fms_ 开头的提案字符串。</p>
          <textarea
            className="input-field text-[11px] min-h-[60px] font-mono"
            placeholder="粘贴 fms_... 提案字符串"
            value={importStr}
            onChange={(e) => { setImportStr(e.target.value); setImportErr(''); }}
          />
          {importErr && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              <p className="text-[11px] text-red-400">{importErr}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleImport} className="btn-primary flex-1 py-2 text-[12px] flex items-center justify-center gap-1.5">
              <Import className="w-3.5 h-3.5" /><span>导入</span>
            </button>
            <button onClick={() => { setShowImport(false); setImportStr(''); setImportErr(''); }} className="btn-secondary py-2 px-3 text-[12px]">取消</button>
          </div>
        </div>
      )}

      {/* ─── 多签钱包列表 ─── */}
      <div className="flex flex-col gap-2">
        {msWallets.length === 0 && !showCreate && (
          <div className="glass-card p-5 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-purple-400/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-purple-400" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[13px] font-semibold text-white">还没有多签钱包</p>
              <p className="text-[11px] text-slate-500 leading-relaxed max-w-[240px]">
                多签钱包需要多个签名者共同授权才能转账，适合团队共管资金。点击右上角 + 创建。
              </p>
            </div>
          </div>
        )}

        {msWallets.map((w) => {
          const balance = balances[w.wallet.address];
          const isSel = selWallet === w.wallet.address;
          const allLocal = w.wallet.signers.every((s) => localAddrs.has(s.toLowerCase()));
          const localCount = w.wallet.signers.filter((s) => localAddrs.has(s.toLowerCase())).length;
          return (
            <div
              key={w.wallet.address}
              onClick={() => setSelWallet(isSel ? null : w.wallet.address)}
              className={`glass-card p-3 flex flex-col gap-2 cursor-pointer transition-all duration-200 ${
                isSel ? 'border-purple-400/30 ring-1 ring-purple-400/20' : 'hover:border-white/[0.1]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    isSel ? 'bg-gradient-to-br from-purple-500/30 to-blue-600/30' : 'bg-white/[0.04]'
                  }`}>
                    <Users className={`w-4.5 h-4.5 ${isSel ? 'text-purple-400' : 'text-slate-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12px] font-semibold text-white truncate">
                        {w.wallet.threshold}/{w.wallet.signers.length} 多签
                      </p>
                      {allLocal && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-400 font-semibold">全部本地</span>
                      )}
                      {!allLocal && localCount > 0 && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-400/15 text-blue-400 font-semibold">{localCount} 本地</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 truncate tabular-nums">{trunc(w.wallet.address)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopy(w.wallet.address); }}
                    className="w-7 h-7 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                  >
                    {copied === w.wallet.address ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                  </button>
                  {confirmRemove === w.wallet.address ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemove(w.wallet.address); }}
                        className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-colors"
                      >
                        <Check className="w-3 h-3 text-red-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmRemove(null); }}
                        className="w-7 h-7 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                      >
                        <X className="w-3 h-3 text-slate-400" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmRemove(w.wallet.address); }}
                      className="w-7 h-7 rounded-lg border border-white/[0.04] bg-white/[0.02] flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3 text-slate-500" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-bold text-slate-200 tabular-nums">
                    {balance !== undefined && !isNaN(balance) ? `${fmtBal(balance)} GF` : '--'}
                  </span>
                  <span className="text-[10px] text-slate-600">nonce {w.wallet.nonce}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); api.getBalance(w.wallet.address).then((r) => setBalances((p) => ({ ...p, [w.wallet.address]: r.balance }))).catch(() => {}); }}
                  className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/[0.04] transition-colors"
                >
                  <RefreshCw className="w-3 h-3 text-slate-500" />
                </button>
              </div>

              {isSel && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.06]">
                  <p className="text-[10px] text-slate-400 font-medium">签名者列表（需 {w.wallet.threshold} 人同意）</p>
                  {w.wallet.signers.map((s) => {
                    const local = localAddrs.has(s.toLowerCase());
                    const lbl = addrLabel(s);
                    return (
                      <div key={s} className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${local ? 'bg-purple-400' : 'bg-slate-600'}`} />
                        <code className="text-[10px] text-slate-400 tabular-nums flex-1">{trunc(s)}</code>
                        {local && <span className="text-[8px] text-purple-400 font-medium">{lbl || '本地'}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── 发起转账提案 ─── */}
      {msWallets.length > 0 && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-purple-400" />
              <span className="text-[13px] font-semibold text-white">发起转账提案</span>
            </div>
            <button
              onClick={() => { setShowTransfer(!showTransfer); setTxErr(''); setTxShareStr(''); if (showTransfer) { setTxTo(''); setTxAmount(''); } }}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 transition-colors"
            >
              <span>{showTransfer ? '收起' : '展开'}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showTransfer ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showTransfer && (
            <>
              <p className="text-[11px] text-slate-400">创建一笔多签转账提案，自动用本地签名者签名后生成分享字符串。</p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-slate-400 font-medium">多签钱包</label>
                <select className="input-field text-[12px]" value={selWallet || ''} onChange={(e) => setSelWallet(e.target.value || null)}>
                  <option value="">选择多签钱包...</option>
                  {msWallets.map((w) => (
                    <option key={w.wallet.address} value={w.wallet.address}>
                      {w.wallet.threshold}/{w.wallet.signers.length} ({trunc(w.wallet.address)}) — {fmtBal(balances[w.wallet.address] || 0)} GF
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-slate-400 font-medium">收款地址</label>
                <input className="input-field text-[13px]" placeholder="0x..." value={txTo} onChange={(e) => { setTxTo(e.target.value); setTxErr(''); }} />
              </div>

              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[11px] text-slate-400 font-medium">金额 (GF)</label>
                  <input className="input-field text-[13px]" type="number" step="any" min="0" placeholder="0.00" value={txAmount} onChange={(e) => { setTxAmount(e.target.value); setTxErr(''); }} />
                </div>
                <div className="flex flex-col gap-1.5 w-24">
                  <label className="text-[11px] text-slate-400 font-medium">手续费</label>
                  <input className="input-field text-[13px]" type="number" step="any" min="0" value={txFee} onChange={(e) => setTxFee(e.target.value)} />
                </div>
              </div>

              {txErr && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                  <p className="text-[11px] text-red-400">{txErr}</p>
                </div>
              )}

              {!txShareStr && (
                <button onClick={handleCreateTransfer} className="btn-primary flex items-center justify-center gap-2 py-2.5 text-[13px]">
                  <FileSignature className="w-4 h-4" /><span>创建并签名</span>
                </button>
              )}

              {txShareStr && (
                <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-green-400" />
                    <p className="text-[11px] text-green-400 font-medium">提案已创建并已签名</p>
                  </div>
                  <p className="text-[10px] text-slate-400">将以下字符串发送给其他签名者，让他们导入并签名：</p>
                  <div className="flex items-start gap-1.5 p-2 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                    <code className="text-[9px] text-slate-400 break-all flex-1 max-h-[60px] overflow-y-auto tabular-nums">{txShareStr}</code>
                    <button onClick={() => handleCopy(txShareStr)} className="shrink-0 mt-0.5">
                      {copied === txShareStr ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                    </button>
                  </div>
                  <button onClick={() => { setTxShareStr(''); setTxTo(''); setTxAmount(''); }} className="btn-secondary py-2 text-[12px]">完成</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── 待处理提案 ─── */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-yellow-400" />
            <span className="text-[13px] font-semibold text-white">待处理提案</span>
            <span className="text-[11px] text-slate-500">({pending.length})</span>
          </div>

          {pending.map((p) => {
            const wInfo = msWallets.find((w) => w.wallet.address === p.wallet);
            const needed = wInfo ? wInfo.wallet.threshold : 0;
            const got = p.signatures.length;
            const ready = got >= needed;
            const payload = p.payload as { to?: string; amount?: number };

            return (
              <div key={p.id} className={`glass-card p-3 flex flex-col gap-2 ${ready ? 'border-green-400/20' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ready ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                      <Send className={`w-4 h-4 ${ready ? 'text-green-400' : 'text-yellow-400'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-white truncate">
                        {p.operation === 'transfer' ? '转账' : p.operation} — {wInfo ? `${wInfo.wallet.threshold}/${wInfo.wallet.signers.length}` : trunc(p.wallet)}
                      </p>
                      <div className="flex items-center gap-2">
                        {payload.to && <span className="text-[10px] text-slate-500">至 {trunc(payload.to)}</span>}
                        {payload.amount !== undefined && <span className="text-[10px] text-slate-400 font-semibold">{fmtPayloadAmt(payload.amount as number)} GF</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[11px] font-bold tabular-nums ${ready ? 'text-green-400' : 'text-yellow-400'}`}>
                      {got}/{needed}
                    </span>
                    <p className="text-[9px] text-slate-500">{ready ? '可执行' : `还需 ${needed - got} 个签名`}</p>
                  </div>
                </div>

                {/* Signatures list */}
                {got > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {p.signatures.map((sig) => {
                      const local = localAddrs.has(sig.signer.toLowerCase());
                      return (
                        <div key={sig.signer} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.04]">
                          <Check className="w-2.5 h-2.5 text-green-400" />
                          <code className="text-[9px] text-slate-400 tabular-nums">{trunc(sig.signer)}</code>
                          {local && <span className="text-[8px] text-purple-400">本地</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                  {signingId === p.id ? (
                    <div className="flex flex-col gap-1.5 flex-1">
                      <select className="input-field text-[11px]" value={signAddr} onChange={(e) => { setSignAddr(e.target.value); setSignErr(''); }}>
                        <option value="">选择签名者...</option>
                        {accounts.map((a) => (
                          <option key={a.address} value={a.address}>{a.label} ({trunc(a.address)})</option>
                        ))}
                      </select>
                      {signErr && <p className="text-[10px] text-red-400">{signErr}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => handleSign(p.id)} className="btn-primary flex-1 py-1.5 text-[11px]">确认签名</button>
                        <button onClick={() => { setSigningId(null); setSignAddr(''); setSignErr(''); }} className="btn-secondary py-1.5 px-3 text-[11px]">取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => { setSigningId(p.id); setSignErr(''); setSignAddr(''); }}
                        className="btn-secondary flex items-center gap-1.5 py-1.5 px-3 text-[11px]"
                      >
                        <FileSignature className="w-3 h-3" /><span>签名</span>
                      </button>
                      <button
                        onClick={() => handleCopy(encodeMultisigProposal({ wallet: p.wallet, operation: p.operation, payload: p.payload, nonce: p.nonce, fee: p.fee, signatures: p.signatures }))}
                        className="btn-secondary flex items-center gap-1.5 py-1.5 px-3 text-[11px]"
                      >
                        {copied === encodeMultisigProposal({ wallet: p.wallet, operation: p.operation, payload: p.payload, nonce: p.nonce, fee: p.fee, signatures: p.signatures })
                          ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>分享</span>
                      </button>
                      {ready && (
                        <button
                          onClick={() => handleSubmit(p.id)}
                          className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-[11px] ml-auto"
                        >
                          <Upload className="w-3 h-3" /><span>提交执行</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
            );
          })}
        </div>
      )}
    </div>
  );
}
