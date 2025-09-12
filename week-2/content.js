// content.js
console.log('[TrainOfTabs] content script loaded');

function ensureOverlay() {
  let overlay = document.getElementById('train-of-tabs-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'train-of-tabs-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      zIndex: 999999,
      width: '100vw',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      lineHeight: '1.3',
      color: '#222',
      background: 'rgba(255,255,255,0.5)',
      border: '1px solid #d0c870',
      padding: '8px 10px 10px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      backdropFilter: 'blur(2px)',
      whiteSpace: 'pre-wrap',
      overflow: 'auto',
      overflowY: 'scroll',
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '2px',
      right: '4px',
      background: 'transparent',
      border: 'none',
      fontSize: '16px',
      cursor: 'pointer',
      lineHeight: 1,
      color: '#444',
    });
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.appendChild(closeBtn);
    const title = document.createElement('div');
    title.textContent = 'Train of Thoughts';
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';
    overlay.appendChild(title);
    const content = document.createElement('div');
    content.id = 'train-of-tabs-overlay-content';
    overlay.appendChild(content);
    document.documentElement.appendChild(overlay);
  }
  return overlay.querySelector('#train-of-tabs-overlay-content');
}

async function typeIntoOverlay(text, delay = 40) {
  const target = ensureOverlay();
  target.textContent = '';
  const words = text.split(/(\s+)/); // keep spaces
  for (const token of words) {
    target.textContent += token;
    await new Promise((r) => setTimeout(r, delay));
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'pingContent') {
    sendResponse({ ok: true, ready: true });
    return; // no async needed
  }
  if (msg.action === 'injectStory') {
    console.log(
      '[TrainOfTabs] injectStory received. length=',
      msg.story?.length,
    );
    // Prefer overlay so it's always visible
    typeIntoOverlay(msg.story || '')
      .then(() => sendResponse({ status: 'injected-overlay' }))
      .catch((err) => {
        console.error('Overlay typing error, fallback to nearest div:', err);
        typeIntoNearestDiv(msg.story || '')
          .then(() => sendResponse({ status: 'injected-fallback' }))
          .catch((err2) => console.error('Typing fallback error:', err2));
      });

    // required for async sendResponse in MV3
    return true;
  }
});

function getNearestVisibleDiv() {
  const divs = Array.from(document.querySelectorAll('div'));
  const viewportTop = window.scrollY;
  const viewportBottom = viewportTop + window.innerHeight;

  const visibleDivs = divs.filter((div) => {
    const rect = div.getBoundingClientRect();
    const divTop = rect.top + window.scrollY;
    const divBottom = rect.bottom + window.scrollY;
    return divBottom > viewportTop && divTop < viewportBottom;
  });

  return visibleDivs[0] || document.body;
}

async function typeIntoNearestDiv(text, delay = 200) {
  const container = getNearestVisibleDiv();
  container.style.position = container.style.position || 'relative';
  let span = document.createElement('span');
  span.style.background = 'yellow'; // highlight injected text
  span.style.padding = '2px 4px';
  span.style.margin = '2px';
  span.style.borderRadius = '4px';
  container.appendChild(span);

  const words = text.split(' ');
  for (const word of words) {
    span.textContent += word + ' ';
    await new Promise((r) => setTimeout(r, delay));
  }
}
