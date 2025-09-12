# Week 2 – Browser Extension Template

This folder contains a minimal Chrome (Manifest V3) extension scaffold that captures all open tab titles when the popup is opened. These titles are intended to act as raw material for a future "train of thoughts" feature.

## Features

- Manifest V3 structure (service worker background)
- Popup UI listing unique tab titles
- Logs titles to the console for quick inspection
- Stores the latest capture (titles + simple synthesized thought seed) in `chrome.storage.local`
- Refresh button to recapture without closing the popup

## File Overview

- `manifest.json` – Extension metadata & permissions
- `popup.html` – Popup UI
- `popup.js` – Logic to query tabs, render titles, generate placeholder thought text
- `background.js` – Service worker (currently only basic lifecycle logging and message handler)
- `styles.css` – Simple dark theme styling

## Permissions Justification

- `tabs`: Needed to read current tab titles via `chrome.tabs.query`.
- `storage`: Persist last capture for potential later processing or debugging.

## Load the Extension (Chrome / Chromium)

1. Open `chrome://extensions/`
2. Enable Developer Mode (toggle top-right)
3. Click "Load unpacked"
4. Select the `week-2` folder (this folder _directly_ containing `manifest.json`)
5. Click the extension icon (pin it first if needed) – the popup should list your open tab titles.
