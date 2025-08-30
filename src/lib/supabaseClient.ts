import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from '@/integrations/supabase/types';

let sb: SupabaseClient<Database>;

export function getSupabase(): SupabaseClient<Database> {
  if (!sb) {
    const g = globalThis as any;
    
    if (g.__sb__) {
      sb = g.__sb__;
    } else {
      const SUPABASE_URL = "https://kdfaaqzwzyhfcgjeeyvq.supabase.co";
      const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZmFhcXp3enloZmNnamVleXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MDgyMTQsImV4cCI6MjA3MTk4NDIxNH0.KogqwKmY6O-kKCe2Qjaa1KGfdX9zhZ3qFzuM2Tqh4S4";
      
      sb = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          storage: localStorage
        }
      });
      
      g.__sb__ = sb;
    }
  }
  
  return sb;
}

// Export singleton instance for backward compatibility
export const supabase = getSupabase();