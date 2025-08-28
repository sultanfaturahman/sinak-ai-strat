import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kdfaaqzwzyhfcgjeeyvq.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkZmFhcXp3enloZmNnamVleXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MDgyMTQsImV4cCI6MjA3MTk4NDIxNH0.KogqwKmY6O-kKCe2Qjaa1KGfdX9zhZ3qFzuM2Tqh4S4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Types for our database schema
export type TxnKind = 'income' | 'cogs' | 'expense';
export type UmkmLevel = 'mikro' | 'kecil' | 'menengah' | 'besar';
export type ImportStatus = 'running' | 'succeeded' | 'failed';
export type AiSummaryType = 'strategy_plan' | 'cashflow_forecast' | 'pricing_review' | 'marketing_plan';

export interface Profile {
  user_id: string;
  display_name?: string;
  city?: string;
  umkm_level?: UmkmLevel;
  last12m_turnover_rp: number;
  last_recomputed_at: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  date_ts: string;
  kind: TxnKind;
  category: string;
  amount_rp: number;
  notes?: string;
  uniq_hash: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlyMetric {
  user_id: string;
  month_start: string;
  sales_rp: number;
  cogs_rp: number;
  opex_rp: number;
  gross_profit_rp: number;
  net_profit_rp: number;
  gross_margin: number;
  net_margin: number;
  mom_sales_pct: number;
  top_expenses: Array<{category: string; amount_rp: number}>;
  updated_at: string;
}

export interface AiSummary {
  id: string;
  user_id: string;
  type: AiSummaryType;
  model: string;
  context_snapshot: any;
  result_json: any;
  version: number;
  created_at: string;
}

export interface ImportRun {
  id: string;
  user_id: string;
  filename: string;
  status: ImportStatus;
  total_rows: number;
  total_imported: number;
  error?: string;
  created_at: string;
  finished_at?: string;
}

// Helper function to format rupiah
export const formatRupiah = (amount: number): string => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Helper function to parse rupiah string to integer
export const parseRupiah = (rupiahStr: string): number => {
  return parseInt(rupiahStr.replace(/[^\d]/g, ''), 10) || 0;
};