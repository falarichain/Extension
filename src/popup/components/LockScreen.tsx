import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import { Lock, Eye, EyeOff, AlertCircle, Shield, ArrowRight } from 'lucide-react';

export default function LockScreen() {
  const { t } = useI18n();
  const verifyPassword = useAppStore((s) => s.verifyPassword);
  const setPassword = useAppStore((s) => s.setPassword);
  const markUnlocked = useAppStore((s) => s.markUnlocked);
  const hasPasswordFn = useAppStore((s) => s.hasPassword);

  const [isNewUser, setIsNewUser] = useState<boolean | null>(null);
  const [password, setPasswordInput] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const hasPw = await hasPasswordFn();
      setIsNewUser(!hasPw);
    })();
  }, [hasPasswordFn]);

  const handleSubmit = async () => {
    setError('');
    if (!password) {
      setError(t.lockscreen.passwordRequired);
      return;
    }

    setLoading(true);
    try {
      if (isNewUser) {
        if (password.length < 8) {
          setError(t.lockscreen.passwordTooShort);
          return;
        }
        if (password !== confirmPassword) {
          setError(t.lockscreen.passwordMismatch);
          return;
        }
        await setPassword(password);
        await markUnlocked();
      } else {
        const ok = await verifyPassword(password);
        if (!ok) {
          setError(t.lockscreen.wrongPassword);
          return;
        }
        await markUnlocked();
      }
    } catch (err) {
      setError(t.lockscreen.error);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  if (isNewUser === null) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--c-bg)]">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[var(--c-bg)] flex flex-col items-center justify-center gap-5 px-8">
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-[var(--c-border)] flex items-center justify-center">
          {isNewUser ? (
            <Shield className="w-8 h-8 text-blue-400" />
          ) : (
            <Lock className="w-8 h-8 text-blue-400" />
          )}
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-[var(--c-text)]">
            {isNewUser ? t.lockscreen.setupTitle : t.lockscreen.unlockTitle}
          </h2>
          <p className="text-xs text-[var(--c-text-dim)] mt-1">
            {isNewUser ? t.lockscreen.setupHint : t.lockscreen.unlockHint}
          </p>
        </div>
      </div>

      <div className="w-full max-w-[280px] flex flex-col gap-3">
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPasswordInput(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            placeholder={isNewUser ? t.lockscreen.newPasswordPlaceholder : t.lockscreen.passwordPlaceholder}
            className="input-field pr-10"
            autoFocus
            autoComplete="new-password"
          />
          <button
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--c-text-dimmer)] hover:text-[var(--c-text)]"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {isNewUser && (
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              placeholder={t.lockscreen.confirmPasswordPlaceholder}
              className="input-field pr-10"
              autoComplete="new-password"
            />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !password}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              {isNewUser ? <ArrowRight className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {isNewUser ? t.lockscreen.createWallet : t.lockscreen.unlock}
            </>
          )}
        </button>

        {isNewUser && (
          <div className="flex gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-300/80 leading-relaxed">
              {t.lockscreen.warning}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
