// popup.js
// Fetches all current tab titles and displays them. Allows generating a story and injecting it into page.

async function queryAllTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => resolve(tabs || []));
  });
}

function dedupeTitles(tabs) {
  const seen = new Set();
  const titles = [];
  for (const t of tabs) {
    const title = (t.title || '').trim();
    if (title && !seen.has(title)) {
      seen.add(title);
      titles.push(title);
    }
  }
  return titles;
}

function renderTitles(titles) {
  const listEl = document.getElementById('tab-list');
  listEl.textContent = '';
  for (const title of titles) {
    const li = document.createElement('li');
    li.textContent = title;
    listEl.appendChild(li);
  }
  document.getElementById('count').textContent = String(titles.length);
  document.getElementById('status').textContent = titles.length
    ? 'Captured'
    : 'No tabs found';
}

async function generateTrainOfThought(titles, authToken) {
  if (!authToken) return 'No auth token set. Enter it above first.';
  const url = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
  const prompt =
    'Make a short story weaving together these tab titles, they had to be woven together in a way that made sense, the titles are: ' +
    titles.join(', ');
  const modelAndPrompt = { model: 'openai/gpt-5', input: { prompt } };
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(modelAndPrompt),
    });
  } catch (e) {
    console.error('Network error:', e);
    return 'Network error.';
  }
  if (!resp.ok) {
    console.error('ML API error status:', resp.status, await resp.text());
    return `Failed (${resp.status}).`;
  }
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    console.error('Bad JSON:', e);
    return 'Bad JSON response.';
  }
  console.log('ML API response data:', data);
  if (Array.isArray(data.output)) return data.output.join('');
  return data.output || 'No thought generated.';
}

function saveToken(token) {
  chrome.storage.local.set({ authToken: token });
}
function loadToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken'], (res) =>
      resolve(res.authToken || ''),
    );
  });
}

let currentTitles = [];
async function capture() {
  document.getElementById('status').textContent = 'Loading…';
  const tabs = await queryAllTabs();
  currentTitles = dedupeTitles(tabs);
  console.log('[Tab Title Logger] Captured titles:', currentTitles);
  renderTitles(currentTitles);
}

async function handleGenerate() {
  if (!currentTitles.length) {
    document.getElementById('thought-output').textContent =
      'No titles captured yet.';
    return;
  }
  const token = document.getElementById('auth-token').value.trim();
  if (!token) {
    document.getElementById('thought-output').textContent =
      'Enter a token first.';
    return;
  }
  saveToken(token);
  document.getElementById('thought-output').style.cursor = 'wait';
  document.getElementById('thought-output').textContent = 'Generating…';
  const thought = await generateTrainOfThought(currentTitles, token);
  document.getElementById('thought-output').textContent = thought;
  document.getElementById('thought-output').cursor = 'default';
  chrome.storage.local.set({
    lastCapture: { timestamp: Date.now(), titles: currentTitles, thought },
  });

  // Inject into active tab: ping, inject if needed, then send
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;
    chrome.tabs.sendMessage(tabId, { action: 'pingContent' }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        console.log('[Inject] content script missing, injecting...');
        chrome.scripting.executeScript(
          { target: { tabId }, files: ['content.js'] },
          () => {
            if (chrome.runtime.lastError) {
              console.error(
                '[Inject] executeScript failed:',
                chrome.runtime.lastError.message,
              );
              return;
            }
            chrome.tabs.sendMessage(
              tabId,
              { action: 'injectStory', story: thought },
              (r2) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    '[Inject] post-inject send failed:',
                    chrome.runtime.lastError.message,
                  );
                } else {
                  console.log('[Inject] story injected (after inject):', r2);
                }
              },
            );
          },
        );
      } else {
        chrome.tabs.sendMessage(
          tabId,
          { action: 'injectStory', story: thought },
          (r2) => {
            if (chrome.runtime.lastError) {
              console.error(
                '[Inject] send failed unexpectedly:',
                chrome.runtime.lastError.message,
              );
            } else {
              console.log('[Inject] story injected:', r2);
            }
          },
        );
      }
    });
  });
}

document.getElementById('refresh').addEventListener('click', capture);
document.getElementById('generate').addEventListener('click', handleGenerate);

loadToken().then((t) => {
  if (t) document.getElementById('auth-token').value = t;
});
capture();
