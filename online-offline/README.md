# 📱 Online-Offline Voice Call App

A **walkie-talkie style** voice calling application where users alternate between recording (when online) and playback (when offline). Built with Preact, Supabase, and the Web Audio API.

![Call Flow](https://img.shields.io/badge/Mode-Asynchronous%20Voice-blue)
![Stack](https://img.shields.io/badge/Stack-Preact%20%2B%20Supabase-green)
![Status](https://img.shields.io/badge/Status-Experimental-orange)

---

## 🎯 Concept

Unlike traditional real-time calls, this app implements an **asynchronous voice communication** pattern:

- **Online** → Record your voice (20-second chunks)
- **Offline** → Listen to the other person's recordings
- **Network-aware** → Automatically switches modes based on connection quality

Think of it as a **voice message ping-pong** where connectivity determines who's speaking and who's listening.

---

## 🗂️ Architecture

### Database Schema (Supabase)

```
┌─────────────────────────┐    ┌─────────────────────────┐
│         users           │    │         calls           │
├─────────────────────────┤    ├─────────────────────────┤
│ phone_number (PK)       │    │ id (PK)                 │
│ username                │    │ from_number             │
│ online                  │    │ to_number               │
│ last_seen               │    │ status (ringing/active/ │
└─────────────────────────┘    │         ended)          │
                               │ created_at              │
┌─────────────────────────┐    │ accepted_at             │
│     audio_chunks        │    │ ended_at                │
├─────────────────────────┤    └─────────────────────────┘
│ id (PK)                 │
│ call_id (FK)            │    ┌─────────────────────────┐
│ from_number             │    │   Supabase Storage      │
│ url                     │    ├─────────────────────────┤
│ file_path               │    │ Bucket: "call-audio"    │
│ created_at              │    │ Path: call-{id}/{phone}/│
└─────────────────────────┘    │       {chunk}.webm      │
                               └─────────────────────────┘
```

### View State Machine

```
┌─────────┐         ┌─────────┐         ┌──────────┐
│  SETUP  │ ──────► │ DIALER  │ ──────► │ CALLING  │◄──┐
└─────────┘         └─────────┘         └──────────┘   │
                         │                   │    ▲    │
                    [incoming]          [offline] │ [online]
                         │                   │    │    │
                         ▼                   ▼    │    │
                   ┌──────────┐        ┌───────────┐   │
                   │ INCOMING │──────► │ CONNECTED │───┘
                   └──────────┘        └───────────┘
                         │                   │
                    [reject]            [end call]
                         │                   │
                         ▼                   ▼
                   ┌─────────────────────────┐
                   │          END            │
                   └─────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project with:
  - `users` table
  - `calls` table
  - `audio_chunks` table
  - `call-audio` storage bucket (public)
  - Realtime enabled on all tables

### Installation

```bash
cd online-offline
npm install
```

### Environment Setup

Create a `.env` file in the `online-offline` directory:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

> ⚠️ **Note:** Microphone access requires HTTPS in production. localhost is treated as a secure context for development.

---

## 📁 Project Structure

```
online-offline/
├── src/
│   ├── App.jsx                 # Main app component & state management
│   ├── index.jsx               # Entry point
│   ├── index.css               # Global styles
│   ├── supabaseClient.js       # Supabase client initialization
│   │
│   ├── views/
│   │   ├── SetupView.jsx       # Username setup & mic permission
│   │   ├── DialerView.jsx      # Phone dialer with online users
│   │   ├── IncomingCallView.jsx # Incoming call screen with ring
│   │   ├── CallingView.jsx     # Active call (recording mode)
│   │   ├── CallConnectedView.jsx # Offline playback mode
│   │   └── EndCallView.jsx     # Call ended screen
│   │
│   ├── components/
│   │   ├── PhoneContainer.jsx  # Phone frame wrapper
│   │   ├── StatusBar.jsx       # iOS-style status bar
│   │   ├── Dialpad.jsx         # Numeric keypad with DTMF
│   │   ├── OnlineUserDropdown.jsx # Online users picker
│   │   ├── DualTimeline.jsx    # Recording/playback timeline
│   │   └── ...
│   │
│   ├── services/
│   │   └── audioService.js     # Audio recording, upload, playback
│   │
│   └── hooks/
│       └── useOnlineStatus.js  # Network quality detection
│
├── vite.config.js
└── package.json
```

---

## 🔧 Key Features

### 🎙️ Audio Recording
- Records 20-second audio chunks using MediaRecorder API
- Supports WebM and MP4 audio formats
- Real-time audio visualization during recording
- Progress indicator with countdown timer

### 📤 Cloud Upload
- Uploads to Supabase Storage with 15-second timeout
- Inserts metadata into `audio_chunks` table
- Triggers realtime notification to call partner

### 📥 Offline Playback
- Caches all audio in IndexedDB for offline access
- Scrubber UI to navigate between chunks
- Play/pause controls with progress tracking
- Auto-advances through chunk queue

### 📡 Network Detection
- Uses Network Information API when available
- Detects effective connection type (4G/3G/2G)
- Monitors downlink speed and RTT
- Falls back to `navigator.onLine` if unavailable

### 🔔 Realtime Features
- Instant incoming call notifications
- Live online users list
- Automatic call termination on disconnect
- Presence heartbeat (30-second intervals)

---

## 🗄️ Supabase Setup

### Tables SQL

```sql
-- Users table
CREATE TABLE users (
  phone_number VARCHAR PRIMARY KEY,
  username VARCHAR NOT NULL,
  online BOOLEAN DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Calls table
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number VARCHAR NOT NULL,
  to_number VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'ringing',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB
);

-- Audio chunks table
CREATE TABLE audio_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id),
  from_number VARCHAR NOT NULL,
  url VARCHAR NOT NULL,
  file_path VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE calls;
ALTER PUBLICATION supabase_realtime ADD TABLE audio_chunks;
```

### Storage Bucket

1. Create a bucket named `call-audio`
2. Set it to **public** for audio playback
3. Configure CORS if needed for your domain

---

## 📱 How It Works

### Making a Call

1. **Setup** → Enter display name, grant microphone permission
2. **Dialer** → Select an online user from the dropdown
3. **Calling** → Your call creates a `calls` row with status `ringing`
4. **Recipient** → Receives realtime notification, sees incoming call screen
5. **Accept** → Call status updates to `active`, both users enter calling view

### During a Call

| Your Status | Your Action | Their Action |
|-------------|-------------|--------------|
| **Online** | Recording 20s audio | Playing your cached chunks |
| **Offline** | Playing their cached chunks | Recording 20s audio |

### Audio Flow

```
YOU (Online)                          THEM (Offline)
────────────                          ──────────────
Record 20s chunk                      
     │                                
     ▼                                
Upload to Supabase Storage            
     │                                
     ▼                                
Insert audio_chunks row ──────────►  Realtime notification
                                           │
                                           ▼
                                      Cache in IndexedDB
                                           │
                                           ▼
                                      Play from cache
```

---

## 🛠️ Development Notes

### Session Recovery

The app persists call state to `sessionStorage` to handle mobile browser behavior where connectivity changes can trigger page reloads:

- `currentCall` - Active call object
- `savedView` - Current view state
- `myUsername` / `myPhoneNumber` - User credentials

### Phone Number Normalization

All phone numbers are normalized to digits-only for consistent matching:

```javascript
const normalizePhoneNumber = (s) => String(s || '').replace(/\D/g, '');
```

### IndexedDB Schema

```
Database: subway-audio-db (version 2)

Store: chunks
  Key: network URL
  Value: Audio Blob

Store: chunk-metadata
  Key: chunk.id
  Indexes: call_id, from_number
  Value: { id, call_id, from_number, url, file_path, created_at }
```

---

## 🐛 Known Issues

- Mobile Safari may require user interaction before audio playback
- Some browsers don't support Network Information API (falls back to online/offline only)
- Recording quality depends on device microphone

---

## 📄 License

MIT

---

## 🙏 Acknowledgments

- Built for ITP Shared Minds course
- Uses [Supabase](https://supabase.com) for backend
- Uses [Preact](https://preactjs.com) for UI
- Uses [Vite](https://vitejs.dev) for bundling
