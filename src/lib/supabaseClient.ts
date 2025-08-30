import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kdfaaqzwzyhfcgjeeyvq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZmFhcXp3enloZmNnamVleXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MDgyMTQsImV4cCI6MjA3MTk4NDIxNH0.KogqwKmY6O-kKCe2Qjaa1KGfdX9zhZ3qFzuM2Tqh4S4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});