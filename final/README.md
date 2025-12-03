# 🚇 Subway Phone - Async Call App

An innovative phone call app designed for intermittent connectivity environments like subway tunnels. Record when online, listen when offline!

## 🎯 Concept

This app creates a unique calling experience where:
- **Online**: Your voice is recorded and uploaded to Supabase in 5-second chunks
- **Offline**: You hear the playback of the other person's recorded messages
- **UI shows "Connecting..." when online** (recording mode)
- **UI shows "Connected" when offline** (playback mode)

This simulates a phone call experience in environments with intermittent connectivity, like MTA subway tunnels where you get brief moments of signal between stops.

## ✨ Features

- 📱 iOS-style phone call UI
- 🎲 Auto-generated 10-digit phone numbers
- 📞 Dial other users and receive incoming calls
- 🎙️ Automatic audio recording when online
- 🔊 Automatic playback when offline
- 🌐 Real-time online/offline status indication
- 💚 Supabase integration for call signaling and audio storage
- 📊 Audio visualizer during calls
- 💸 **Completely free** - No credit card required!

## 🚀 Setup Instructions

### 1. Create a Supabase Project (FREE!)

1. Go to [Supabase](https://supabase.com)
2. Sign up with GitHub or email (no credit card needed!)
3. Create a new project
4. Get your project URL and anon key

### 2. Set Up Your Database

### 2. Set Up Your Database

Follow the detailed guide in **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** - it takes about 10 minutes total!

Quick summary:
- Create 3 database tables (users, calls, audio_chunks)
- Create a storage bucket for audio files
- Enable Row Level Security policies
- Enable Realtime subscriptions

### 3. Configure the App

Open `subway-phone-supabase.html` and update your credentials (around line 351):

```javascript
const supabaseUrl = 'https://your-project.supabase.co';  // Your Project URL
const supabaseAnonKey = 'your-anon-key-here';  // Your anon public key
```

### 4. Run the App

Simply open `subway-phone-supabase.html` in a web browser. For best results:
- Use **Chrome** or **Firefox** (Safari has MediaRecorder limitations)
- Allow **microphone access** when prompted
- For testing, open in **two separate browser windows** (or devices)

## 💰 Why Supabase?

✅ **Completely FREE** - No credit card required  
✅ 500MB database storage  
✅ 1GB file storage  
✅ 2GB bandwidth per month  
✅ Realtime subscriptions included  
✅ Much more generous than Firebase

Perfect for personal projects and demos!

## 📱 How to Use

### First Time Setup:
1. Open the app
2. Click "Get My Number"
3. You'll receive a random 10-digit phone number
4. Click "Continue" to save it

### Making a Call:
1. Enter a 10-digit phone number using the dialpad
2. Press the green call button
3. The other user will receive an incoming call notification
4. Once they accept, you're connected!

### During a Call:
- **When ONLINE** (showing "Connecting..."):
  - Your voice is being recorded
  - Audio is uploaded every 5 seconds
  - Recording happens automatically
  
- **When OFFLINE** (showing "Connected"):
  - You hear the other person's recorded voice
  - Playback happens automatically
  - Their messages play in order

### Testing Offline Mode:
- Open Chrome DevTools (F12)
- Go to "Network" tab
- Check the "Offline" box to simulate being offline
- The UI will update and you'll hear playback if the other user has been recording

## 🔧 Technical Details

### Architecture:
- **Frontend**: Pure JavaScript with Supabase SDK
- **Backend**: Supabase (PostgreSQL + Realtime + Storage)
- **Audio**: Web Audio API with MediaRecorder
- **Recording Format**: WebM (5-second chunks)

### Database Schema:

**Users Table:**
```sql
phone_number TEXT PRIMARY KEY
online BOOLEAN
last_seen TIMESTAMPTZ
created_at TIMESTAMPTZ
```

**Calls Table:**
```sql
id UUID PRIMARY KEY
from_number TEXT
to_number TEXT
status TEXT ('ringing' | 'active' | 'ended' | 'rejected')
created_at TIMESTAMPTZ
accepted_at TIMESTAMPTZ
ended_at TIMESTAMPTZ
```

**Audio Chunks Table:**
```sql
id UUID PRIMARY KEY
call_id UUID
from_number TEXT
file_path TEXT
url TEXT
timestamp TIMESTAMPTZ
```

**Storage:**
```
call-audio/
  {call-id}/
    {phone-number}/
      {timestamp}.webm
```

## 🎨 UI Screens

1. **Setup Screen**: Generate your phone number
2. **Dialer Screen**: Dialpad to call others
3. **Incoming Call Screen**: Accept/reject incoming calls
4. **Active Call Screen**: Shows connection status and audio visualizer

## 🐛 Troubleshooting

**Microphone not working:**
- Check browser permissions
- Make sure you're using HTTPS or localhost
- Try a different browser

**Can't hear audio:**
- Check that the other user is online and recording
- Wait for them to record at least one 5-second chunk
- Make sure your volume is up
- Check Supabase Storage to verify audio files were uploaded

**Supabase errors:**
- Verify your Supabase URL and anon key are correct
- Check that database tables are created (use Table Editor)
- Check that storage bucket exists and is public
- Review Row Level Security policies

**No incoming calls:**
- Make sure both users have different phone numbers
- Check that Realtime is enabled for the `calls` table
- Refresh the page to re-establish Realtime connection
- Check browser console for connection errors

**"Supabase not configured" message:**
- Make sure you updated the `supabaseUrl` and `supabaseAnonKey`
- Verify the URL starts with `https://`
- Verify the anon key is the full string (starts with `eyJ`)

## 🚀 Deployment

### Option 1: Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Option 2: Netlify
1. Drag and drop `subway-phone-supabase.html` to Netlify
2. Done!

### Option 3: GitHub Pages
1. Push to GitHub
2. Enable GitHub Pages in repo settings
3. Set source to main branch

### Option 4: Supabase Edge Functions
Host directly on Supabase for the full stack experience!

**Important**: For microphone access, you need HTTPS in production!

## 🔐 Security Considerations

⚠️ **This is a demo app with minimal security.** For production use:

1. **Implement Authentication**: Use Supabase Auth
2. **Tighten RLS Policies**: See SUPABASE_SETUP.md for secure policies
3. **Add Call Validation**: Verify users before connecting
4. **Encrypt Audio**: Consider end-to-end encryption
5. **Rate Limiting**: Prevent spam calls using Supabase Edge Functions
6. **Cost Monitoring**: Monitor storage usage in Supabase dashboard

The free tier setup guide includes **permissive RLS policies** for easy development. See the "Production Security" section in SUPABASE_SETUP.md for locking things down.

## 💡 Future Enhancements

- [ ] User profiles with names
- [ ] Contact list
- [ ] Call history
- [ ] Push notifications for incoming calls
- [ ] Video support
- [ ] Group calls
- [ ] End-to-end encryption
- [ ] Voicemail
- [ ] Better audio compression

## 📄 License

MIT License - Feel free to use and modify!

## 🎉 Credits

Inspired by the challenge of staying connected in subway tunnels and the unique asynchronous communication patterns that emerge from intermittent connectivity.

---

**Note**: This app is designed for educational purposes and demonstrates creative solutions to connectivity challenges. For production use, implement proper authentication, security, and error handling.
