import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { ChainApi } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import Layout from './components/Layout';
import LockScreen from './components/LockScreen';
import { Dashboard } from './pages/Dashboard';
import { AgentKeysPage } from './pages/AgentKeysPage';
import { UploadPage } from './pages/UploadPage';
import { DownloadPage } from './pages/DownloadPage';
import { SharePage } from './pages/SharePage';
import { MultisigPage } from './pages/MultisigPage';
import { SettingsPage } from './pages/SettingsPage';
import { StakingPage } from './pages/StakingPage';
import WelcomePage from './pages/WelcomePage';
import ApprovalPage from './pages/ApprovalPage';
import { extensionAssetUrl } from '@/lib/extensionAssets';

type Page = 'dashboard' | 'staking' | 'agent-keys' | 'multisig' | 'upload' | 'download' | 'share' | 'settings' | 'welcome';

export default function App() {
  const loadState = useAppStore((s) => s.loadState);
  const accounts = useAppStore((s) => s.accounts);
  const wallets = useAppStore((s) => s.wallets);
  const chainNode = useAppStore((s) => s.chainNode);
  const isLocked = useAppStore((s) => s.isLocked);
  const stateLoaded = useAppStore((s) => s.stateLoaded);
  const checkSessionUnlocked = useAppStore((s) => s.checkSessionUnlocked);
  const [page, setPage] = useState<Page>('dashboard');
  const [api] = useState(() => new ChainApi(chainNode.url));
  const [chainStatus, setChainStatus] = useState<any>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [initComplete, setInitComplete] = useState(false);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    (async () => {
      try {
        const result = await chrome.storage.local.get('falari_theme');
        if (result.falari_theme === 'light' || result.falari_theme === 'dark') {
          setTheme(result.falari_theme);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!stateLoaded) return;
    (async () => {
      const unlocked = await checkSessionUnlocked();
      if (unlocked) {
        useAppStore.getState().setLocked(false);
      }
      setInitComplete(true);
    })();
  }, [stateLoaded, checkSessionUnlocked]);

  useEffect(() => {
    if (!initComplete || isLocked) return;
    const hasWallets = wallets.length > 0 || accounts.length > 0;
    if (!hasWallets) {
      setPage('welcome');
      return;
    }
    setPage((current) => (current === 'welcome' ? 'dashboard' : current));
  }, [initComplete, isLocked, wallets, accounts]);

  const handleThemeChange = (newTheme: 'dark' | 'light') => {
    setTheme(newTheme);
    chrome.storage.local.set({ falari_theme: newTheme }).catch(() => {});
  };

  useEffect(() => {
    if (!initComplete || isLocked) return;
    api && api.getBaseUrl() !== chainNode.url &&
      Object.assign(api, new ChainApi(chainNode.url));
  }, [initComplete, isLocked, chainNode.url]);

  useEffect(() => {
    if (!initComplete || isLocked) return;
    const fetchStatus = async () => {
      try {
        const status = await api.getStatus();
        setChainStatus(status);
      } catch {
        setChainStatus(null);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [initComplete, isLocked, api]);

  // Approval mode: render standalone approval popup (no store initialization needed)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'approval') {
    return <ApprovalPage />;
  }

  if (!initComplete) {
    return (
      <I18nProvider>
        <div data-theme={theme} className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center bg-[var(--c-bg)]">
          <div className="flex flex-col items-center gap-3">
            <img src={extensionAssetUrl('icons/icon48.png')} alt="Falari" className="w-12 h-12 animate-pulse" />
          </div>
        </div>
      </I18nProvider>
    );
  }

  if (isLocked) {
    return (
      <I18nProvider>
        <div data-theme={theme} className="flex h-full min-h-0 w-full flex-1 flex-col">
          <LockScreen />
        </div>
      </I18nProvider>
    );
  }

  const renderPage = () => {
    switch (page) {
      case 'welcome':
        return <WelcomePage onWalletCreated={() => setPage('dashboard')} />;
      case 'dashboard':
        return <Dashboard api={api} chainStatus={chainStatus} onNavigateToStaking={() => setPage('staking')} />;
      case 'staking':
        return <StakingPage api={api} onBack={() => setPage('dashboard')} />;
      case 'agent-keys':
        return <AgentKeysPage api={api} />;
      case 'multisig':
        return <MultisigPage api={api} />;
      case 'upload':
        return <UploadPage api={api} />;
      case 'download':
        return <DownloadPage api={api} />;
      case 'share':
        return <SharePage api={api} />;
      case 'settings':
        return <SettingsPage theme={theme} onThemeChange={handleThemeChange} />;
      default:
        return <Dashboard api={api} chainStatus={chainStatus} onNavigateToStaking={() => setPage('staking')} />;
    }
  };

  return (
    <I18nProvider>
      <div data-theme={theme} className="flex h-full min-h-0 w-full flex-1 flex-col">
        <Layout currentPage={page} onNavigate={setPage} chainNode={chainNode} chainStatus={chainStatus} theme={theme} api={api}>
          {renderPage()}
        </Layout>
      </div>
    </I18nProvider>
  );
}
