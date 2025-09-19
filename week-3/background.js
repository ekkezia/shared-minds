// background.js (service worker)
// Currently minimal. Keeps a log of the last popup open event and can be expanded later.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Tab Title Logger] Installed.');
});

chrome.runtime.onStartup &&
  chrome.runtime.onStartup.addListener(() => {
    console.log('[Tab Title Logger] Browser startup detected.');
  });

// Listen for popup (action) being opened via a message sent by popup if needed later.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ ok: true, time: Date.now() });
    return true;
  }
});
