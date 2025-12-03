# 🚀 Quick Start Guide

Get your Subway Phone app running in **10 minutes**!

## Step 1: Try the Demo (30 seconds)

Before setting up the backend, see how it works:

1. Open **[subway-phone-demo.html](subway-phone-demo.html)** in your browser
2. Click the connection status to toggle online/offline
3. Watch how the UI changes between recording and playback modes
4. See the message log update

This shows you exactly how the app works without any setup!

---

## Step 2: Create Supabase Account (2 minutes)

1. Go to **https://supabase.com**
2. Click **"Start your project"**
3. Sign in with **GitHub** (easiest) or email
4. Click **"New Project"**
5. Fill in:
   - **Name**: `subway-phone`
   - **Password**: (create one - save it!)
   - **Region**: Pick closest to you
6. Click **"Create new project"**
7. ☕ Wait 2-3 minutes while it sets up

---

## Step 3: Get Your Keys (1 minute)

1. Once the project is ready, go to **Settings** (⚙️ in sidebar)
2. Click **API** in the settings menu
3. Copy these two values:

   📋 **Project URL**: `https://xxxxx.supabase.co`
   
   📋 **anon public key**: `eyJhbGc...` (long string)

**Keep this tab open!** You'll need these values.

---

## Step 4: Set Up Database (3 minutes)

1. Click **SQL Editor** in the left sidebar
2. Click **+ New query**
3. **Copy the entire SQL below** and paste it in:

```sql
-- Create tables
CREATE TABLE users (
  phone_number TEXT PRIMARY KEY,
  online BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE audio_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL,
  from_number TEXT NOT NULL,
  file_path TEXT NOT NULL,
  url TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Enable realtime
ALTER TABLE users REPLICA IDENTITY FULL;
ALTER TABLE calls REPLICA IDENTITY FULL;
ALTER TABLE audio_chunks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE calls;
ALTER PUBLICATION supabase_realtime ADD TABLE audio_chunks;

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_chunks ENABLE ROW LEVEL SECURITY;

-- Permissive policies for development
CREATE POLICY "public_read_users" ON users FOR SELECT USING (true);
CREATE POLICY "public_insert_users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update_users" ON users FOR UPDATE USING (true);
CREATE POLICY "public_read_calls" ON calls FOR SELECT USING (true);
CREATE POLICY "public_insert_calls" ON calls FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update_calls" ON calls FOR UPDATE USING (true);
CREATE POLICY "public_read_audio" ON audio_chunks FOR SELECT USING (true);
CREATE POLICY "public_insert_audio" ON audio_chunks FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_calls_to ON calls(to_number);
CREATE INDEX idx_calls_from ON calls(from_number);
CREATE INDEX idx_audio_call ON audio_chunks(call_id);
```

4. Click **Run** (or press Cmd/Ctrl + Enter)
5. You should see "Success. No rows returned" ✅

---

## Step 5: Create Storage (2 minutes)

1. Click **Storage** 📦 in the left sidebar
2. Click **New bucket**
3. Enter name: `call-audio`
4. ✅ Check **"Public bucket"**
5. Click **Create bucket**

6. Click on the **`call-audio`** bucket you just created
7. Click **Policies** tab
8. Click **New policy**
9. Choose **"For full customization"**
10. Paste this:

```sql
CREATE POLICY "public_upload" ON storage.objects 
FOR INSERT WITH CHECK (bucket_id = 'call-audio');
```

11. Click **Review** → **Save policy**

12. Click **New policy** again
13. Paste this:

```sql
CREATE POLICY "public_read" ON storage.objects 
FOR SELECT USING (bucket_id = 'call-audio');
```

14. Click **Review** → **Save policy**

Done! ✅

---

## Step 6: Configure the App (2 minutes)

1. Open **`subway-phone-supabase.html`** in a text editor
2. Find these lines (around line 351):

```javascript
const supabaseUrl = 'https://your-project.supabase.co';
const supabaseAnonKey = 'your-anon-key-here';
```

3. Replace with **YOUR** values from Step 3:

```javascript
const supabaseUrl = 'https://xxxxx.supabase.co';  // Paste YOUR URL here
const supabaseAnonKey = 'eyJhbGc...';  // Paste YOUR anon key here
```

4. **Save the file**

---

## Step 7: Test It! (2 minutes)

### Open Two Windows
1. Open `subway-phone-supabase.html` in **Chrome** or **Firefox**
2. Open it again in a **new window** (Cmd/Ctrl + N then open the file again)

### Get Phone Numbers
- **Window 1**: Click "Get My Number" → Note the number (e.g., `123 456 7890`)
- **Window 2**: Click "Get My Number" → Get a different number

### Make a Call!
1. In **Window 2**, dial the number from Window 1
2. Click the **green call button** 📞
3. Window 1 should show "incoming call"! 🎉

### Accept and Test
1. In **Window 1**, click the **green button** to accept
2. **Allow microphone** when prompted
3. You should see "Connecting..." 🟡

### Test Offline Mode
1. Press **F12** to open DevTools
2. Go to **Network** tab
3. Check **"Offline"** ✅
4. UI changes to "Connected" 🟢
5. You should hear playback! 🔊

---

## Troubleshooting

### "Supabase not configured"
- ❌ Make sure you updated both URL and anon key
- ❌ Check for typos
- ✅ URL should start with `https://`
- ✅ Anon key should start with `eyJ`

### No incoming call showing
- Refresh both windows
- Check both have different phone numbers
- Open browser console (F12) and look for errors

### Can't hear audio
- Allow microphone permissions
- Make sure other person was online and recording
- Check that storage bucket is **public**

### Errors in console
- Check SQL ran successfully (Step 4)
- Check storage policies exist (Step 5)
- Make sure Realtime is enabled

---

## 🎉 You're Done!

You now have a working async phone app that:
- ✅ Records when you're online
- ✅ Plays back when you're offline  
- ✅ Perfect for subway tunnels
- ✅ Completely free!

### Next Steps:

1. **Share with friends**: Send them the HTML file
2. **Deploy online**: Use Vercel, Netlify, or GitHub Pages
3. **Customize**: Change colors, add features
4. **Secure it**: See SUPABASE_SETUP.md for production policies

---

## Files You Need

- **[subway-phone-supabase.html](subway-phone-supabase.html)** - Main app
- **[subway-phone-demo.html](subway-phone-demo.html)** - Demo (no setup)
- **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** - Detailed setup guide
- **[README.md](README.md)** - Full documentation

---

## Questions?

- **Detailed setup**: Read [SUPABASE_SETUP.md](SUPABASE_SETUP.md)
- **Why Supabase?**: Read [FIREBASE_VS_SUPABASE.md](FIREBASE_VS_SUPABASE.md)
- **Supabase docs**: https://supabase.com/docs
- **Issues**: Check browser console (F12) for errors

---

**Happy calling! 🚇📞**

Remember: You're recording when online (signal good), listening when offline (signal bad). Counter-intuitive but perfect for subway tunnels!
