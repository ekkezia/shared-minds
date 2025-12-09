// DEPRECATED: This file is kept for backward compatibility
// New code should use environment variables via import.meta.env
// See supabaseClient.js for the new implementation

// Fallback to environment variables if available, otherwise use old hardcoded values
// This allows gradual migration
export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://uqejfbljzcwonhspvtgr.supabase.co';
export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZWpmYmxqemN3b25oc3B2dGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNDMwOTUsImV4cCI6MjA3OTcxOTA5NX0.y9hyi8qOdBUwlIqTQf9_HxCg7UqkyUv7rMWxeb6UTfo';
