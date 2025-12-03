# Supabase Setup Guide - Subway Phone

## Why Supabase?

✅ **Free tier with NO credit card required**  
✅ 500MB database storage  
✅ 1GB file storage  
✅ 2GB bandwidth  
✅ Realtime subscriptions included  
✅ Much more generous than Firebase  

---

## Step 1: Create Supabase Project (5 minutes)

### 1.1 Sign Up
1. Go to https://supabase.com
2. Click "Start your project"
3. Sign in with GitHub (recommended) or email

### 1.2 Create New Project
1. Click "New Project"
2. Choose your organization (or create one)
3. Fill in details:
   - **Project name**: `subway-phone`
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free (default)
4. Click "Create new project"
5. Wait 2-3 minutes for setup to complete

### 1.3 Get Your Credentials
Once the project is ready:
1. Go to **Settings** > **API** in the left sidebar
2. You'll need these two values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: Long string starting with `eyJ...`

**Save these securely!** You'll need them to configure the app.

---

## Step 2: Create Database Tables (3 minutes)

### 2.1 Open SQL Editor
1. Click **SQL Editor** in the left sidebar
2. Click **New query**

### 2.2 Create Tables
Copy and paste this SQL, then click **Run**:

```sql
-- Create users table
CREATE TABLE users (
  phone_number TEXT PRIMARY KEY,
  online BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable realtime for users
ALTER TABLE users REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE users;

-- Create calls table
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  FOREIGN KEY (from_number) REFERENCES users(phone_number),
  FOREIGN KEY (to_number) REFERENCES users(phone_number)
);

-- Enable realtime for calls
ALTER TABLE calls REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE calls;

-- Create audio chunks table
CREATE TABLE audio_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL,
  from_number TEXT NOT NULL,
  file_path TEXT NOT NULL,
  url TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
  FOREIGN KEY (from_number) REFERENCES users(phone_number)
);

-- Enable realtime for audio_chunks
ALTER TABLE audio_chunks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE audio_chunks;

-- Create indexes for better performance
CREATE INDEX idx_calls_to_number ON calls(to_number);
CREATE INDEX idx_calls_from_number ON calls(from_number);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_audio_call_id ON audio_chunks(call_id);
CREATE INDEX idx_audio_from_number ON audio_chunks(from_number);
```

You should see "Success. No rows returned" - that's perfect!

---

## Step 3: Create Storage Bucket (2 minutes)

### 3.1 Create Bucket
1. Click **Storage** in the left sidebar
2. Click **New bucket**
3. Enter bucket name: `call-audio`
4. Make it **Public** (check the box)
5. Click **Create bucket**

### 3.2 Set Storage Policies
1. Click on the `call-audio` bucket
2. Click **Policies** tab
3. Click **New policy**
4. Choose **For full customization**
5. Create **INSERT** policy:
   ```sql
   CREATE POLICY "Anyone can upload audio"
   ON storage.objects FOR INSERT
   WITH CHECK (bucket_id = 'call-audio');
   ```
6. Click **Review** then **Save policy**

7. Create **SELECT** policy:
   ```sql
   CREATE POLICY "Anyone can download audio"
   ON storage.objects FOR SELECT
   USING (bucket_id = 'call-audio');
   ```
8. Click **Review** then **Save policy**

---

## Step 4: Configure Row Level Security (RLS)

### 4.1 Open SQL Editor Again
Click **SQL Editor** > **New query**

### 4.2 Set Up Policies
For development, we'll use permissive policies. Run this SQL:

```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_chunks ENABLE ROW LEVEL SECURITY;

-- Users policies (development - permissive)
CREATE POLICY "Anyone can read users"
  ON users FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert users"
  ON users FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update users"
  ON users FOR UPDATE
  USING (true);

-- Calls policies (development - permissive)
CREATE POLICY "Anyone can read calls"
  ON calls FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert calls"
  ON calls FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update calls"
  ON calls FOR UPDATE
  USING (true);

-- Audio chunks policies (development - permissive)
CREATE POLICY "Anyone can read audio"
  ON audio_chunks FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert audio"
  ON audio_chunks FOR INSERT
  WITH CHECK (true);
```

**Note**: These are permissive policies for development. See "Production Security" below for secure policies.

---

## Step 5: Enable Realtime

Realtime should already be enabled for your tables from Step 2. To verify:

1. Go to **Database** > **Replication** in the left sidebar
2. Make sure these tables are checked:
   - ✅ users
   - ✅ calls
   - ✅ audio_chunks

If they're not checked, click the toggle to enable them.

---

## Step 6: Configure the App

### 6.1 Update the HTML File
1. Open `subway-phone-supabase.html`
2. Find these lines (around line 351):
   ```javascript
   const supabaseUrl = 'https://your-project.supabase.co';
   const supabaseAnonKey = 'your-anon-key-here';
   ```

3. Replace with your actual values from Step 1.3:
   ```javascript
   const supabaseUrl = 'https://xxxxx.supabase.co';  // Your Project URL
   const supabaseAnonKey = 'eyJhbGc...';  // Your anon public key
   ```

4. **Save the file**

---

## Step 7: Test the App! 🎉

### 7.1 Open in Two Windows
1. Open `subway-phone-supabase.html` in **Chrome** or **Firefox**
2. Open it again in a **new window** (or incognito/different browser)

### 7.2 Get Phone Numbers
- **Window 1**: Click "Get My Number" → Save the number (e.g., 1234567890)
- **Window 2**: Click "Get My Number" → Save a different number (e.g., 9876543210)

### 7.3 Make a Call
1. In **Window 2**, dial the number from Window 1
2. Click the green call button
3. **Window 1** should show an incoming call!

### 7.4 Accept and Test
1. In **Window 1**, click the green button to accept
2. Both windows now show "Connected" state
3. Allow microphone access when prompted

### 7.5 Test Online/Offline Mode
1. Open **Chrome DevTools** (F12)
2. Go to **Network** tab
3. Check **Offline** checkbox
4. UI should change:
   - **Online**: "Connecting..." (recording)
   - **Offline**: "Connected" (playback)
5. Toggle it back and forth to see the behavior!

---

## Troubleshooting

### Error: "Failed to fetch"
- **Check**: Make sure your Supabase URL and anon key are correct
- **Check**: Project might still be initializing (wait a few minutes)
- **Check**: Browser console for specific error messages

### Error: "permission denied for table"
- **Fix**: Make sure you ran the RLS policies in Step 4.2
- **Fix**: Verify tables have RLS enabled

### Incoming calls not showing up
- **Check**: Both users should have different phone numbers
- **Check**: Realtime is enabled for `calls` table (Step 5)
- **Check**: Refresh both windows to reconnect Realtime

### Can't hear audio
- **Check**: Microphone permissions granted in browser
- **Check**: Storage bucket is public (Step 3.1)
- **Check**: Storage policies allow SELECT (Step 3.2)
- **Check**: The other person was online and recording

### "Supabase not configured" message
- **Fix**: Double-check you updated both `supabaseUrl` and `supabaseAnonKey`
- **Fix**: Make sure URL starts with `https://`
- **Fix**: Make sure anon key is the full string (starts with `eyJ`)

### Realtime not working
- **Check**: Go to Database > Replication and enable tables
- **Check**: Run the `ALTER PUBLICATION` commands from Step 2.2 again
- **Refresh**: Close and reopen browser windows

---

## Verify Your Setup

You can check if everything is working by:

### Check Database
1. Go to **Table Editor** in Supabase
2. Click **users** table → should see your phone numbers
3. Click **calls** table → should see call records
4. Click **audio_chunks** → should see audio recordings

### Check Storage
1. Go to **Storage** > **call-audio**
2. You should see folders with call IDs
3. Inside: phone numbers > audio files

---

## Production Security 🔒

⚠️ **Before going live**, replace the permissive policies with secure ones:

```sql
-- Drop permissive policies
DROP POLICY IF EXISTS "Anyone can read users" ON users;
DROP POLICY IF EXISTS "Anyone can insert users" ON users;
DROP POLICY IF EXISTS "Anyone can update users" ON users;
DROP POLICY IF EXISTS "Anyone can read calls" ON calls;
DROP POLICY IF EXISTS "Anyone can insert calls" ON calls;
DROP POLICY IF EXISTS "Anyone can update calls" ON calls;
DROP POLICY IF EXISTS "Anyone can read audio" ON audio_chunks;
DROP POLICY IF EXISTS "Anyone can insert audio" ON audio_chunks;

-- Add authenticated-only policies
-- (Requires implementing Supabase Auth in your app)

CREATE POLICY "Users can read their own data"
  ON users FOR SELECT
  USING (auth.uid()::text = phone_number);

CREATE POLICY "Users can update their own data"
  ON users FOR UPDATE
  USING (auth.uid()::text = phone_number);

CREATE POLICY "Users can read calls they're part of"
  ON calls FOR SELECT
  USING (
    auth.uid()::text = from_number OR 
    auth.uid()::text = to_number
  );

CREATE POLICY "Users can create calls they initiate"
  ON calls FOR INSERT
  WITH CHECK (auth.uid()::text = from_number);

CREATE POLICY "Users can update calls they're part of"
  ON calls FOR UPDATE
  USING (
    auth.uid()::text = from_number OR 
    auth.uid()::text = to_number
  );

CREATE POLICY "Users can read audio from their calls"
  ON audio_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM calls 
      WHERE calls.id = call_id 
      AND (calls.from_number = auth.uid()::text OR calls.to_number = auth.uid()::text)
    )
  );

CREATE POLICY "Users can upload their own audio"
  ON audio_chunks FOR INSERT
  WITH CHECK (auth.uid()::text = from_number);
```

---

## Cost Estimates

### Free Tier Limits
- **Database**: 500 MB (plenty for thousands of calls)
- **Storage**: 1 GB (about 3-4 hours of audio)
- **Bandwidth**: 2 GB/month
- **Realtime**: 200 concurrent connections

### When You Might Need to Upgrade
- **~500 active users**: Consider Pro plan ($25/month)
- **Lots of audio storage**: Pro gives 8GB storage
- **High bandwidth**: If users are very active

For a personal project or small demo, **free tier is perfect!**

---

## Additional Features You Can Add

### 1. Contact Lists
```sql
CREATE TABLE contacts (
  owner_phone TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  PRIMARY KEY (owner_phone, contact_phone),
  FOREIGN KEY (owner_phone) REFERENCES users(phone_number)
);
```

### 2. Call History
Already supported! Query the `calls` table filtered by your phone number.

### 3. User Profiles
```sql
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
```

---

## Resources

- **Supabase Docs**: https://supabase.com/docs
- **Realtime Guide**: https://supabase.com/docs/guides/realtime
- **Storage Guide**: https://supabase.com/docs/guides/storage
- **RLS Guide**: https://supabase.com/docs/guides/auth/row-level-security

---

## Need Help?

1. **Check browser console** (F12) for errors
2. **Check Supabase logs**: Database > Logs
3. **Supabase Discord**: https://discord.supabase.com
4. **Supabase GitHub**: https://github.com/supabase/supabase/discussions

---

**You're all set!** 🎉 Start calling in the subway! 🚇📞

No credit card needed, totally free to try, and you can scale up when ready.
