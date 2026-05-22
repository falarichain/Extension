import { useState, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { generateWallet, importWallet, importWalletFromMnemonic, normalizeAddress } from '@/lib/crypto';
import { useI18n } from '@/lib/i18n';
import { Key, ArrowRight, AlertCircle, Eye, EyeOff, Copy, Check, FileText, Shield, RotateCcw } from 'lucide-react';
import { extensionAssetUrl } from '@/lib/extensionAssets';

function generateId(): string {
  return `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function WelcomePage({ onWalletCreated }: { onWalletCreated: () => void }) {
  const addAccount = useAppStore((s) => s.addAccount);
  const addWallet = useAppStore((s) => s.addWallet);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const storePrivateKey = useAppStore((s) => s.storePrivateKey);
  const storeMnemonic = useAppStore((s) => s.storeMnemonic);
  const saveState = useAppStore((s) => s.saveState);
  const { t } = useI18n();

  const [mode, setMode] = useState<'welcome' | 'create' | 'verify' | 'import'>('welcome');
  const [importTab, setImportTab] = useState<'pk' | 'mnemonic'>('pk');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [newWallet, setNewWallet] = useState<{
    address: string;
    publicKey: string;
    privateKey: string;
    mnemonic: string | null;
  } | null>(null);
  const [newWalletId, setNewWalletId] = useState('');
  const [mnemonicRevealed, setMnemonicRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [blankIndices, setBlankIndices] = useState<number[]>([]);
  const [verifyValues, setVerifyValues] = useState<Record<number, string>>({});
  const [verifyError, setVerifyError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleCreate = () => {
    const wallet = generateWallet();
    setNewWallet(wallet);
    setNewWalletId(generateId());
    setMode('create');
  };

  const handleGoToVerify = () => {
    if (!newWallet?.mnemonic) return;
    const words = newWallet.mnemonic.split(' ');
    const indices = new Set<number>();
    while (indices.size < 2) {
      indices.add(Math.floor(Math.random() * words.length));
    }
    const blanks = Array.from(indices).sort((a, b) => a - b);
    setBlankIndices(blanks);
    setVerifyValues({});
    setVerifyError('');
    setMode('verify');
    setTimeout(() => {
      const firstBlank = blanks[0];
      if (inputRefs.current[firstBlank]) {
        inputRefs.current[firstBlank]?.focus();
      }
    }, 100);
  };

  const handleVerifyMnemonic = async () => {
    if (!newWallet?.mnemonic) return;
    const words = newWallet.mnemonic.trim().toLowerCase().split(' ');
    for (const idx of blankIndices) {
      if ((verifyValues[idx] || '').trim().toLowerCase() !== words[idx]) {
        setVerifyError(t.welcome.verifyMismatch);
        return;
      }
    }
    try {
      await storePrivateKey(newWallet.address, newWallet.privateKey);
      await storeMnemonic(newWalletId, newWallet.mnemonic);
      const walletGroup = { id: newWalletId, name: t.welcome.walletName, createdAt: Date.now() };
      addWallet(walletGroup);
      const account = {
        address: newWallet.address,
        publicKey: newWallet.publicKey,
        walletId: newWalletId,
        pathIndex: 0,
        label: `${t.welcome.walletName} #1`,
        createdAt: Date.now(),
      };
      addAccount(account);
      setSelectedAccount(newWallet.address);
      await saveState();
      onWalletCreated();
    } catch {
      setVerifyError(t.lockscreen.error);
    }
  };

  const handleSkipMnemonic = async () => {
    if (!newWallet) return;
    await storePrivateKey(newWallet.address, newWallet.privateKey);
    if (newWallet.mnemonic) await storeMnemonic(newWalletId, newWallet.mnemonic);
    const walletGroup = { id: newWalletId, name: t.welcome.walletName, createdAt: Date.now() };
    addWallet(walletGroup);
    const account = {
      address: newWallet.address,
      publicKey: newWallet.publicKey,
      walletId: newWalletId,
      pathIndex: 0,
      label: `${t.welcome.walletName} #1`,
      createdAt: Date.now(),
    };
    addAccount(account);
    setSelectedAccount(newWallet.address);
    await saveState();
    onWalletCreated();
  };

  const handleImportPk = async () => {
    setError('');
    try {
      const wallet = importWallet(privateKeyInput.trim());
      const exists = useAppStore.getState().accounts.some(
        (a) => normalizeAddress(a.address) === normalizeAddress(wallet.address),
      );
      if (exists) {
        setError(t.wallet.alreadyImported);
        return;
      }
      const walletId = generateId();
      await storePrivateKey(wallet.address, wallet.privateKey);
      const walletGroup = { id: walletId, name: t.welcome.importedWallet, createdAt: Date.now() };
      addWallet(walletGroup);
      const account = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        walletId,
        pathIndex: 0,
        label: t.welcome.importedWallet,
        createdAt: Date.now(),
      };
      addAccount(account);
      setSelectedAccount(wallet.address);
      await saveState();
      onWalletCreated();
    } catch {
      setError(t.welcome.invalidPk);
    }
  };

  const handleImportMnemonic = async () => {
    setError('');
    try {
      const wallet = importWalletFromMnemonic(mnemonicInput.trim(), 0);
      const exists = useAppStore.getState().accounts.some(
        (a) => normalizeAddress(a.address) === normalizeAddress(wallet.address),
      );
      if (exists) {
        setError(t.wallet.alreadyImported);
        return;
      }
      const walletId = generateId();
      await storePrivateKey(wallet.address, wallet.privateKey);
      await storeMnemonic(walletId, mnemonicInput.trim());
      const walletGroup = { id: walletId, name: t.welcome.importedWallet, createdAt: Date.now() };
      addWallet(walletGroup);
      const account = {
        address: wallet.address,
        publicKey: wallet.publicKey,
        walletId,
        pathIndex: 0,
        label: `${t.welcome.importedWallet} #1`,
        createdAt: Date.now(),
      };
      addAccount(account);
      setSelectedAccount(wallet.address);
      await saveState();
      onWalletCreated();
    } catch {
      setError(t.welcome.invalidMnemonic);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (mode === 'welcome') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10">
        <div className="mb-2">
          <img src={extensionAssetUrl('icons/icon128.png')} alt="Falari" className="w-16 h-16 animate-pulse-slow" />
        </div>
        <h2 className="text-xl font-bold text-white text-center">{t.welcome.title1}</h2>
        <h1 className="text-2xl font-bold gradient-text text-center">{t.welcome.title2}</h1>
        <p className="text-sm text-slate-400 text-center leading-relaxed">
          {t.welcome.desc}
        </p>
        <div className="flex flex-col gap-3 w-full mt-4">
          <button onClick={handleCreate} className="btn-primary w-full flex items-center justify-center gap-2 py-3">
            <Key className="w-4 h-4" />
            {t.welcome.createBtn}
          </button>
          <button onClick={() => setMode('import')} className="btn-secondary w-full flex items-center justify-center gap-2 py-3">
            <ArrowRight className="w-4 h-4" />
            {t.welcome.importBtn}
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'create' && newWallet) {
    const mnemonicWords = newWallet.mnemonic ? newWallet.mnemonic.split(' ') : [];

    return (
      <div className="flex min-h-full flex-col gap-3 py-4 px-4 overflow-y-auto">
        <h2 className="text-lg font-bold text-white">{t.welcome.newWalletTitle}</h2>

        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" />
              <p className="text-xs text-slate-400">{t.welcome.mnemonicPhrase}</p>
            </div>
            {!mnemonicRevealed ? (
              <button
                onClick={() => setMnemonicRevealed(true)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" />
                {t.welcome.reveal}
              </button>
            ) : (
              <button
                onClick={() => copyText(newWallet.mnemonic || '', 'mnemonic')}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                {copied === 'mnemonic' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {mnemonicRevealed ? (
            <div className="recovery-grid p-3 bg-white/[0.04] rounded-lg border border-white/[0.06]">
              {mnemonicWords.map((word, i) => (
                <div key={i} className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-slate-600 w-4 text-right">{i + 1}</span>
                  <span className="text-xs text-white tabular-nums truncate">{word}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-6 bg-white/[0.02] rounded-lg border border-white/[0.06]">
              <Shield className="w-8 h-8 text-slate-600" />
              <p className="text-xs text-slate-500 text-center">{t.welcome.mnemonicHidden}</p>
            </div>
          )}

          <div className="flex gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mt-1">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-300/80 leading-relaxed">
              {t.welcome.saveWarning}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-auto">
          <button
            onClick={handleGoToVerify}
            className="btn-primary w-full py-3"
            disabled={!mnemonicRevealed}
          >
            {t.welcome.saved}
          </button>
          <button
            onClick={handleSkipMnemonic}
            className="btn-secondary w-full py-3"
          >
            {t.welcome.skipForNow}
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'verify' && newWallet) {
    const words = (newWallet.mnemonic || '').split(' ');

    return (
      <div className="flex min-h-full flex-col gap-4 py-4 px-4 overflow-y-auto">
        <h2 className="text-lg font-bold text-white">{t.welcome.verifyTitle}</h2>
        <p className="text-xs text-slate-400">{t.welcome.verifyFillBlanks}</p>

        <div className="recovery-grid">
          {words.map((word, i) => {
            const isBlank = blankIndices.includes(i);
            return (
              <div key={i} className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 text-center">#{i + 1}</span>
                {isBlank ? (
                  <input
                    ref={(el) => { inputRefs.current[i] = el; }}
                    className="input-field text-center text-xs font-mono py-2"
                    value={verifyValues[i] || ''}
                    onChange={(e) => {
                      setVerifyValues((p) => ({ ...p, [i]: e.target.value }));
                      setVerifyError('');
                    }}
                    placeholder="?"
                    autoComplete="off"
                  />
                ) : (
                  <div className="input-field text-center text-xs font-mono py-2 text-[var(--c-text)] bg-[var(--c-surface)] opacity-50 select-none cursor-default">
                    {word}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {verifyError && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-400">{verifyError}</p>
          </div>
        )}

        <button
          onClick={handleVerifyMnemonic}
          disabled={blankIndices.some((i) => !(verifyValues[i] || '').trim())}
          className="btn-primary w-full py-3 mt-2"
        >
          {t.welcome.verifyBtn}
        </button>

        <button
          onClick={() => { setMode('create'); setVerifyValues({}); setVerifyError(''); }}
          className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          {t.welcome.back}
        </button>
      </div>
    );
  }

  return (
      <div className="flex min-h-full flex-col gap-4 py-6 px-4 overflow-y-auto">
      <h2 className="text-lg font-bold text-white">{t.welcome.importTitle}</h2>

      <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
        <button
          onClick={() => { setImportTab('pk'); setError(''); }}
          className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all ${
            importTab === 'pk' ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {t.welcome.privateKey}
        </button>
        <button
          onClick={() => { setImportTab('mnemonic'); setError(''); }}
          className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all ${
            importTab === 'mnemonic' ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {t.welcome.mnemonicPhrase}
        </button>
      </div>

      {importTab === 'pk' ? (
        <>
          <p className="text-sm text-slate-400">{t.welcome.importHint}</p>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={privateKeyInput}
              onChange={(e) => { setPrivateKeyInput(e.target.value); setError(''); }}
              placeholder="0x..."
              className="input-field pr-10 font-mono text-sm"
            />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={handleImportPk} disabled={!privateKeyInput.trim()} className="btn-primary w-full py-3 mt-2">
            {t.welcome.importBtnLabel}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-400">{t.welcome.mnemonicImportHint}</p>
          <textarea
            value={mnemonicInput}
            onChange={(e) => { setMnemonicInput(e.target.value); setError(''); }}
            placeholder={t.welcome.mnemonicPlaceholder}
            className="input-field font-mono text-sm resize-none h-24"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={handleImportMnemonic} disabled={!mnemonicInput.trim()} className="btn-primary w-full py-3 mt-2">
            {t.welcome.importBtnLabel}
          </button>
        </>
      )}

      <button onClick={() => { setMode('welcome'); setImportTab('pk'); setError(''); }} className="btn-secondary w-full py-3">
        {t.welcome.back}
      </button>
    </div>
  );
}
