import { ReactNode, useState } from 'react';
import {
  LayoutDashboard,
  ArrowUpCircle,
  ArrowDownCircle,
  Settings,
  Shield,
  PanelRight,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ChainApi } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import WalletSelectorFull from './WalletSelectorFull';

type Page = 'dashboard' | 'agent-keys' | 'upload' | 'download' | 'settings' | 'welcome';

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  chainNode: { url: string; label: string };
  chainStatus: any;
  theme: 'dark' | 'light';
  api: ChainApi;
  children: ReactNode;
}

const navItems: { id: Page; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'agent-keys', icon: Shield },
  { id: 'upload', icon: ArrowUpCircle },
  { id: 'download', icon: ArrowDownCircle },
  { id: 'settings', icon: Settings },
];

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function Layout({ currentPage, onNavigate, chainNode, chainStatus, theme, api, children }: Props) {
  const { t } = useI18n();
  const accounts = useAppStore((s) => s.accounts);
  const selectedAccount = useAppStore((s) => s.selectedAccount);
  const [walletOpen, setWalletOpen] = useState(false);
  const [isSidePanel] = useState(
    () => new URLSearchParams(window.location.search).get('mode') === 'sidepanel',
  );

  const selectedWallet = accounts.find((a) => a.address === selectedAccount) ?? null;

  const navLabel: Record<string, string> = {
    dashboard: t.nav.dashboard,
    'agent-keys': t.nav.agentKeys,
    upload: t.nav.upload,
    download: t.nav.download,
    settings: t.nav.settings,
  };

  const openSidePanel = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch {}
  };

  return (
    <div
      data-theme={theme}
      className={`bg-[var(--c-bg)] relative w-full h-full overflow-hidden grid ${
        currentPage !== 'welcome'
          ? 'grid-rows-[56px_minmax(0,1fr)_64px]'
          : 'grid-rows-[56px_minmax(0,1fr)]'
      }`}
    >
      {currentPage !== 'welcome' && (
        <WalletSelectorFull open={walletOpen} onClose={() => setWalletOpen(false)} api={api} />
      )}

      <header className="px-4 flex items-center justify-between border-b border-[var(--c-border)] min-w-0">


        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center shrink-0">
            <img src="/icons/icon48.png" alt="Falari" className="w-8 h-8" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-bold text-[var(--c-text)]">Falari</h1>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chainStatus ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-[10px] text-[var(--c-text-dim)] truncate max-w-[116px]">{chainNode.label}</span>
              {chainStatus && (
                <span className="text-[10px] text-[var(--c-text-dimmer)] shrink-0">
                  #{chainStatus.height?.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isSidePanel && (
            <button
              onClick={openSidePanel}
              className="w-7 h-7 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] flex items-center justify-center hover:bg-[var(--c-surface-hover)] transition-colors"
              title={t.nav.sidePanel || 'Side Panel'}
            >
              <PanelRight className="w-3.5 h-3.5 text-[var(--c-text-dimmer)]" />
            </button>
          )}
          {currentPage !== 'welcome' && (
            <button
              onClick={() => setWalletOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--c-surface)] border border-[var(--c-border)] hover:bg-[var(--c-surface-hover)] transition-colors max-w-[160px] min-w-0"
            >
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-600/30 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h13a1 1 0 0 1 0 2H8a2 2 0 0 0 0 4h7a2 2 0 0 1 0 4H8a2 2 0 0 1 0-4h5" />
                </svg>
              </div>
              <span className="text-[11px] font-medium text-[var(--c-text)] truncate">
                {selectedWallet ? truncateAddress(selectedWallet.address) : t.dashboard.noAccount}
              </span>
              <svg className="w-3 h-3 text-[var(--c-text-dim)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <main className={`min-h-0 overflow-y-auto scrollbar-thin ${currentPage === 'welcome' ? '' : 'px-3 py-3'}`}>
        {children}
      </main>

      {currentPage !== 'welcome' && (
        <nav className="px-2 border-t border-[var(--c-border)] flex items-center justify-around bg-[var(--c-nav-bg)] min-w-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all duration-200 ${
                  active
                    ? 'text-blue-400'
                    : 'text-[var(--c-text-dimmer)] hover:text-[var(--c-text)]'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium truncate max-w-[58px]">{navLabel[item.id]}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
