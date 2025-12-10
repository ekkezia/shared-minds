-- Migration: Add call_state_log table for tracking user online/offline states during calls
-- This allows each user to see when the other user went online/offline on their DualTimeline
-- 
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

-- Allow all authenticated and anonymous users to read and insert
-- In production, you might want more restrictive policies
CREATE POLICY "Allow all read access" ON call_state_log FOR SELECT USING (true);
CREATE POLICY "Allow all insert access" ON call_state_log FOR INSERT WITH CHECK (true);

-- Enable realtime for this table so users get live updates
ALTER PUBLICATION supabase_realtime ADD TABLE call_state_log;

-- Grant permissions (for anon and authenticated users)
GRANT SELECT, INSERT ON call_state_log TO anon;
GRANT SELECT, INSERT ON call_state_log TO authenticated;

