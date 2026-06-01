import { ReactNode, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ArrowUpCircle,
  ArrowDownCircle,
  Settings,
  Shield,
  PanelRight,
  Share2,
  Users,
  ArrowLeftRight,
  HardDrive,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ChainApi } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import WalletSelectorFull from './WalletSelectorFull';
import { extensionAssetUrl } from '@/lib/extensionAssets';

type Page = 'dashboard' | 'staking' | 'bridge' | 'agent-keys' | 'multisig' | 'upload' | 'download' | 'share' | 'data' | 'settings' | 'welcome';

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
  { id: 'bridge', icon: ArrowLeftRight },
  { id: 'agent-keys', icon: Shield },
  { id: 'multisig', icon: Users },
  { id: 'upload', icon: ArrowUpCircle },
  { id: 'download', icon: ArrowDownCircle },
  { id: 'share', icon: Share2 },
  { id: 'data', icon: HardDrive },
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

  useEffect(() => {
    if (!isSidePanel) return;

    document.documentElement.dataset.mode = 'sidepanel';
    document.documentElement.style.width = '100%';
    document.documentElement.style.height = '100%';
    document.body.style.width = '100%';
    document.body.style.height = '100vh';
    document.body.style.minHeight = '100vh';

    const root = document.getElementById('root');
    if (root) {
      root.style.width = '100%';
      root.style.height = '100vh';
      root.style.minHeight = '100vh';
    }
  }, [isSidePanel]);

  const selectedWallet = accounts.find((a) => a.address === selectedAccount) ?? null;

  const navLabel: Record<string, string> = {
    dashboard: t.nav.dashboard,
    bridge: t.nav.bridge || 'Bridge',
    'agent-keys': t.nav.agentKeys,
    multisig: 'Multisig',
    upload: t.nav.upload,
    download: t.nav.download,
    share: '分享',
    data: t.nav.data || 'Data',
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
      style={isSidePanel ? { height: '100dvh', minHeight: '100dvh' } : undefined}
      className={`app-shell bg-[var(--c-bg)] relative flex min-h-0 w-full flex-col overflow-hidden ${
        isSidePanel ? 'h-screen' : 'h-full'
      }`}
    >
      {currentPage !== 'welcome' && (
        <WalletSelectorFull open={walletOpen} onClose={() => setWalletOpen(false)} api={api} />
      )}

      <header className="app-header flex h-[60px] shrink-0 items-center justify-between border-b border-[var(--c-border)] bg-[var(--c-nav-bg)] px-4 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 flex items-center justify-center shrink-0">
            <img src={extensionAssetUrl('icons/icon48.png')} alt="Falari" className="w-9 h-9" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-[var(--c-text)] leading-5">Falari</h1>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chainStatus ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-[11px] font-semibold text-[var(--c-text-dim)] truncate max-w-[126px]">{chainNode.label}</span>
              {chainStatus && (
                <span className="text-[11px] font-semibold text-[var(--c-text-dimmer)] shrink-0 tabular-nums">
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
              className="w-8 h-8 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] flex items-center justify-center hover:bg-[var(--c-surface-hover)] transition-colors"
              title={t.nav.sidePanel || 'Side Panel'}
            >
              <PanelRight className="w-4 h-4 text-[var(--c-text-dim)]" />
            </button>
          )}
          {currentPage !== 'welcome' && (
            <button
              onClick={() => setWalletOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--c-surface)] border border-[var(--c-border)] hover:bg-[var(--c-surface-hover)] transition-colors max-w-[174px] min-w-0"
            >
              <div className="icon-tile icon-tile-blue w-6 h-6 shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h13a1 1 0 0 1 0 2H8a2 2 0 0 0 0 4h7a2 2 0 0 1 0 4H8a2 2 0 0 1 0-4h5" />
                </svg>
              </div>
              <span className="text-[12px] font-bold text-[var(--c-text)] truncate">
                {selectedWallet ? truncateAddress(selectedWallet.address) : t.dashboard.noAccount}
              </span>
              <svg className="w-3.5 h-3.5 text-[var(--c-text-dim)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <main className={`min-h-0 flex-1 overflow-y-auto scrollbar-thin ${currentPage === 'welcome' ? '' : 'px-3 py-3'}`}>
        {children}
      </main>

      {currentPage !== 'welcome' && (
        <nav className="app-nav flex h-[68px] shrink-0 items-center justify-around border-t border-[var(--c-border)] bg-[var(--c-nav-bg)] px-2 min-w-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex min-w-[58px] flex-col items-center gap-1 px-2 py-1.5 rounded-lg transition-all duration-200 ${
                  active
                    ? 'nav-item-active'
                    : 'text-[var(--c-text-dimmer)] hover:bg-[var(--c-tab-hover-bg)] hover:text-[var(--c-text)]'
                }`}
              >
                <span className={`${active ? 'icon-tile w-7 h-7' : 'flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--c-surface)]'} transition-colors`}>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.6 : 2.25} />
                </span>
                <span className="text-[11px] font-bold truncate max-w-[58px]">{navLabel[item.id]}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
