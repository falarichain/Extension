/**
 * Content script bridge: relays messages between the page (inject.ts) and the extension background.
 * Runs in ISOLATED world with access to chrome.runtime.
 */

// Inject the inpage script into the MAIN world
function injectScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/content/inject.ts');
    script.type = 'module';
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (e) {
    console.error('[Falari] Failed to inject provider script:', e);
  }
}

injectScript();

// Relay page requests to background
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'falari-inpage' || data.type !== 'request') return;

  const { requestId, method, params } = data;

  // Map provider methods to background message types
  let bgType: string;
  switch (method) {
    case 'falari_getAccounts':
      bgType = 'DAPP_GET_ACCOUNTS';
      break;
    case 'falari_signHash':
      bgType = 'DAPP_SIGN_HASH';
      break;
    default:
      window.postMessage({
        source: 'falari-bridge',
        type: 'response',
        requestId,
        error: `Unknown method: ${method}`,
      }, '*');
      return;
  }

  chrome.runtime.sendMessage(
    { type: bgType, params, origin: window.location.origin },
    (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          source: 'falari-bridge',
          type: 'response',
          requestId,
          error: chrome.runtime.lastError.message || 'Extension communication failed',
        }, '*');
        return;
      }
      window.postMessage({
        source: 'falari-bridge',
        type: 'response',
        requestId,
        result: response?.result,
        error: response?.error,
      }, '*');
    },
  );
});
