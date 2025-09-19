// popup.js
// Fetches all current tab titles and displays them. Allows generating a story and injecting it into page.
const url = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
const aiTabsReponse = [];

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

// STEP 2: Send Story to AI and get websites
async function sendStoryToAI(story, authToken) {
  if (!authToken) return 'No auth token set. Enter it above first.';
  const prompt =
    'Find a number of website available online that has titles that could relate to the story Im sending now. The number of websites can be up to you. Then, please separate each web addresses in the "result" with comma so i can process it later. The story is: ' +
    story;
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
    console.error('Story API error status:', resp.status, await resp.text());
    return `Failed (${resp.status}).`;
  }
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    console.error('Bad JSON:', e);
    return { error: 'Bad JSON response.' };
  }
  console.log('Story API response data:', data);

  // Handle the AI output - could be string, array, or object
  let output = data.output;

  // If it's an array, join it first (API sometimes returns char array)
  if (Array.isArray(output)) {
    output = output.join('');
  }

  // Try to parse as JSON if it's a string
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output);
    } catch (e) {
      // If it's not valid JSON, return as is
      console.log('Output is not JSON, returning as string');
    }
  }

  return output || { error: 'No result generated.' };
}

// STEP 3: Open tabs
async function openAIGeneratedTabs(websites) {
  if (!websites || websites.length === 0) {
    console.log('No websites to open');
    return;
  }

  console.log('Opening tabs for:', websites);

  for (const url of websites) {
    try {
      // Clean up the URL (remove extra spaces, add https if needed)
      let cleanUrl = url.trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'https://' + cleanUrl;
      }

      chrome.tabs.create({ url: cleanUrl, active: false });
      console.log('Opened tab:', cleanUrl);
    } catch (error) {
      console.error('Failed to open tab for:', url, error);
    }
  }
}

// STEP 4: Generate train of thought from the existing and current tabs just generated
async function generateTrainOfThought(titles, authToken) {
  if (!authToken) return 'No auth token set. Enter it above first.';
  const prompt =
    'Make a very short story (under 1000 characters) weaving together these tab titles. The story should be concise and meaningful, connecting the titles in a creative way. Tab titles: ' +
    titles.join(', ') +
    '. Keep the story under 1000 characters total.';
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
  let res;
  if (Array.isArray(data.output)) res = data.output.join('');
  else res = data.output;

  // ask for sound
  askForSound(res);

  return res || 'No thought generated.';
}

// STEP 4: Generate n play audio
async function askForSound(p_prompt) {
  console.log('prompting sound for ', p_prompt);

  const replicateProxy =
    'https://itp-ima-replicate-proxy.web.app/api/create_n_get';

  let data = {
    version: 'resemble-ai/chatterbox',
    input: {
      seed: 0,
      prompt: p_prompt,
      cfg_weight: 0.5,
      temperature: 0.8,
      exaggeration: 0.5,
    },
  };
  console.log('Asking for Sound Info From Replicate via Proxy', data);
  let options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    },
    body: JSON.stringify(data),
  };

  console.log('url', replicateProxy, 'options', options);
  const response = await fetch(replicateProxy, options);
  //console.log("picture_response", picture_info);
  const jsonResponse = await response.json();
  console.log('jsonResponse', jsonResponse.output);
  const ctx = new AudioContext();
  let incomingData = await fetch(jsonResponse.output);
  let arrayBuffer = await incomingData.arrayBuffer();
  let decodedAudio = await ctx.decodeAudioData(arrayBuffer);
  const playSound = ctx.createBufferSource();
  playSound.buffer = decodedAudio;
  playSound.connect(ctx.destination);
  playSound.start(ctx.currentTime);

  //playSound.loop = true;
}

// async function generateAudioFromText(text, authToken) {
//   if (!authToken) return { error: 'No auth token set.' };
//   if (!text || text.trim().length === 0) return { error: 'No text provided.' };

//   const url = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
//   const modelAndPrompt = {
//     model: 'lucataco/xtts-v2',
//     input: {
//       text: text.substring(0, 500),
//       speaker:
//         'https://replicate.delivery/pbxt/Jt79w0xsT64R1JsiJ0LQRL8UcWspg5J4RFWOyBXqVEuSWBkRA/male.wav',
//       language: 'en',
//     },
//   };

//   try {
//     const resp = await fetch(url, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Accept: 'application/json',
//         Authorization: `Bearer ${authToken}`,
//       },
//       body: JSON.stringify(modelAndPrompt),
//     });

//     if (!resp.ok) {
//       console.error('TTS API error status:', resp.status, await resp.text());
//       return { error: `TTS generation failed (${resp.status}).` };
//     }

//     const data = await resp.json();
//     console.log('TTS API response data:', data);

//     // The output should contain an audio URL
//     let audioUrl = data.output;

//     // Handle different response formats
//     if (Array.isArray(audioUrl)) {
//       audioUrl = audioUrl[0]; // Take first audio file if array
//     }

//     console.log('Audio URL:', audioUrl);
//     return audioUrl || { error: 'No audio generated.' };
//   } catch (e) {
//     console.error('TTS Network error:', e);
//     return { error: 'Network error during TTS generation.' };
//   }
// }

// UTILS
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
  document.getElementById('thought-output').textContent =
    '📝 Generating story from your tabs...';
  const thought = await generateTrainOfThought(currentTitles, token);
  document.getElementById('thought-output').textContent = thought;
  document.getElementById('thought-output').cursor = 'default';
  chrome.storage.local.set({
    lastCapture: { timestamp: Date.now(), titles: currentTitles, thought },
  });

  // Generate audio for the story
  // await generateAndPlayAudio(thought, token);

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

async function handleSendToAI() {
  const storyInput = document.getElementById('story-input').value.trim();
  if (!storyInput) {
    document.getElementById('ai-result').textContent =
      'Please enter a story first.';
    return;
  }

  const token = document.getElementById('auth-token').value.trim();
  if (!token) {
    document.getElementById('ai-result').textContent =
      'Please enter auth token first.';
    return;
  }

  // Save the token for future use
  saveToken(token);

  document.getElementById('ai-result').textContent =
    '🤖 AI is finding related websites...';
  const result = await sendStoryToAI(storyInput, token);

  // Convert result to string and process for array creation
  let displayText = '';
  let websiteArray = [];

  if (typeof result === 'object' && result.result) {
    if (Array.isArray(result.result)) {
      websiteArray = result.result;
    } else if (typeof result.result === 'string') {
      // Handle comma-separated string format
      websiteArray = result.result.split(',').map((url) => url.trim());
    }

    displayText = `Story: "${
      result.story
    }"\n\nWebsites found:\n${websiteArray.join(', ')}`;

    // Store the array in a variable you can use elsewhere
    window.aiGeneratedWebsites = websiteArray;
    console.log('AI Generated Websites Array:', websiteArray);
  } else if (typeof result === 'string') {
    // If result is just a string, try to extract URLs
    const urlPattern = /(https?:\/\/[^\s,]+)/g;
    const matches = result.match(urlPattern);
    if (matches) {
      websiteArray = matches.map((url) => url.trim());
      window.aiGeneratedWebsites = websiteArray;
      console.log('Extracted URLs from string:', websiteArray);
    }
    displayText = result;
  } else if (typeof result === 'object') {
    displayText = JSON.stringify(result, null, 2);
  } else {
    displayText = result;
  }

  document.getElementById('ai-result').textContent = displayText;

  // Automatically open tabs and generate new story if we found websites
  if (websiteArray.length > 0) {
    document.getElementById('ai-result').textContent +=
      '\n\n🌐 Opening new tabs and preparing enhanced story...';

    // Open all the tabs
    await openAIGeneratedTabs(websiteArray);

    // Wait a bit for tabs to load
    setTimeout(async () => {
      // Capture all tabs again (including the new ones)
      document.getElementById('ai-result').textContent +=
        '\n📋 Capturing all tabs (including new ones)...';
      await capture();

      // Get the token for the new generation
      const token = document.getElementById('auth-token').value.trim();
      if (token) {
        // Generate new story with all tabs (old + new)
        document.getElementById('thought-output').textContent =
          '📝 Generating enhanced story with all tabs...';
        document.getElementById('ai-result').textContent +=
          '\n📝 Creating enhanced story...';
        const newThought = await generateTrainOfThought(currentTitles, token);
        document.getElementById('thought-output').textContent = newThought;

        // Generate audio for the new story
        document.getElementById('ai-result').textContent +=
          '\n🎵 Converting enhanced story to audio...';
        // await generateAndPlayAudio(newThought, token);

        // Update the AI result to show completion
        document.getElementById('ai-result').textContent =
          displayText +
          '\n\n✅ Complete! Tabs opened, enhanced story generated, and audio created!';

        // Store the updated capture
        chrome.storage.local.set({
          lastCapture: {
            timestamp: Date.now(),
            titles: currentTitles,
            thought: newThought,
          },
        });
      }
    }, 3000); // Wait 3 seconds for tabs to load
  }
}

document.getElementById('refresh').addEventListener('click', capture);
document.getElementById('send-to-ai').addEventListener('click', handleSendToAI);

loadToken().then((t) => {
  if (t) document.getElementById('auth-token').value = t;
});
capture();
