import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from './secret';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
