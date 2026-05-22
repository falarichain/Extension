chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('falari_wallet_state', (result) => {
    if (!result.falari_wallet_state) {
      chrome.storage.local.set({
        falari_wallet_state: {
          accounts: [],
          selectedAccount: null,
          wallets: [],
          agentKeys: [],
          chainNode: {
            url: 'http://localhost:8080',
            label: 'Local Devnet',
          },
        },
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    chrome.storage.local.get('falari_wallet_state', (result) => {
      sendResponse(result.falari_wallet_state || null);
    });
    return true;
  }

  if (message.type === 'SET_STATE') {
    chrome.storage.local.set({ falari_wallet_state: message.state }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_PRIVATE_KEY') {
    chrome.storage.local.get(`pk_${message.address}`, (result) => {
      sendResponse(result[`pk_${message.address}`] || null);
    });
    return true;
  }

  if (message.type === 'STORE_PRIVATE_KEY') {
    chrome.storage.local.set(
      { [`pk_${message.address}`]: message.privateKey },
      () => {
        sendResponse({ success: true });
      },
    );
    return true;
  }

  if (message.type === 'NOTIFY') {
    if (message.notification) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: message.notification.title || 'Falari Wallet',
        message: message.notification.message || '',
      });
    }
    sendResponse({ success: true });
    return true;
  }
});

export {};
