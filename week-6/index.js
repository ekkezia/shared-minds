// import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
// import {
//   onAuthStateChanged,
//   getAuth,
//   GoogleAuthProvider,
//   signInWithPopup, // Note: You should use the destructured version below.
// } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js';
// import {
//   getFirestore,
//   collection,
//   doc,
//   query,
//   where,
//   getDocs,
//   setDoc,
//   updateDoc,
//   onSnapshot,
// } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

// import { DispersedImage } from './dispersed-image-class.js';

// let app;
// let dispersedImages = []; // store all DispersedImage instances
// const NEW_BASE_DURATION = 5 * 60 * 1000; // the session time for EVERYONE will be updated to all the rest of the users (sessionTime - currentTime) + sessionTime. This way, if more people authenticate then the sessionTime can exponentially grow.

// // ---------- Firebase setup ----------
// function initFirebase() {
//   const firebaseConfig = {
//     apiKey: 'AIzaSyB7_77ud3zCl2H8JHs8e6MgmirSCccJiQE',
//     authDomain: 'bye-bye-user.firebaseapp.com',
//     databaseURL: 'https://bye-bye-user-default-rtdb.firebaseio.com',
//     projectId: 'bye-bye-user',
//     storageBucket: 'bye-bye-user.firebasestorage.app',
//     messagingSenderId: '60912834119',
//     appId: '1:60912834119:web:6f2ab9ca78309492c20362',
//   };
//   app = initializeApp(firebaseConfig, {
//     experimentalForceLongPolling: true,
//     useFetchStreams: false,
//   });
//   //make a folder in your firebase for this example
// }
// // Initialize app (The extra options are for environment recovery, keep them.)
// initFirebase();

// const auth = getAuth(app); // Pass the app instance
// const db = getFirestore(app); // Pass the app instance

// let currentAuthUser = null;

// // Get references to the 'users' collection
// const usersCollectionRef = collection(db, 'users');
// // Get references to the 'session' collection
// const sessionsCollectionRef = collection(db, 'session');

// // INIT: load all users
// // === Load dispersed image for a Firestore user ===
// async function loadDispersedImage(user) {
//   if (!user.imgData) return null;

//   // console.log('load image');

//   const dispersed = new DispersedImage(
//     user.imgData, // imgData
//     4, // pixelSize
//     { x: user.x, y: user.y }, // location
//     user.email, // email
//     user.authTime, // authTime
//     5 * 60 * 1000, // sessionTime
//   );

//   await dispersed.ready; // Wait for image to load

//   dispersedImages.push(dispersed);
//   console.log('Loaded dispersed for', user);

//   return dispersed;
// }
// // === Live sync with Firestore ===
// onSnapshot(usersCollectionRef, async (snapshot) => {
//   const newUsers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

//   for (const user of newUsers) {
//     const alreadyLoaded = dispersedImages.find((d) => d.email === user.email);
//     if (alreadyLoaded) continue; // Skip existing image
//     // Close camera
//     cleanupCamera();

//     await loadDispersedImage(user);
//   }
// });

// // === Detect returning user ===
// onAuthStateChanged(auth, async (user) => {
//   if (user) {
//     // Load existing Firestore entry
//     currentAuthUser = await findExistingUserImage(user.email);

//     console.log('[onAuthStateChanged] User signed in:', currentAuthUser);

//     if (currentAuthUser) {
//       console.log('Found existing image for', user);
//     } else {
//       console.log('No existing image found for', user.email);
//     }
//   } else {
//     currentAuthUser = null;
//     console.log('No user signed in');
//   }
// });

// // === Helper: Check Firestore if image exists for email ===
// async function findExistingUserImage(email) {
//   const q = query(collection(db, 'users'), where('email', '==', email));
//   const snap = await getDocs(q);
//   if (!snap.empty) return snap.docs[0].data();
//   return null;
// }

// // ---------- Save to firebase users ----------
// async function saveToUserCollection(authUser, x, y, authTime) {
//   await setDoc(doc(db, 'users', authUser.uid), {
//     email: authUser.email || null,
//     x: lastClickPos ? lastClickPos.x : x,
//     y: lastClickPos ? lastClickPos.y : y,
//     authTime,
//     imgData: lastClickPos?.imgData || null,
//   });
// }

// // ---------- Get firebase user collection "Session" [0] field time
// async function getGlobalSessionTime() {
//   const sessionSnapshot = await getDocs(sessionsCollectionRef);
//   if (!sessionSnapshot.empty) {
//     localSessionTime = sessionSnapshot.docs[0].data().time;

//     return sessionSnapshot.docs[0].data().time;
//   }
//   return null;
// }

// // ---------- Update firebase user collection "Session" [0] field time
// async function updateGlobalSessionTime(timeInMillis, email) {
//   try {
//     const sessionSnapshot = await getDocs(sessionsCollectionRef);

//     if (sessionSnapshot.empty) {
//       console.warn('⚠️ No session documents found!');
//       return false;
//     }

//     const firstDoc = sessionSnapshot.docs[0];
//     const docRef = doc(db, 'session', firstDoc.id);

//     await updateDoc(docRef, {
//       time: timeInMillis,
//       updatedAt: Date.now(),
//       email: email || null,
//     });
//     console.log(`✅ Updated session time to ${timeInMillis} ms`);
//     return true;
//   } catch (err) {
//     console.error('❌ Failed to update session time:', err);
//     return false;
//   }
// }

// // // ---------- Canvas setup (Rest of this section is fine) ----------
// const canvas =
//   document.getElementById('canvas') ||
//   (() => {
//     const c = document.createElement('canvas');
//     c.id = 'canvas';
//     document.body.appendChild(c);
//     return c;
//   })();
// const ctx = canvas.getContext('2d');
// canvas.width = window.innerWidth;
// canvas.height = window.innerHeight;

// // ensure timeline bar exists (create fallback)
// let timelineBar = document.getElementById('timeline-bar');
// if (!timelineBar) {
//   const wrapper = document.createElement('div');
//   wrapper.id = 'timeline-wrapper';
//   Object.assign(wrapper.style, {
//     position: 'fixed',
//     bottom: '8px',
//     left: '8px',
//     right: '8px',
//     height: '8px',
//     background: 'rgba(0,0,0,0.15)',
//   });
//   const bar = document.createElement('div');
//   bar.id = 'timeline-bar';
//   Object.assign(bar.style, {
//     height: '100%',
//     width: '0%',
//     background: '#4caf50',
//   });
//   wrapper.appendChild(bar);
//   document.body.appendChild(wrapper);
//   timelineBar = bar;
// }

// const liveBtn = document.createElement('button');
// liveBtn.textContent = '🔴 Go Live';
// Object.assign(liveBtn.style, {
//   position: 'fixed',
//   bottom: '28px',
//   left: '90px',
//   padding: '6px 10px',
//   background: '#e53935',
//   color: '#fff',
//   border: 'none',
//   borderRadius: '4px',
//   cursor: 'pointer',
//   zIndex: 9999,
// });
// document.body.appendChild(liveBtn);

// liveBtn.addEventListener('click', () => {
//   isPlaying = true;
//   scrubPercent = null;
//   playPauseBtn.textContent = '⏸ Pause';
// });

// // ensure info panel exists (create fallback)
// let info = document.getElementById('info');
// if (!info) {
//   info = document.createElement('div');
//   info.id = 'info';
//   Object.assign(info.style, {
//     position: 'fixed',
//     right: '12px',
//     top: '12px',
//     padding: '8px 12px',
//     background: 'rgba(0,0,0,0.6)',
//     color: '#fff',
//     fontSize: '12px',
//     borderRadius: '6px',
//     zIndex: 9999,
//   });
//   document.body.appendChild(info);
// }

// let hoverInfo = null;

// canvas.addEventListener('mousemove', (e) => {
//   const rect = canvas.getBoundingClientRect();
//   const mx = e.clientX - rect.left;
//   const my = e.clientY - rect.top;

//   hoverInfo = null;

//   // iterate dispersedImages in reverse to hover top-most first
//   for (let i = dispersedImages.length - 1; i >= 0; i--) {
//     const d = dispersedImages[i];
//     if (!d.img) continue;

//     const x0 = d.location.x - d.centerX;
//     const y0 = d.location.y - d.centerY;
//     const x1 = x0 + d.img.width;
//     const y1 = y0 + d.img.height;

//     if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1) {
//       hoverInfo = {
//         email: d.email || 'unknown',
//         time: d.time || Date.now(),
//         x: mx,
//         y: my,
//       };
//       break;
//     }
//   }
// });

// // If your script runs before DOM is ready, ensure layout sizes update after load
// window.addEventListener('DOMContentLoaded', () => {
//   canvas.width = window.innerWidth;
//   canvas.height = window.innerHeight;
// });

// window.addEventListener('resize', () => {
//   canvas.width = window.innerWidth;
//   canvas.height = window.innerHeight;
// });

// // ---------- App state ----------
// let users = []; // local cache of users from Firestore
// let localAuthTime = null;
// let localSessionTime = null; // for timeline purposes

// let lastClickPos = null; // { x, y }
// let clickMarker = null; // { x, y, w, h }

// // ---------- Camera init (new) ----------
// let videoStream = null;
// let previewVideo = null;

// // initialize camera early so permission is requested on load and captureFace is ready
// async function initCamera() {
//   try {
//     // ask permission and start stream
//     videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
//     previewVideo = document.createElement('video');
//     previewVideo.autoplay = true;
//     previewVideo.playsInline = true;
//     previewVideo.muted = true;
//     previewVideo.srcObject = videoStream;
//     // wait until video has metadata (dimensions) and is playing
//     await new Promise((resolve) => {
//       previewVideo.onloadedmetadata = () => {
//         // try to start playback (some browsers require explicit play)
//         previewVideo.play().catch(() => {});
//         resolve();
//       };
//     });
//     console.log('Camera initialized and ready');
//   } catch (err) {
//     console.warn('Camera initialization failed or permission denied:', err);
//     videoStream = null;
//     previewVideo = null;
//   }
// }

// // stop camera when page unloads
// function cleanupCamera() {
//   try {
//     if (videoStream && videoStream.getTracks) {
//       videoStream.getTracks().forEach((t) => t.stop());
//     }
//   } catch (err) {
//     console.warn('Error cleaning up camera', err);
//   }
// }
// window.addEventListener('beforeunload', cleanupCamera);

// // Call initCamera early (after firebase init is fine)
// initCamera();

// // Get Session Time
// await getGlobalSessionTime();

// // ---------- Helper: capture face (updated to reuse previewVideo) ----------
// async function captureFace() {
//   try {
//     // If camera not started yet, try to init now
//     if (!previewVideo) {
//       await initCamera();
//     }
//     if (!previewVideo) {
//       throw new Error('Camera not available');
//     }

//     const tempCanvas = document.createElement('canvas');
//     const w = 128;
//     const h = 128;
//     tempCanvas.width = w;
//     tempCanvas.height = h;
//     const tempCtx = tempCanvas.getContext('2d');

//     // draw current frame from the shared preview video
//     tempCtx.drawImage(previewVideo, 0, 0, w, h);

//     const img = new Image();
//     img.src = tempCanvas.toDataURL('image/png');
//     await new Promise((r) => (img.onload = r));
//     lastClickPos = {
//       ...lastClickPos,
//       imgData: img.src,
//     };
//     return img;
//   } catch (err) {
//     console.error('captureFace failed:', err);
//     throw err;
//   }
// }

// function calculateNewGlobalSessionTime(images) {
//   const BASE_INCREMENT = 5 * 60 * 1000; // 5 minutes
//   let totalRemaining = 0;

//   images.forEach((d) => {
//     totalRemaining += d.getRemainingTime();
//   });

//   const newSessionTime = totalRemaining + BASE_INCREMENT;
//   console.log('total remaining time from all users:', totalRemaining);

//   return newSessionTime;
// }

// // ---------- Click to submit (FIXED) ----------
// canvas.addEventListener('click', async (e) => {
//   // draw a small marker at the click position
//   const ctx = canvas.getContext('2d');
//   ctx.strokeStyle = 'blue';
//   ctx.lineWidth = 1;
//   ctx.strokeRect(e.clientX - 50, e.clientY - 50, 100, 100);

//   // compute coordinates relative to the canvas
//   const rect = canvas.getBoundingClientRect();
//   const x = Math.round(e.clientX - rect.left);
//   const y = Math.round(e.clientY - rect.top);

//   // save to local var and set a visual marker
//   lastClickPos = { x, y };
//   // marker: centered on the click, 100x100 px by default
//   clickMarker = { x, y, w: 100, h: 100 };

//   // capture webcam snapshot immediately for preview and save to lastClickPos
//   try {
//     // captureFace will set lastClickPos.imgData and return an Image
//     const capturedImg = await captureFace();

//     // cache image object for drawing in animate()
//     if (lastClickPos && lastClickPos.imgData) {
//       const previewImg = new Image();
//       await new Promise((resolve, reject) => {
//         previewImg.onload = resolve;
//         previewImg.onerror = reject;
//         previewImg.src = lastClickPos.imgData;
//       });
//       // lastClickPos.imgObj = previewImg;
//       // lastClickPos.imgReady = true;
//       // request a frame so animate() will draw the cached image
//       if (hoverInfo) {
//         const padding = 6;
//         const text = `${hoverInfo.email}\n${new Date(
//           hoverInfo.time,
//         ).toLocaleTimeString()}`;
//         ctx.save();
//         ctx.font = '12px sans-serif';
//         ctx.textBaseline = 'top';
//         const metrics = ctx.measureText(hoverInfo.email);
//         const width =
//           Math.max(
//             ctx.measureText(hoverInfo.email).width,
//             ctx.measureText(new Date(hoverInfo.time).toLocaleTimeString())
//               .width,
//           ) +
//           padding * 2;
//         const height = 24 + padding * 2;

//         // draw background
//         ctx.fillStyle = 'rgba(0,0,0,0.7)';
//         ctx.fillRect(hoverInfo.x + 10, hoverInfo.y + 10, width, height);

//         // draw text
//         ctx.fillStyle = '#fff';
//         ctx.fillText(
//           hoverInfo.email,
//           hoverInfo.x + 10 + padding,
//           hoverInfo.y + 10 + padding,
//         );
//         ctx.fillText(
//           new Date(hoverInfo.time).toLocaleTimeString(),
//           hoverInfo.x + 10 + padding,
//           hoverInfo.y + 10 + 12 + padding,
//         );
//         ctx.restore();
//       }

//       requestAnimationFrame(() => {});
//     }
//   } catch (capErr) {
//     console.error('Failed to capture preview image:', capErr);
//     lastClickPos.imgData = null;
//     lastClickPos.imgReady = false;
//   }

//   // Trigger Firebase Google Auth and save user with click position + captured image
//   if (currentAuthUser && currentAuthUser.imgData) return; // already signed in and have image data, no need to re-authenticate & upload img
//   try {
//     const provider = new GoogleAuthProvider();
//     const result = await signInWithPopup(auth, provider);
//     const authTime = Date.now(); // set authTime as now (when user signed in)
//     const authUser = result.user;

//     // Ensure we have an image to save; fallback to captureFace() if needed
//     if (!lastClickPos?.imgData) {
//       try {
//         const fallbackImg = await captureFace();
//         lastClickPos = {
//           ...lastClickPos,
//           imgData: fallbackImg.src,
//           imgObj: fallbackImg,
//           imgReady: true,
//         };
//       } catch (fallbackErr) {
//         console.warn('No preview image available to save:', fallbackErr);
//       }
//     }

//     // Save to Firestore
//     await saveToUserCollection(authUser, x, y, authTime);

//     const newSessionTime = calculateNewGlobalSessionTime(dispersedImages);
//     dispersedImages.forEach((d) => d.updateSessionTime(newSessionTime));
//     const timeUpdated = await updateGlobalSessionTime(
//       newSessionTime,
//       authUser.email,
//     );

//     if (!timeUpdated) return;

//     const currentGlobalTime = await getGlobalSessionTime();
//     // console.log('current global time', currentGlobalTime);
//     if (!currentGlobalTime) return;
//     // update local session time
//     localSessionTime = currentGlobalTime;

//     dispersedImages.forEach((d) => {
//       d.updateSessionTime(currentGlobalTime);
//     });

//     // Update local start time if first user
//     if (!localAuthTime) localAuthTime = authTime;

//     console.log('User saved to Firestore:', authUser.uid);
//   } catch (authErr) {
//     console.error('Authentication or save failed:', authErr);
//   }

//   // ensure the UI updates immediately
//   requestAnimationFrame(() => {});
// });

// // --- Timeline scrubber UI (video-like) ---
// const playPauseBtn = document.createElement('button');
// playPauseBtn.textContent = '⏸ Pause';
// Object.assign(playPauseBtn.style, {
//   position: 'fixed',
//   bottom: '28px',
//   left: '12px',
//   padding: '6px 10px',
//   background: '#333',
//   color: '#fff',
//   border: 'none',
//   borderRadius: '4px',
//   cursor: 'pointer',
//   zIndex: 9999,
// });
// document.body.appendChild(playPauseBtn);

// playPauseBtn.addEventListener('click', () => {
//   isPlaying = !isPlaying;
//   playPauseBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
//   if (isPlaying) {
//     scrubPercent = null; // return to live state
//   } else {
//     lastPausedTime = Date.now();
//   }
// });

// const timelineBarEl = timelineBar; // existing element
// const timelineContainer = timelineBarEl ? timelineBarEl.parentElement : null;

// // create scrubber elements if container exists
// let scrubberKnob = null;
// let expiryLabel = null;
// let scrubPreviewLabel = null;
// let isScrubbing = false;
// let scrubPercent = null; // null = no manual scrub, otherwise 0..1

// function updateScrubber(progress) {
//   if (scrubberKnob) {
//     scrubberKnob.style.width = `${progress * 100}%`;
//   }
// }
// if (timelineContainer) {
//   // ensure container has relative positioning
//   timelineContainer.style.position =
//     timelineContainer.style.position || 'relative';
//   timelineContainer.style.userSelect = 'none';

//   // knob
//   scrubberKnob = document.createElement('div');
//   scrubberKnob.id = 'scrubber-knob';
//   Object.assign(scrubberKnob.style, {
//     position: 'absolute',
//     top: '-6px',
//     width: `0%`,
//     height: '24px',
//     background: '#ff0000',
//     borderRadius: '2px',
//     boxShadow: '0 0 6px rgba(0,0,0,0.4)',
//     // transform: 'translateX(-50%)',
//     cursor: 'pointer',
//     zIndex: 20,
//   });
//   timelineContainer.appendChild(scrubberKnob);

//   // expiry label (right end)
//   expiryLabel = document.createElement('div');
//   expiryLabel.id = 'timeline-expiry';
//   Object.assign(expiryLabel.style, {
//     position: 'absolute',
//     right: '0',
//     top: '-28px',
//     color: '#fff',
//     fontSize: '12px',
//     background: 'rgba(0,0,0,0.5)',
//     padding: '2px 6px',
//     borderRadius: '4px',
//     zIndex: 20,
//     whiteSpace: 'nowrap',
//   });
//   timelineContainer.appendChild(expiryLabel);

//   // scrub preview label (follows knob when scrubbing)
//   scrubPreviewLabel = document.createElement('div');
//   scrubPreviewLabel.id = 'scrub-preview';
//   Object.assign(scrubPreviewLabel.style, {
//     position: 'absolute',
//     top: '-52px',
//     color: '#fff',
//     fontSize: '12px',
//     background: 'rgba(0,0,0,0.6)',
//     padding: '2px 6px',
//     borderRadius: '4px',
//     zIndex: 25,
//     whiteSpace: 'nowrap',
//     display: 'none',
//     transform: 'translateX(-50%)',
//   });
//   timelineContainer.appendChild(scrubPreviewLabel);

//   // pointer handling (supports mouse/touch)
//   function percentFromClientX(clientX) {
//     const rect = timelineContainer.getBoundingClientRect();
//     const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
//     return rect.width > 0 ? x / rect.width : 0;
//   }

//   function updateScrubberPosition(percent) {
//     const { start: timelineStart, end: timelineEnd } = getTimelineBounds();

//     console.log(
//       'updating scrubber position to percent',
//       timelineStart,
//       timelineEnd,
//       percent,
//     );
//     scrubTime = timelineStart + percent * (timelineEnd - timelineStart);

//     console.log(
//       'updating scrubber position to percent',
//       timelineStart,
//       timelineEnd,
//       scrubTime,
//       scrubTime / 1000 / 60,
//     );
//     // Update visual positions
//     dispersedImages.forEach((d) => d.updateForTime(scrubTime));

//     // Force redraw
//     requestAnimationFrame(animate);

//     // Update scrubber UI
//     const rect = timelineContainer.getBoundingClientRect();
//     scrubberKnob.style.left = percent * rect.width + 'px';
//     if (scrubPreviewLabel.style.display !== 'none') {
//       scrubPreviewLabel.style.left = percent * rect.width + 'px';
//       scrubPreviewLabel.textContent = new Date(scrubTime).toLocaleTimeString();
//     }
//   }

//   // pointer down on knob or container to begin scrubbing
//   scrubberKnob.addEventListener('click', (ev) => {
//     ev.preventDefault();
//     isScrubbing = true;
//     scrubberKnob.setPointerCapture(ev.pointerId);
//     scrubPreviewLabel.style.display = 'block';
//     const p = percentFromClientX(ev.clientX);
//     scrubPercent = p;
//     updateScrubberPosition(p);
//   });

//   timelineContainer.addEventListener('click', (ev) => {
//     // clicking the bar seeks (shows preview but does not change app state)
//     if (ev.target === scrubberKnob) return;
//     isScrubbing = true;
//     scrubPreviewLabel.style.display = 'block';
//     const p = percentFromClientX(ev.clientX);
//     scrubPercent = p;
//     updateScrubberPosition(p);
//   });

//   // window.addEventListener('pointermove', (ev) => {
//   //   if (!isScrubbing) return;
//   //   const p = percentFromClientX(ev.clientX);
//   //   scrubPercent = p;
//   //   updateScrubberPosition(p);
//   // });

//   // window.addEventListener('pointerup', (ev) => {
//   //   if (!isScrubbing) return;
//   //   isScrubbing = false;
//   //   scrubPreviewLabel.style.display = 'none';

//   //   // Stay paused at scrubbed position
//   //   isPlaying = false;
//   //   const { start: timelineStart, end: timelineEnd } = getTimelineBounds();
//   //   lastPausedTime = // todo
//   //     timelineStart + scrubPercent * (timelineEnd - timelineStart);
//   //   playPauseBtn.textContent = '▶ Play';
//   // });
// }

// // --- Helper: format timestamp to readable time ---
// function formatTime(ts) {
//   if (!ts) return '-';
//   const d = new Date(ts);
//   return d.toLocaleTimeString();
// }

// function getTimelineBounds() {
//   if (!dispersedImages.length)
//     return { start: Date.now(), end: Date.now() + NEW_BASE_DURATION };

//   const start = Math.min(...dispersedImages.map((d) => d.authTime));
//   const end = Math.max(...dispersedImages.map((d) => d.endTime));

//   return { start, end };
// }

// // --- Update animate() to integrate scrubber logic and expiry label ---
// // const originalAnimate = animate;
// let isPlaying = true; // true = live updating, false = paused/scrubbing
// let lastPausedTime = Date.now();
// let scrubTime = null;

// // ---------- Animate loop ----------
// function animate() {
//   ctx.clearRect(0, 0, canvas.width, canvas.height);

//   const { start: timelineStart, end: timelineEnd } = getTimelineBounds();

//   // Determine "current time" for drawing
//   const now = Date.now();

//   let currentTime;

//   if (!isPlaying && scrubPercent != null) {
//     // manual scrubbing
//     currentTime = timelineStart + scrubPercent * (timelineEnd - timelineStart);
//     // console.log(
//     //   'update current time',
//     //   isPlaying,
//     //   currentTime,
//     //   timelineStart,
//     //   scrubPercent,
//     //   timelineEnd,
//     // );
//   } else if (!isPlaying && scrubPercent == null) {
//     // paused, hold last position
//     currentTime = lastPausedTime || now;
//   } else {
//     // playing live
//     currentTime = now;
//     lastPausedTime = now;
//   }

//   // Update each image based on LIVE (Date.now()) or SCRUBBED time
//   dispersedImages.forEach((d) => {
//     if (currentTime < d.authTime || currentTime > d.endTime) return;

//     if (!isPlaying && scrubPercent != null) {
//       // scrubbing manually
//       // console.log('Scrubbing to', currentTime);
//       d.updateForTime(currentTime);
//     } else {
//       // live playback or paused at live
//       d.updateLive();
//     }

//     d.display(ctx);
//     d.drawLabel(ctx, currentTime);
//   });

//   // Draw last click preview image (semi-transparent)
//   if (lastClickPos?.imgObj && lastClickPos.imgReady) {
//     ctx.save();
//     ctx.globalAlpha = 0.5;
//     const w = 128;
//     const h = 128;
//     ctx.drawImage(
//       lastClickPos.imgObj,
//       lastClickPos.x - w / 2,
//       lastClickPos.y - h / 2,
//       w,
//       h,
//     );
//     ctx.restore();
//   }

//   // Draw click marker box
//   if (clickMarker) {
//     ctx.save();
//     ctx.strokeStyle = 'rgba(255,255,255,0.5)';
//     ctx.lineWidth = 1;
//     ctx.setLineDash([8, 6]);
//     ctx.strokeRect(
//       clickMarker.x - clickMarker.w / 2,
//       clickMarker.y - clickMarker.h / 2,
//       clickMarker.w,
//       clickMarker.h,
//     );
//     ctx.restore();
//   }

//   // Update scrubber UI
//   if (timelineBar) {
//     const percent =
//       (currentTime - timelineStart) / (timelineEnd - timelineStart);
//     timelineBar.style.width = `${percent * 100}%`;
//     if (expiryLabel) {
//       const expiryTime = new Date(timelineEnd);
//       expiryLabel.textContent = expiryTime.toLocaleTimeString();
//     }
//   }

//   requestAnimationFrame(animate);
// }

// // Start animation
// requestAnimationFrame(animate);

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import {
  onAuthStateChanged,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

import { DispersedImage } from './dispersed-image-class.js';

// ---------- Constants ----------
const NEW_BASE_DURATION = 5 * 60 * 1000; // 5 minutes

// ---------- State (Minimal) ----------
let dispersedImages = []; // DispersedImage instances synced from Firebase
let currentAuthUser = null;
let globalSessionTime = null; // Single source of truth from Firebase

// UI state
let lastClickPos = null;
let clickMarker = null;
let isPlaying = true;
let scrubPercent = null;
let lastPausedTime = Date.now();
let hoverInfo = null;

// Camera
let videoStream = null;
let previewVideo = null;

// ---------- Firebase Setup ----------
const firebaseConfig = {
  apiKey: 'AIzaSyB7_77ud3zCl2H8JHs8e6MgmirSCccJiQE',
  authDomain: 'bye-bye-user.firebaseapp.com',
  databaseURL: 'https://bye-bye-user-default-rtdb.firebaseio.com',
  projectId: 'bye-bye-user',
  storageBucket: 'bye-bye-user.firebasestorage.app',
  messagingSenderId: '60912834119',
  appId: '1:60912834119:web:6f2ab9ca78309492c20362',
};

const app = initializeApp(firebaseConfig, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

const auth = getAuth(app);
const db = getFirestore(app);
const usersCollectionRef = collection(db, 'users');
const sessionsCollectionRef = collection(db, 'session');

// ---------- Firebase Listeners ----------

// Listen to session time changes (single source of truth)
onSnapshot(sessionsCollectionRef, (snapshot) => {
  if (!snapshot.empty) {
    const sessionData = snapshot.docs[0].data();
    globalSessionTime = sessionData.time;

    // Update all dispersed images with new session time
    dispersedImages.forEach((d) => d.updateSessionTime(globalSessionTime));

    console.log('📡 Global session time updated:', globalSessionTime);
  }
});

// Listen to users collection changes
onSnapshot(usersCollectionRef, async (snapshot) => {
  const firestoreUsers = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  for (const user of firestoreUsers) {
    const alreadyLoaded = dispersedImages.find((d) => d.email === user.email);

    if (!alreadyLoaded && user.imgData) {
      // New user - create dispersed image
      const dispersed = new DispersedImage(
        user.imgData,
        4,
        { x: user.x, y: user.y },
        user.email,
        user.authTime,
        globalSessionTime || NEW_BASE_DURATION,
      );

      await dispersed.ready;
      dispersedImages.push(dispersed);

      console.log('✅ Loaded dispersed image for', user.email);

      // Close camera after first image loads
      cleanupCamera();
    }
  }
});

// Listen to auth state
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Check if user already has data in Firestore
    const q = query(usersCollectionRef, where('email', '==', user.email));
    const snap = await getDocs(q);

    if (!snap.empty) {
      currentAuthUser = { uid: user.uid, ...snap.docs[0].data() };
      console.log('🔐 Returning user:', user.email);
    } else {
      currentAuthUser = { uid: user.uid, email: user.email };
      console.log('🆕 New user:', user.email);
    }
  } else {
    currentAuthUser = null;
    console.log('👋 User signed out');
  }
});

// ---------- Firebase Operations ----------

async function getGlobalSessionTime() {
  const sessionSnapshot = await getDocs(sessionsCollectionRef);
  if (!sessionSnapshot.empty) {
    return sessionSnapshot.docs[0].data().time;
  }
  return null;
}

async function updateGlobalSessionTime(timeInMillis, email) {
  try {
    const sessionSnapshot = await getDocs(sessionsCollectionRef);
    if (sessionSnapshot.empty) {
      console.warn('⚠️ No session documents found!');
      return false;
    }

    const firstDoc = sessionSnapshot.docs[0];
    const docRef = doc(db, 'session', firstDoc.id);

    await updateDoc(docRef, {
      time: timeInMillis,
      updatedAt: Date.now(),
      email: email || null,
    });

    console.log(`✅ Updated global session time to ${timeInMillis} ms`);
    return true;
  } catch (err) {
    console.error('❌ Failed to update session time:', err);
    return false;
  }
}

async function saveUserToFirestore(authUser, x, y, authTime, imgData) {
  await setDoc(doc(db, 'users', authUser.uid), {
    email: authUser.email || null,
    x,
    y,
    authTime,
    imgData,
  });
}

function calculateNewGlobalSessionTime() {
  const BASE_INCREMENT = NEW_BASE_DURATION;
  let totalRemaining = 0;

  dispersedImages.forEach((d) => {
    totalRemaining += d.getRemainingTime();
  });

  return totalRemaining + BASE_INCREMENT;
}

// ---------- Camera ----------

async function initCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    previewVideo = document.createElement('video');
    previewVideo.autoplay = true;
    previewVideo.playsInline = true;
    previewVideo.muted = true;
    previewVideo.srcObject = videoStream;

    await new Promise((resolve) => {
      previewVideo.onloadedmetadata = () => {
        previewVideo.play().catch(() => {});
        resolve();
      };
    });

    console.log('📷 Camera initialized');
  } catch (err) {
    console.warn('❌ Camera initialization failed:', err);
    videoStream = null;
    previewVideo = null;
  }
}

function cleanupCamera() {
  try {
    if (videoStream?.getTracks) {
      videoStream.getTracks().forEach((t) => t.stop());
      videoStream = null;
      previewVideo = null;
      console.log('📷 Camera stopped');
    }
  } catch (err) {
    console.warn('⚠️ Error cleaning up camera', err);
  }
}

async function captureFace() {
  if (!previewVideo) {
    await initCamera();
  }
  if (!previewVideo) {
    throw new Error('Camera not available');
  }

  const tempCanvas = document.createElement('canvas');
  const w = 128;
  const h = 128;
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');

  tempCtx.drawImage(previewVideo, 0, 0, w, h);

  return tempCanvas.toDataURL('image/png');
}

// ---------- Canvas Setup ----------

const canvas =
  document.getElementById('canvas') ||
  (() => {
    const c = document.createElement('canvas');
    c.id = 'canvas';
    document.body.appendChild(c);
    return c;
  })();

const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// ---------- UI Elements ----------

// Timeline bar
let timelineBar = document.getElementById('timeline-bar');
if (!timelineBar) {
  const wrapper = document.createElement('div');
  wrapper.id = 'timeline-wrapper';
  Object.assign(wrapper.style, {
    position: 'fixed',
    bottom: '8px',
    left: '8px',
    right: '8px',
    height: '8px',
    background: 'rgba(0,0,0,0.15)',
  });
  timelineBar = document.createElement('div');
  timelineBar.id = 'timeline-bar';
  Object.assign(timelineBar.style, {
    height: '100%',
    width: '0%',
    background: '#4caf50',
  });
  wrapper.appendChild(timelineBar);
  document.body.appendChild(wrapper);
}

// Play/Pause button
const playPauseBtn = document.createElement('button');
playPauseBtn.textContent = '⏸ Pause';
Object.assign(playPauseBtn.style, {
  position: 'fixed',
  bottom: '28px',
  left: '12px',
  padding: '6px 10px',
  background: '#333',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  zIndex: 9999,
});
document.body.appendChild(playPauseBtn);

playPauseBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
  if (isPlaying) {
    scrubPercent = null;
  } else {
    lastPausedTime = Date.now();
  }
});

// Go Live button
const liveBtn = document.createElement('button');
liveBtn.textContent = '🔴 Go Live';
Object.assign(liveBtn.style, {
  position: 'fixed',
  bottom: '28px',
  left: '90px',
  padding: '6px 10px',
  background: '#e53935',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  zIndex: 9999,
});
document.body.appendChild(liveBtn);

liveBtn.addEventListener('click', () => {
  isPlaying = true;
  scrubPercent = null;
  playPauseBtn.textContent = '⏸ Pause';
});

// Info panel
let info = document.getElementById('info');
if (!info) {
  info = document.createElement('div');
  info.id = 'info';
  Object.assign(info.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    padding: '8px 12px',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    fontSize: '12px',
    borderRadius: '6px',
    zIndex: 9999,
  });
  document.body.appendChild(info);
}

// ---------- Timeline Scrubber ----------

const timelineContainer = timelineBar.parentElement;
let scrubberKnob = null;
let expiryLabel = null;
let scrubPreviewLabel = null;

if (timelineContainer) {
  timelineContainer.style.position = 'relative';
  timelineContainer.style.userSelect = 'none';

  // Knob
  scrubberKnob = document.createElement('div');
  Object.assign(scrubberKnob.style, {
    position: 'absolute',
    top: '-6px',
    width: '0%',
    height: '24px',
    background: '#ff0000',
    borderRadius: '2px',
    boxShadow: '0 0 6px rgba(0,0,0,0.4)',
    cursor: 'pointer',
    zIndex: 20,
  });
  timelineContainer.appendChild(scrubberKnob);

  // Expiry label
  expiryLabel = document.createElement('div');
  Object.assign(expiryLabel.style, {
    position: 'absolute',
    right: '0',
    top: '-28px',
    color: '#fff',
    fontSize: '12px',
    background: 'rgba(0,0,0,0.5)',
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: 20,
    whiteSpace: 'nowrap',
  });
  timelineContainer.appendChild(expiryLabel);

  // Scrub preview label
  scrubPreviewLabel = document.createElement('div');
  Object.assign(scrubPreviewLabel.style, {
    position: 'absolute',
    top: '-52px',
    color: '#fff',
    fontSize: '12px',
    background: 'rgba(0,0,0,0.6)',
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: 25,
    whiteSpace: 'nowrap',
    display: 'none',
    transform: 'translateX(-50%)',
  });
  timelineContainer.appendChild(scrubPreviewLabel);

  // Scrubbing logic
  function percentFromClientX(clientX) {
    const rect = timelineContainer.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return rect.width > 0 ? x / rect.width : 0;
  }

  function updateScrubberPosition(percent) {
    const { start, end } = getTimelineBounds();
    const scrubTime = start + percent * (end - start);

    dispersedImages.forEach((d) => d.updateForTime(scrubTime));
    requestAnimationFrame(animate);

    const rect = timelineContainer.getBoundingClientRect();
    scrubberKnob.style.left = percent * rect.width + 'px';

    if (scrubPreviewLabel.style.display !== 'none') {
      scrubPreviewLabel.style.left = percent * rect.width + 'px';
      scrubPreviewLabel.textContent = new Date(scrubTime).toLocaleTimeString();
    }
  }

  scrubberKnob.addEventListener('click', (ev) => {
    ev.preventDefault();
    scrubPreviewLabel.style.display = 'block';
    const p = percentFromClientX(ev.clientX);
    scrubPercent = p;
    updateScrubberPosition(p);
  });

  timelineContainer.addEventListener('click', (ev) => {
    if (ev.target === scrubberKnob) return;
    scrubPreviewLabel.style.display = 'block';
    const p = percentFromClientX(ev.clientX);
    scrubPercent = p;
    updateScrubberPosition(p);
  });
}

// ---------- Mouse Hover ----------

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  hoverInfo = null;

  for (let i = dispersedImages.length - 1; i >= 0; i--) {
    const d = dispersedImages[i];
    if (!d.img) continue;

    const x0 = d.location.x - d.centerX;
    const y0 = d.location.y - d.centerY;
    const x1 = x0 + d.img.width;
    const y1 = y0 + d.img.height;

    if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1) {
      hoverInfo = {
        email: d.email || 'unknown',
        time: d.authTime || Date.now(),
        x: mx,
        y: my,
      };
      break;
    }
  }
});

// ---------- Click to Submit ----------

canvas.addEventListener('click', async (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);

  lastClickPos = { x, y };
  clickMarker = { x, y, w: 100, h: 100 };

  // Capture face immediately
  try {
    const imgData = await captureFace();
    lastClickPos.imgData = imgData;
  } catch (err) {
    console.error('❌ Failed to capture face:', err);
    return;
  }

  // Don't re-auth if user already has an image
  if (currentAuthUser?.imgData) {
    console.log('⚠️ User already has image data');
    return;
  }

  // Trigger Google Auth
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const authUser = result.user;
    const authTime = Date.now();

    // Save to Firestore
    await saveUserToFirestore(authUser, x, y, authTime, lastClickPos.imgData);

    // Calculate and update global session time
    const newSessionTime = calculateNewGlobalSessionTime();
    await updateGlobalSessionTime(newSessionTime, authUser.email);

    console.log('✅ User saved:', authUser.email);
  } catch (err) {
    console.error('❌ Auth/save failed:', err);
  }
});

// ---------- Helper Functions ----------

function getTimelineBounds() {
  if (!dispersedImages.length) {
    return { start: Date.now(), end: Date.now() + NEW_BASE_DURATION };
  }

  const start = Math.min(...dispersedImages.map((d) => d.authTime));
  const end = Math.max(...dispersedImages.map((d) => d.endTime));

  return { start, end };
}

// ---------- Animation Loop ----------

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { start: timelineStart, end: timelineEnd } = getTimelineBounds();
  const now = Date.now();

  let currentTime;
  if (!isPlaying && scrubPercent != null) {
    currentTime = timelineStart + scrubPercent * (timelineEnd - timelineStart);
  } else if (!isPlaying) {
    currentTime = lastPausedTime || now;
  } else {
    currentTime = now;
    lastPausedTime = now;
  }

  // Update and draw dispersed images
  dispersedImages.forEach((d) => {
    if (currentTime < d.authTime || currentTime > d.endTime) return;

    if (!isPlaying && scrubPercent != null) {
      d.updateForTime(currentTime);
    } else {
      d.updateLive();
    }

    d.display(ctx);
    d.drawLabel(ctx, currentTime);
  });

  // Draw preview image if exists
  if (lastClickPos?.imgData) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const img = new Image();
    img.src = lastClickPos.imgData;
    const w = 128;
    const h = 128;
    ctx.drawImage(img, lastClickPos.x - w / 2, lastClickPos.y - h / 2, w, h);
    ctx.restore();
  }

  // Draw click marker
  if (clickMarker) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(
      clickMarker.x - clickMarker.w / 2,
      clickMarker.y - clickMarker.h / 2,
      clickMarker.w,
      clickMarker.h,
    );
    ctx.restore();
  }

  // Draw hover info
  if (hoverInfo) {
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'top';

    const padding = 6;
    const line1 = hoverInfo.email;
    const line2 = new Date(hoverInfo.time).toLocaleTimeString();
    const width =
      Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) +
      padding * 2;
    const height = 24 + padding * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(hoverInfo.x + 10, hoverInfo.y + 10, width, height);

    ctx.fillStyle = '#fff';
    ctx.fillText(line1, hoverInfo.x + 10 + padding, hoverInfo.y + 10 + padding);
    ctx.fillText(line2, hoverInfo.x + 10 + padding, hoverInfo.y + 22 + padding);
    ctx.restore();
  }

  // Update timeline bar
  if (timelineBar) {
    const percent =
      (currentTime - timelineStart) / (timelineEnd - timelineStart);
    timelineBar.style.width = `${Math.max(0, Math.min(100, percent * 100))}%`;

    if (expiryLabel) {
      expiryLabel.textContent = new Date(timelineEnd).toLocaleTimeString();
    }
  }

  requestAnimationFrame(animate);
}

// ---------- Initialize ----------

window.addEventListener('beforeunload', cleanupCamera);

// Get initial session time and start
(async () => {
  globalSessionTime = await getGlobalSessionTime();
  await initCamera();
  requestAnimationFrame(animate);
})();
