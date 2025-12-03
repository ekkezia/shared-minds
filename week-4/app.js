// week-4/app.js - Clean implementation
// Features:
// - Save/clear Replicate token to localStorage
// - Image input and preview
// - Send image to repository proxy for detection (adirik/codet...)
// - Immediately fetch first replicate.delivery URL from data.output[0]
// - Parse j.objects and normalize boxes to [x,y,w,h]
// - Draw boxes on overlay canvas scaled to image natural size
// - Make boxes clickable; click sets `anchor` and calls displayEmbeddings()
// - Batch and request embeddings via repository proxy (beautyyuyanli/multilingual-e5-large...)
// - Store embeddings at all[key].embedding and group similar objects by cosine similarity

(function () {
  const TOKEN_KEY = 'replicateApiToken';
  const REPLICATE_PROXY =
    'https://itp-ima-replicate-proxy.web.app/api/create_n_get';

  // Default segmentation model (SAM) provided by user
  const DEFAULT_SAM_MODEL =
    'tmappdev/lang-segment-anything:891411c38a6ed2d44c004b7b9e44217df7a5b07848f29ddefd2e28bc7cbf93bc';

  // State
  let anchor = null; // selected key
  const all = {}; // key -> { label, embedding }
  let drawnBoxes = []; // [{ key, x, y, w, h }]
  let embeddingRequestItems = []; // [{ key, text }]
  let containerEl = null;
  let hoveredKey = null;
  // last draw parameters used to render the image into canvas
  // { offsetX, offsetY, drawW, drawH, scale }
  let lastDrawParams = null;

  // Utilities
  const $ = (id) => document.getElementById(id);
  function maskToken(t) {
    if (!t) return '(none)';
    if (t.length <= 8) return '*'.repeat(t.length);
    return t.slice(0, 4) + '...' + t.slice(-4);
  }

  function renderTokenStatus() {
    const t = localStorage.getItem(TOKEN_KEY);
    const el = $('tokenStatus');
    if (el)
      el.textContent = t ? `Saved token: ${maskToken(t)}` : 'No token saved';
  }

  function saveToken() {
    const v = (($('tokenInput') && $('tokenInput').value) || '').trim();
    if (!v) return;
    localStorage.setItem(TOKEN_KEY, v);
    renderTokenStatus();
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    if ($('tokenInput')) $('tokenInput').value = '';
    renderTokenStatus();
  }

  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const parts = r.result.split(',');
        res(parts[1]);
      };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Detection request: try JSON data-url first, then fall back to multipart
  async function sendDetectionRequest(token, modelVersion, file) {
    // Try JSON with data URL
    try {
      const dataUrl =
        'data:' + file.type + ';base64,' + (await fileToBase64(file));
      const jsonPayload = { version: modelVersion, input: { image: dataUrl } };
      const resp = await fetch(REPLICATE_PROXY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(jsonPayload),
      });
      if (resp.ok) return await resp.json();
      const txt = await resp.text();
      // If server returned a specific multipart-needed error, fallthrough to multipart
      if (
        !(
          resp.status === 500 &&
          txt &&
          txt.includes("'NoneType' object has no attribute 'read'")
        )
      ) {
        throw new Error(`Detection API error: ${resp.status} ${txt}`);
      }
    } catch (e) {
      console.warn(
        'JSON attempt failed, will try multipart:',
        e && e.message ? e.message : e,
      );
    }

    async function tryMultipart(fieldName) {
      const form = new FormData();
      form.append('version', modelVersion);
      form.append(fieldName, file, file.name || 'upload.jpg');
      const dataUrl =
        'data:' + file.type + ';base64,' + (await fileToBase64(file));
      form.append('input', JSON.stringify({ image: dataUrl }));
      const resp = await fetch(REPLICATE_PROXY, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(
          `Multipart (${fieldName}) API error: ${resp.status} ${txt}`,
        );
      }
      return await resp.json();
    }

    try {
      return await tryMultipart('image');
    } catch (e) {
      console.warn('Multipart image failed:', e && e.message ? e.message : e);
    }
    try {
      return await tryMultipart('file');
    } catch (e) {
      console.warn('Multipart file failed:', e && e.message ? e.message : e);
      throw new Error(
        'All upload methods failed: ' + (e && e.message ? e.message : e),
      );
    }
  }

  // Main flow: process selected image
  async function processImage() {
    const fileInput = $('imageInput');
    const resultsDiv = $('detectionResults');
    resultsDiv.textContent = '';
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      resultsDiv.textContent = 'Please choose an image first.';
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      resultsDiv.textContent = 'Please save your Replicate token first.';
      return;
    }

    resultsDiv.textContent = 'Uploading image and requesting detections...';
    document.getElementsByTagName('body')[0].style.cursor = 'wait';
    const modelVersion =
      'adirik/codet:a671251d28c23a1a476ecfe2e0e4924d49d8141d318eb7fe938b2dcdec952fdd';

    try {
      const data = await sendDetectionRequest(token, modelVersion, file);
      // Immediately fetch the first output URL if present
      let detections = [];
      if (Array.isArray(data.output) && data.output.length) {
        const first = data.output[0];
        if (typeof first === 'string') {
          const r = await fetch(first);
          if (!r.ok) throw new Error('Failed fetching output URL: ' + r.status);
          const j = await r.json();
          const objects = Array.isArray(j.objects) ? j.objects : [];
          detections = objects
            .map((it, idx) => normalizeDetection(it, idx))
            .filter(Boolean);
        } else if (Array.isArray(data.output)) {
          // fallback: sometimes output is the array of objects directly
          detections = data.output
            .map((it, idx) => normalizeDetection(it, idx))
            .filter(Boolean);
        }
      }

      if (!detections.length) {
        resultsDiv.textContent = 'No detections returned.';
        return;
      }

      const overlay = $('overlayCanvas');
      overlay.style.display = 'block';

      await drawDetectionsOnCanvas(overlay, $('preview'), detections);

      try {
        await getEmbeddings(token);
        document.getElementsByTagName('body')[0].style.cursor = 'default';
        const pre = document.createElement('pre');
        pre.textContent = 'Embeddings fetched';
        resultsDiv.appendChild(pre);
      } catch (err) {
        console.error('emb err', err);
      }
    } catch (err) {
      console.error('processImage error', err);
      resultsDiv.textContent =
        'Error: ' + (err && err.message ? err.message : err);
    }
  }

  function normalizeDetection(it, idx) {
    if (!it) return null;
    // infer label and score
    const label = it.class_name || it.class || it.label || `object${idx}`;
    const score = it.confidence || it.score || 0;
    // possible box fields: pred_boxes, bbox, box, bbox_xyxy
    const boxSrc = it.pred_boxes || it.bbox || it.box || it.bbox_xyxy || null;
    let box = null;
    if (Array.isArray(boxSrc) && boxSrc.length === 4) {
      const [a, b, c, d] = boxSrc.map(Number);
      // if it's [x1,y1,x2,y2]
      if (c > a && d > b) {
        box = [a, b, c - a, d - b];
      } else {
        // assume it's already [x,y,w,h]
        box = [a, b, c, d];
      }
    } else if (it.center_x && it.center_y && it.w && it.h) {
      // normalized center format
      const cx = Number(it.center_x);
      const cy = Number(it.center_y);
      const nw = Number(it.w);
      const nh = Number(it.h);
      box = [cx - nw / 2, cy - nh / 2, nw, nh];
    }
    return { box, label, score, key: it.id || `${label}#${idx}` };
  }

  async function drawDetectionsOnCanvas(canvasEl, imgEl, detections) {
    const ctx = canvasEl.getContext('2d');

    // Make canvas full-window and position it fixed so it fills available area
    canvasEl.style.position = 'fixed';
    canvasEl.style.left = '0';
    canvasEl.style.top = '0';
    canvasEl.style.width = '100dvw;';
    canvasEl.style.height = '100dvh;';
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;

    // Draw the image as the background of the canvas while preserving aspect ratio (letterbox)
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    const imgW = imgEl.naturalWidth || imgEl.width || canvasEl.width;
    const imgH = imgEl.naturalHeight || imgEl.height || canvasEl.height;
    // scale to fit while preserving aspect ratio
    const scale = Math.min(canvasEl.width / imgW, canvasEl.height / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const offsetX = Math.round((canvasEl.width - drawW) / 2);
    const offsetY = Math.round((canvasEl.height - drawH) / 2);
    lastDrawParams = { offsetX, offsetY, drawW, drawH, scale };
    try {
      ctx.drawImage(imgEl, offsetX, offsetY, drawW, drawH);
    } catch (e) {
      // image might not be loaded into imgEl; ignore
    }

    drawnBoxes = [];
    embeddingRequestItems = [];

    ctx.lineWidth = 2;
    ctx.font = '16px sans-serif';

    detections.forEach((det, i) => {
      if (!det.box || !Array.isArray(det.box) || det.box.length !== 4) return;
      let [bx, by, bw, bh] = det.box.map(Number);

      let x, y, w, h;
      // normalized coordinates relative to image (0..1)
      if (
        bx >= 0 &&
        bx <= 1 &&
        by >= 0 &&
        by <= 1 &&
        bw > 0 &&
        bw <= 1 &&
        bh > 0 &&
        bh <= 1
      ) {
        x = offsetX + bx * drawW;
        y = offsetY + by * drawH;
        w = bw * drawW;
        h = bh * drawH;
      } else {
        // assume box is in image pixel coordinates -> scale to canvas using same scale
        x = offsetX + bx * scale;
        y = offsetY + by * scale;
        w = bw * scale;
        h = bh * scale;
      }

      const key = det.key || `${det.label || 'obj'}#${i}`;
      drawnBoxes.push({ key, x, y, w, h, label: det.label || key });
      if (!all[key]) all[key] = { label: det.label || key };
      embeddingRequestItems.push({ key, text: all[key].label });
    });

    // initial render of boxes
    renderCanvas(canvasEl);
    console.log('drawnBoxes', drawnBoxes, 'lastDrawParams', lastDrawParams);
  }

  // Renders image + boxes; hoverKey controls highlight
  function renderCanvas(canvasEl) {
    const ctx = canvasEl.getContext('2d');
    // redraw background image using preview img if available
    const img = $('preview');
    if (img && img.src) {
      try {
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
      } catch (e) {}
    } else {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }

    // draw boxes; hovered box in different color
    drawnBoxes.forEach((b) => {
      if (b.key === hoveredKey) {
        ctx.strokeStyle = '#FF0000';
        ctx.fillStyle = 'rgba(255,0,0,0.2)';
        document.body.style.cursor = 'pointer';
      } else {
        ctx.strokeStyle = '#00FF00';
        ctx.fillStyle = 'rgba(0,255,0,0.05)';
        document.body.style.cursor = 'default';
      }
      ctx.lineWidth = b.key === hoveredKey ? 3 : 2;
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000000';
      ctx.fillText(b.label || b.key, b.x + 6, b.y + 18);
    });
  }

  // Embeddings: batch unique texts and store embeddings at all[key].embedding
  async function getEmbeddings(token) {
    if (!embeddingRequestItems || embeddingRequestItems.length === 0) return [];
    const unique = embeddingRequestItems.reduce((acc, it) => {
      if (!acc.find((x) => x.key === it.key)) acc.push(it);
      return acc;
    }, []);

    const texts = unique.map((u) => u.text);
    containerEl =
      containerEl ||
      $('container') ||
      (function () {
        const d = document.createElement('div');
        d.id = 'container';
        document.body.appendChild(d);
        return d;
      })();

    containerEl.innerHTML = 'Requesting embeddings...';

    const data = {
      version:
        'beautyyuyanli/multilingual-e5-large:a06276a89f1a902d5fc225a9ca32b6e8e6292b7f3b136518878da97c458e2bad',
      input: { texts: JSON.stringify(texts) },
    };

    const resp = await fetch(REPLICATE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('Embedding proxy error: ' + resp.status + ' ' + txt);
    }
    const j = await resp.json();
    const embeddings = j.output;
    if (!embeddings || embeddings.length !== texts.length)
      throw new Error('Embeddings count mismatch');

    unique.forEach((u, i) => {
      if (!all[u.key]) all[u.key] = { label: u.text };
      all[u.key].embedding = embeddings[i];
    });

    console.log('stored embeddings on all keys', Object.keys(all).length);
    containerEl.innerHTML = 'Embeddings ready';
    return embeddings;
  }

  // Generic helper to call the repository proxy for any Replicate model using provided token
  async function callReplicateModel(token, modelVersion, inputObj) {
    if (!token) throw new Error('No token provided');
    const resp = await fetch(REPLICATE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ version: modelVersion, input: inputObj }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('Model call failed: ' + resp.status + ' ' + txt);
    }
    return await resp.json();
  }

  // UTILS: Math Helpers
  function dotProduct(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function norm(a) {
    if (!a) return 0;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s);
  }

  // STEP 2: Cosine similarity and grouping
  function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    const dp = dotProduct(a, b);
    const na = norm(a);
    const nb = norm(b);
    if (na === 0 || nb === 0) return 0;
    return dp / (na * nb);
  }

  // Group by cosine similarity using union-find
  function groupEmbeddings(allMap, threshold = 0.85) {
    const keys = Object.keys(allMap).filter(
      (k) => allMap[k] && allMap[k].embedding,
    );
    const n = keys.length;
    if (n === 0) return [];
    const parent = new Array(n).fill(0).map((_, i) => i);
    function find(a) {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    }
    function union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const aKey = keys[i];
        const bKey = keys[j];
        const aEmb = allMap[aKey].embedding;
        const bEmb = allMap[bKey].embedding;
        const sim = cosineSimilarity(aEmb, bEmb);
        if (sim >= threshold) union(i, j);
      }
    }

    const groups = {};
    for (let i = 0; i < n; i++) {
      const r = find(i);
      groups[r] = groups[r] || [];
      groups[r].push(keys[i]);
    }
    return Object.values(groups);
  }

  // STEP 1: Display embeddings UI
  function displayEmbeddingsAsImage() {
    const overlay = $('overlayCanvas');
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    containerEl =
      containerEl ||
      $('container') ||
      (function () {
        const d = document.createElement('div');
        d.id = 'container';
        document.body.appendChild(d);
        return d;
      })();
    containerEl.innerHTML = '';

    const anchorEmbedding = all[anchor].embedding;
    console.log('displaying embedding for anchor', anchor);

    const results = [];
    for (const key in all) {
      if (key === anchor) continue;
      if (!all[key] || !all[key].embedding) continue;
      const sim = cosineSimilarity(anchorEmbedding, all[key].embedding);
      results.push({ key, similarity: sim });
    }

    results.sort((a, b) => b.similarity - a.similarity);

    // DISPLAY EMBEDDINGS AS IMAGE ROW
    try {
      rebuildImageFromDetections();
    } catch (e) {
      console.error('rebuild failed', e);
    }

    // OVERLAY THE EMBEDDINGS (on bbox)
    try {
      overlayEmbeddingAssignments();
    } catch (e) {
      console.error('overlay assign failed', e);
    }
  }

  // Rebuild image collage: crop each detected box from preview image, order by nearest neighbor in embedding space
  function rebuildImageFromDetections() {
    if (!drawnBoxes || drawnBoxes.length === 0) {
      containerEl.innerHTML = 'No detections to rebuild from';
      return;
    }
    const img = $('preview');
    if (!img || !img.src) {
      containerEl.innerHTML = 'Preview image not available';
      return;
    }

    // Gather items that have embeddings
    const items = drawnBoxes
      .map((b) => ({
        key: b.key,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        label: b.label,
        emb: all[b.key] && all[b.key].embedding ? all[b.key].embedding : null,
      }))
      .filter((it) => it.emb && it.w > 4 && it.h > 4);

    if (items.length === 0) {
      containerEl.innerHTML = 'No items with embeddings to rebuild';
      return;
    }

    // Compute pairwise distances (1 - cosine similarity)
    function sim(a, b) {
      return cosineSimilarity(a, b);
    }

    // Nearest-neighbor ordering: start from anchor if available, else pick first
    const used = new Set();
    const order = [];
    let curIdx = 0;
    if (anchor) {
      const i = items.findIndex((it) => it.key === anchor);
      if (i >= 0) curIdx = i;
    }
    order.push(items[curIdx]);
    used.add(items[curIdx].key);

    while (order.length < items.length) {
      const last = order[order.length - 1];
      let best = -1;
      let bestSim = -Infinity;
      for (let i = 0; i < items.length; i++) {
        if (used.has(items[i].key)) continue;
        const s = sim(last.emb, items[i].emb);
        if (s > bestSim) {
          bestSim = s;
          best = i;
        }
      }
      if (best === -1) break;
      order.push(items[best]);
      used.add(items[best].key);
    }

    // Build horizontal collage: uniform height, preserve aspect ratio
    const targetH = 200; // px per item height
    const canvW = order.reduce(
      (acc, it) => acc + Math.round((it.w / it.h) * targetH) + 8,
      0,
    );
    const canvH = targetH + 20;
    const c = document.createElement('canvas');
    c.width = canvW;
    c.height = canvH;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, c.width, c.height);

    // To crop properly, we need the mapping between drawnBoxes (canvas coords) and the source image natural pixels.
    // We assume lastDrawParams exists and img natural size is known.
    const params = lastDrawParams || {
      offsetX: 0,
      offsetY: 0,
      drawW: img.naturalWidth,
      drawH: img.naturalHeight,
      scale: 1,
    };
    const scaleBack = img.naturalWidth / params.drawW || 1;

    let cursorX = 0;
    order.forEach((it) => {
      // compute source rect in natural image coordinates
      const sx = Math.max(0, Math.round((it.x - params.offsetX) * scaleBack));
      const sy = Math.max(0, Math.round((it.y - params.offsetY) * scaleBack));
      const sw = Math.max(1, Math.round(it.w * scaleBack));
      const sh = Math.max(1, Math.round(it.h * scaleBack));

      const dw = Math.round((sw / sh) * targetH);
      const dh = targetH;
      try {
        cx.drawImage(img, sx, sy, sw, sh, cursorX, 10, dw, dh);
      } catch (e) {
        // drawing may fail if coordinates are out of range
        cx.fillStyle = '#eee';
        cx.fillRect(cursorX, 10, dw, dh);
      }
      // label
      cx.fillStyle = '#000';
      cx.font = '12px sans-serif';
      cx.fillText(it.label || it.key, cursorX + 6, 10 + dh + 12);
      cursorX += dw + 8;
    });

    // Append the collage to the container
    const existing = containerEl.querySelector('canvas.rebuilt-canvas');
    if (existing) existing.remove();
    c.className = 'rebuilt-canvas';
    c.style.maxWidth = '100%';
    c.style.height = 'auto';
    containerEl.appendChild(c);
  }

  // Overlay embedding-ordered objects into bboxes sorted left->right on the overlay canvas
  async function overlayEmbeddingAssignments() {
    if (!drawnBoxes || drawnBoxes.length === 0) {
      containerEl.innerHTML = 'No detections available for assignment';
      return;
    }
    if (!anchor || !all[anchor] || !all[anchor].embedding) {
      containerEl.innerHTML =
        'Select an anchor object first (click a bbox on the image)';
      return;
    }

    const img = $('preview');
    if (!img || !img.src) {
      containerEl.innerHTML = 'Preview image not available';
      return;
    }

    // Order bboxes left-to-right by x coordinate (tie-breaker by y)
    const boxes = drawnBoxes.slice().sort((a, b) => {
      if (a.x === b.x) return a.y - b.y;
      return a.x - b.x;
    });

    // Compute similarity-sorted object keys relative to anchor
    const anchorEmb = all[anchor].embedding;
    const others = Object.keys(all)
      .filter((k) => k !== anchor && all[k] && all[k].embedding)
      .map((k) => ({
        key: k,
        sim: cosineSimilarity(anchorEmb, all[k].embedding),
      }))
      .sort((a, b) => b.sim - a.sim)
      .map((x) => x.key);

    if (others.length === 0) {
      containerEl.innerHTML = 'No other objects with embeddings to assign';
      return;
    }

    // Prepare overlay canvas (make visible and draw original image as background)
    const overlay = $('overlayCanvas');
    overlay.style.display = 'block';
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    // draw preview image into the overlay using lastDrawParams mapping so boxes line up
    if (lastDrawParams && lastDrawParams.drawW && lastDrawParams.drawH) {
      try {
        ctx.drawImage(
          img,
          lastDrawParams.offsetX,
          lastDrawParams.offsetY,
          lastDrawParams.drawW,
          lastDrawParams.drawH,
        );
      } catch (e) {
        // fallback: draw full canvas
        try {
          ctx.drawImage(img, 0, 0, overlay.width, overlay.height);
        } catch (e2) {}
      }
    } else {
      try {
        ctx.drawImage(img, 0, 0, overlay.width, overlay.height);
      } catch (e) {}
    }

    // Map objects to boxes: if counts differ, we'll assign up to min length; extras are ignored
    const count = Math.min(boxes.length, others.length);

    // Map natural image coords conversion
    const params = lastDrawParams || {
      offsetX: 0,
      offsetY: 0,
      drawW: img.naturalWidth,
      drawH: img.naturalHeight,
      scale: 1,
    };
    const scaleBack = img.naturalWidth / params.drawW || 1;

    for (let i = 0; i < count; i++) {
      const box = boxes[i];
      const objKey = others[i];
      // find source box for objKey in drawnBoxes (original canvas coords)
      const srcBox = drawnBoxes.find((b) => b.key === objKey);
      if (!srcBox) continue;

      // compute source rect in natural image coordinates
      const sx = Math.max(
        0,
        Math.round((srcBox.x - params.offsetX) * scaleBack),
      );
      const sy = Math.max(
        0,
        Math.round((srcBox.y - params.offsetY) * scaleBack),
      );
      const sw = Math.max(1, Math.round(srcBox.w * scaleBack));
      const sh = Math.max(1, Math.round(srcBox.h * scaleBack));

      // destination rect is the bbox on overlay canvas (already in canvas coords)
      const dx = box.x;
      const dy = box.y;
      const dw = box.w;
      const dh = box.h;

      try {
        // draw source crop scaled to destination bbox (cover behavior: fill bbox)
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        // optionally draw a border showing assignment
        ctx.strokeStyle = 'rgba(255,0,0,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(dx + 4, dy + 4, 120, 18);
        ctx.fillStyle = '#000';
        ctx.font = '12px sans-serif';
        ctx.fillText(objKey, dx + 8, dy + 16);
      } catch (e) {
        console.warn('draw assignment failed for', objKey, e);
      }
    }
  }

  // Setup DOM and listeners
  document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = $('saveToken');
    const clearBtn = $('clearToken');
    const inputFile = $('imageInput');
    const preview = $('preview');
    const overlay = $('overlayCanvas');

    // View toggle: switch between overlay canvas and embeddings-as-row (container)
    try {
      const viewToggle = document.createElement('button');
      viewToggle.id = 'viewToggleBtn';
      viewToggle.textContent = 'Show row view';
      viewToggle.style.display = 'inline-block';
      viewToggle.style.marginBottom = '12px';
      // make button fixed and above overlay canvas so it's always clickable
      viewToggle.style.position = 'fixed';
      viewToggle.style.top = '8px';
      viewToggle.style.left = '8px';
      viewToggle.style.zIndex = 20000;
      viewToggle.style.background = 'rgba(255,255,255,0.95)';
      viewToggle.style.border = '1px solid #ccc';
      viewToggle.style.padding = '8px 10px';
      viewToggle.style.borderRadius = '4px';
      // insert at top of body
      document.body.insertBefore(viewToggle, document.body.firstChild);
      viewToggle.addEventListener('click', () => {
        try {
          const overlayEl = $('overlayCanvas');
          let container = $('container');
          const overlayVisible =
            overlayEl && overlayEl.style.display !== 'none';
          if (overlayVisible) {
            // switch to row view
            try {
              // try to render embeddings row (will create container if needed)
              displayEmbeddingsAsImage();
              container = $('container');
            } catch (e) {
              // fallback to rebuild collage if embeddings view fails
              try {
                rebuildImageFromDetections();
              } catch (e2) {}
              container = $('container');
            }
            if (overlayEl) overlayEl.style.display = 'none';
            if (container) container.style.display = 'block';
            viewToggle.textContent = 'Show overlay view';
          } else {
            // show overlay
            if (overlayEl) {
              overlayEl.style.display = 'block';
              try {
                renderCanvas(overlayEl);
              } catch (e) {}
            }
            if (container) container.style.display = 'none';
            viewToggle.textContent = 'Show row view';
          }
        } catch (e) {
          console.error('view toggle failed', e);
        }
      });
    } catch (e) {}

    if (saveBtn) saveBtn.addEventListener('click', saveToken);
    if (clearBtn) clearBtn.addEventListener('click', clearToken);
    if (inputFile)
      inputFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) {
          preview.src = '';
          preview.style.display = 'none';
          return;
        }
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
        // hide overlay until detection
        overlay.style.display = 'none';

        // immediately process image
        processImage();
      });

    // Click handler: map client coords to canvas pixel coords
    if (overlay) {
      // ensure canvas sits on top but allows pointer events
      overlay.style.zIndex = 9999;
      overlay.style.pointerEvents = 'auto';

      overlay.addEventListener('click', (ev) => {
        const rect = overlay.getBoundingClientRect();
        const scaleX = overlay.width / rect.width;
        const scaleY = overlay.height / rect.height;
        const cx = (ev.clientX - rect.left) * scaleX;
        const cy = (ev.clientY - rect.top) * scaleY;
        console.log('overlay click', { cx, cy, scaleX, scaleY });
        console.log('drawnBoxes', drawnBoxes);
        for (let i = drawnBoxes.length - 1; i >= 0; i--) {
          const b = drawnBoxes[i];
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
            console.log('matched box', b);
            anchor = b.key;
            // hide preview image and overlay so embeddings/container are visible
            try {
              if (preview) preview.style.display = 'none';
            } catch (e) {}
            try {
              if (overlay) overlay.style.display = 'none';
            } catch (e) {}
            // find embeddings
            displayEmbeddingsAsImage();

            return;
          }
        }
        console.log('no box matched click');
      });

      // hover handling
      overlay.addEventListener('mousemove', (ev) => {
        const rect = overlay.getBoundingClientRect();
        const scaleX = overlay.width / rect.width;
        const scaleY = overlay.height / rect.height;
        const cx = (ev.clientX - rect.left) * scaleX;
        const cy = (ev.clientY - rect.top) * scaleY;
        let found = null;
        for (let i = drawnBoxes.length - 1; i >= 0; i--) {
          const b = drawnBoxes[i];
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
            found = b.key;
            break;
          }
        }
        if (found !== hoveredKey) {
          hoveredKey = found;
          renderCanvas(overlay);
        }
      });

      window.addEventListener('resize', () => {
        // update canvas size and re-render
        overlay.width = window.innerWidth;
        overlay.height = window.innerHeight;
        renderCanvas(overlay);
      });
    }

    renderTokenStatus();
  });
})();
