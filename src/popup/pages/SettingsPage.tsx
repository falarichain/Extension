import { useState, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChainNodeConfig } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';
import {
  Settings,
  Globe,
  Sun,
  Moon,
  Trash2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface SettingsPageProps {
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
}

export function SettingsPage({ theme, onThemeChange }: SettingsPageProps) {
  const { t, lang, setLang, availableLangs } = useI18n();

  const NODE_PRESETS: { label: string; url: string }[] = [
    { label: t.settings.localDevnet, url: 'http://localhost:8080' },
    { label: t.settings.testnet, url: 'https://testnet.falari.network' },
  ];

  const chainNode = useAppStore((s) => s.chainNode);
  const setChainNode = useAppStore((s) => s.setChainNode);
  const saveState = useAppStore((s) => s.saveState);
  const accounts = useAppStore((s) => s.accounts);
  const agentKeys = useAppStore((s) => s.agentKeys);

  const [nodeUrl, setNodeUrl] = useState(chainNode.url);
  const [nodeLabel, setNodeLabel] = useState(chainNode.label);
  const [nodeSaved, setNodeSaved] = useState(false);
  const [nodeError, setNodeError] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleSaveNode = useCallback(async () => {
    setNodeError('');
    setNodeSaved(false);

    const trimmedUrl = nodeUrl.trim();
    if (!trimmedUrl) {
      setNodeError(t.settings.nodeRequired);
      return;
    }

    try {
      new URL(trimmedUrl);
    } catch {
      setNodeError(t.settings.nodeInvalid);
      return;
    }

    const config: ChainNodeConfig = {
      url: trimmedUrl,
      label: nodeLabel.trim() || new URL(trimmedUrl).hostname,
    };

    setChainNode(config);
    await saveState();
    setNodeSaved(true);
    setTimeout(() => setNodeSaved(false), 2000);
  }, [nodeUrl, nodeLabel, setChainNode, saveState, t]);

  const handlePresetNode = useCallback(
    (preset: { label: string; url: string }) => {
      setNodeUrl(preset.url);
      setNodeLabel(preset.label);
      setNodeError('');
      setNodeSaved(false);
    },
    [],
  );

  const handleClearData = useCallback(async () => {
    try {
      await chrome.storage.local.clear();
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear data:', err);
    }
  }, []);

  const isDark = theme === 'dark';

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-blue-400" />
        <span className="text-[13px] font-semibold text-white">{t.settings.title}</span>
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-400" />
          <span className="text-[13px] font-semibold text-white">{t.settings.chainNode}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-slate-500">{t.settings.nodeLabel}</label>
          <input
            className="input-field text-[13px]"
            placeholder={t.settings.nodeLabelPlaceholder}
            value={nodeLabel}
            onChange={(e) => {
              setNodeLabel(e.target.value);
              setNodeError('');
              setNodeSaved(false);
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-slate-500">{t.settings.nodeUrl}</label>
          <input
            className="input-field text-[13px]"
            placeholder={t.settings.nodeUrlPlaceholder}
            value={nodeUrl}
            onChange={(e) => {
              setNodeUrl(e.target.value);
              setNodeError('');
              setNodeSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveNode();
            }}
          />
          {nodeError && (
            <p className="text-[11px] text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {nodeError}
            </p>
          )}
          {nodeSaved && (
            <p className="text-[11px] text-emerald-400">{t.settings.nodeSaved}</p>
          )}
        </div>

        <button
          onClick={handleSaveNode}
          className="btn-primary flex items-center justify-center gap-2 py-2.5 text-[13px]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.settings.saveNode}
        </button>

        <div className="border-t border-white/[0.06] pt-3">
          <p className="text-[11px] text-slate-500 mb-2">{t.settings.quickPresets}</p>
          <div className="flex flex-col gap-1.5">
            {NODE_PRESETS.map((preset) => {
              const isActive =
                nodeUrl.trim() === preset.url && nodeLabel.trim() === preset.label;
              return (
                <button
                  key={preset.url}
                  onClick={() => handlePresetNode(preset)}
                  disabled={isActive}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[12px] transition-all duration-200 ${
                    isActive
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                  }`}
                >
                  <span>{preset.label}</span>
                  <span className="text-[10px] text-slate-600">{preset.url}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {isDark ? (
            <Moon className="w-4 h-4 text-purple-400" />
          ) : (
            <Sun className="w-4 h-4 text-amber-400" />
          )}
          <span className="text-[13px] font-semibold text-white">{t.settings.appearance}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-slate-300">{t.settings.theme}</span>
            <span className="text-[11px] text-slate-500">
              {isDark ? t.settings.darkMode : t.settings.lightMode}
            </span>
          </div>
          <button
            onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
            className="relative w-12 h-7 rounded-full bg-white/[0.06] border border-white/[0.1] transition-colors duration-200"
          >
            <div
              className={`absolute top-0.5 w-6 h-6 rounded-full bg-white/[0.12] border border-white/[0.12] flex items-center justify-center transition-all duration-200 ${
                isDark ? 'left-0.5' : 'left-[calc(100%-26px)]'
              }`}
            >
              {isDark ? (
                <Moon className="w-3.5 h-3.5 text-purple-400" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              )}
            </div>
          </button>
        </div>
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          <span className="text-[13px] font-semibold text-white">{t.settings.language}</span>
        </div>
        <div className="flex gap-2">
          {(Object.keys(availableLangs) as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium border transition-all ${
                lang === l
                  ? 'border-blue-400/30 bg-blue-400/10 text-blue-300'
                  : 'border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/[0.1]'
              }`}
            >
              {availableLangs[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400" />
          <span className="text-[13px] font-semibold text-white">{t.settings.data}</span>
        </div>

        <p className="text-[11px] text-slate-500">
          {t.settings.dataWarning}
        </p>

        {clearConfirm ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-[11px] text-red-300">
                {t.settings.confirmClear}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClearData}
                className="btn-danger flex-1 py-2.5 text-[13px]"
              >
                {t.settings.yesClear}
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="btn-secondary py-2.5 px-4 text-[13px]"
              >
                {t.wallet.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setClearConfirm(true)}
            className="btn-danger flex items-center justify-center gap-2 py-2.5 text-[13px]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.settings.clearAll}
          </button>
        )}
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-white">{t.settings.about}</span>
          <span className="badge badge-info">{t.settings.version}</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-slate-400">Falari</span>
            <span className="text-[12px] text-slate-400">
              {t.settings.accountsKeys
                .replace('{accounts}', String(accounts.length))
                .replace('{keys}', String(agentKeys.length))}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {t.settings.aboutDesc}
          </p>
        </div>
      </div>
    </div>
  );
}
