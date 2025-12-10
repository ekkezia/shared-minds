-- Migration: Add call_state_log table for tracking user online/offline states during calls
-- Run this in your Supabase SQL Editor

-- Create the call_state_log table
CREATE TABLE IF NOT EXISTS call_state_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('recording', 'playback')),
  is_online BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_call_state_log_call_id ON call_state_log(call_id);
CREATE INDEX IF NOT EXISTS idx_call_state_log_phone_number ON call_state_log(phone_number);
CREATE INDEX IF NOT EXISTS idx_call_state_log_created_at ON call_state_log(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE call_state_log ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read and insert (for simplicity)
-- In production, you might want more restrictive policies
CREATE POLICY "Allow all read access" ON call_state_log FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON call_state_log FOR INSERT WITH CHECK (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE call_state_log;

-- Also add session_index column to audio_chunks if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'audio_chunks' AND column_name = 'session_index'
  ) THEN
    ALTER TABLE audio_chunks ADD COLUMN session_index INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create index on session_index for efficient querying
CREATE INDEX IF NOT EXISTS idx_audio_chunks_session_index ON audio_chunks(session_index);

