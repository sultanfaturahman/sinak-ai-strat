-- Sinak UMKM Management System - Complete Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Drop existing types if they exist
DROP TYPE IF EXISTS txn_kind CASCADE;
DROP TYPE IF EXISTS umkm_level CASCADE;
DROP TYPE IF EXISTS import_status CASCADE;
DROP TYPE IF EXISTS ai_summary_type CASCADE;

-- Create custom types
CREATE TYPE txn_kind AS ENUM ('income', 'cogs', 'expense');
CREATE TYPE umkm_level AS ENUM ('mikro', 'kecil', 'menengah', 'besar');
CREATE TYPE import_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE ai_summary_type AS ENUM ('strategy_plan', 'analysis', 'report');

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id UUID NOT NULL PRIMARY KEY,
    display_name TEXT,
    city TEXT,
    last12m_turnover_rp BIGINT DEFAULT 0,
    umkm_level umkm_level DEFAULT 'mikro',
    last_recomputed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    date_ts TIMESTAMPTZ NOT NULL,
    kind txn_kind NOT NULL,
    category TEXT NOT NULL,
    amount_rp BIGINT NOT NULL,
    notes TEXT,
    uniq_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create monthly_metrics table
CREATE TABLE IF NOT EXISTS public.monthly_metrics (
    user_id UUID NOT NULL,
    month_start DATE NOT NULL,
    sales_rp BIGINT DEFAULT 0,
    cogs_rp BIGINT DEFAULT 0,
    opex_rp BIGINT DEFAULT 0,
    gross_profit_rp BIGINT DEFAULT 0,
    net_profit_rp BIGINT DEFAULT 0,
    gross_margin NUMERIC DEFAULT 0,
    net_margin NUMERIC DEFAULT 0,
    mom_sales_pct NUMERIC DEFAULT 0,
    top_expenses JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, month_start)
);

-- Create ai_summaries table
CREATE TABLE IF NOT EXISTS public.ai_summaries (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    type ai_summary_type NOT NULL,
    model TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    context_snapshot JSONB DEFAULT '{}'::jsonb,
    result_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create import_runs table
CREATE TABLE IF NOT EXISTS public.import_runs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    filename TEXT NOT NULL,
    status import_status DEFAULT 'running',
    total_rows INTEGER DEFAULT 0,
    total_imported INTEGER DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

-- Create unique constraint for transaction deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedup ON public.transactions (user_id, uniq_hash);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions (user_id, date_ts);
CREATE INDEX IF NOT EXISTS idx_monthly_metrics_user ON public.monthly_metrics (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_summaries_user_type ON public.ai_summaries (user_id, type);
CREATE INDEX IF NOT EXISTS idx_import_runs_user ON public.import_runs (user_id);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for transactions
CREATE POLICY "Users can view their own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions" ON public.transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions" ON public.transactions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions" ON public.transactions
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for monthly_metrics
CREATE POLICY "Users can view their own metrics" ON public.monthly_metrics
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own metrics" ON public.monthly_metrics
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own metrics" ON public.monthly_metrics
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for ai_summaries
CREATE POLICY "Users can view their own summaries" ON public.ai_summaries
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own summaries" ON public.ai_summaries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for import_runs
CREATE POLICY "Users can view their own import runs" ON public.import_runs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own import runs" ON public.import_runs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own import runs" ON public.import_runs
    FOR UPDATE USING (auth.uid() = user_id);

-- Utility Functions
CREATE OR REPLACE FUNCTION public.month_start_from_ts(ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    RETURN date_trunc('month', ts)::date;
END;
$$;

CREATE OR REPLACE FUNCTION public.classify_umkm_by_turnover(turnover_rp BIGINT)
RETURNS umkm_level
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF turnover_rp <= 2000000000 THEN -- 2 billion (mikro)
        RETURN 'mikro';
    ELSIF turnover_rp <= 15000000000 THEN -- 15 billion (kecil)  
        RETURN 'kecil';
    ELSIF turnover_rp <= 50000000000 THEN -- 50 billion (menengah)
        RETURN 'menengah';
    ELSE
        RETURN 'besar';
    END IF;
END;
$$;

-- Generate transaction hash function
CREATE OR REPLACE FUNCTION public.generate_transaction_hash(
    p_user_id UUID,
    p_date_ts TIMESTAMPTZ,
    p_kind txn_kind,
    p_category TEXT,
    p_amount_rp BIGINT,
    p_notes TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    RETURN encode(
        sha256((p_user_id::text || '|' || p_date_ts::text || '|' || p_kind::text || '|' || p_category || '|' || p_amount_rp::text || '|' || COALESCE(p_notes, ''))::bytea),
        'hex'
    );
END;
$$;

-- Recompute monthly metrics for a specific user and month
CREATE OR REPLACE FUNCTION public.recompute_month_for_user(p_user_id UUID, p_month_start DATE)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_sales_rp BIGINT := 0;
    v_cogs_rp BIGINT := 0; 
    v_opex_rp BIGINT := 0;
    v_mom_sales_pct DECIMAL := 0;
    v_top_expenses JSONB := '[]';
    v_prev_month_sales BIGINT := 0;
    v_gross_profit_rp BIGINT;
    v_net_profit_rp BIGINT;
    v_gross_margin DECIMAL;
    v_net_margin DECIMAL;
BEGIN
    -- Calculate sales, cogs, and opex for the month
    SELECT 
        COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_rp ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN kind = 'cogs' THEN amount_rp ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_rp ELSE 0 END), 0)
    INTO v_sales_rp, v_cogs_rp, v_opex_rp
    FROM transactions
    WHERE user_id = p_user_id 
    AND date_trunc('month', date_ts)::date = p_month_start;

    -- Calculate derived values
    v_gross_profit_rp := v_sales_rp - v_cogs_rp;
    v_net_profit_rp := v_sales_rp - v_cogs_rp - v_opex_rp;
    
    IF v_sales_rp > 0 THEN
        v_gross_margin := (v_gross_profit_rp::decimal / v_sales_rp::decimal) * 100;
        v_net_margin := (v_net_profit_rp::decimal / v_sales_rp::decimal) * 100;
    ELSE
        v_gross_margin := 0;
        v_net_margin := 0;
    END IF;

    -- Get previous month sales for MoM calculation
    SELECT COALESCE(sales_rp, 0)
    INTO v_prev_month_sales
    FROM monthly_metrics
    WHERE user_id = p_user_id 
    AND month_start = p_month_start - INTERVAL '1 month';

    -- Calculate MoM percentage
    IF v_prev_month_sales > 0 THEN
        v_mom_sales_pct := ((v_sales_rp - v_prev_month_sales)::DECIMAL / v_prev_month_sales::DECIMAL) * 100;
    END IF;

    -- Get top 5 expenses by category for the month
    SELECT COALESCE(jsonb_agg(row_to_json(expense_data)), '[]'::jsonb)
    INTO v_top_expenses
    FROM (
        SELECT category, SUM(amount_rp) as amount_rp
        FROM transactions
        WHERE user_id = p_user_id 
        AND date_trunc('month', date_ts)::date = p_month_start
        AND kind = 'expense'
        GROUP BY category
        ORDER BY SUM(amount_rp) DESC
        LIMIT 5
    ) expense_data;

    -- Upsert monthly metrics
    INSERT INTO monthly_metrics (
        user_id, month_start, sales_rp, cogs_rp, opex_rp, 
        gross_profit_rp, net_profit_rp, gross_margin, net_margin,
        mom_sales_pct, top_expenses, updated_at
    )
    VALUES (
        p_user_id, p_month_start, v_sales_rp, v_cogs_rp, v_opex_rp,
        v_gross_profit_rp, v_net_profit_rp, v_gross_margin, v_net_margin,
        v_mom_sales_pct, v_top_expenses, NOW()
    )
    ON CONFLICT (user_id, month_start)
    DO UPDATE SET
        sales_rp = EXCLUDED.sales_rp,
        cogs_rp = EXCLUDED.cogs_rp,
        opex_rp = EXCLUDED.opex_rp,
        gross_profit_rp = EXCLUDED.gross_profit_rp,
        net_profit_rp = EXCLUDED.net_profit_rp,
        gross_margin = EXCLUDED.gross_margin,
        net_margin = EXCLUDED.net_margin,
        mom_sales_pct = EXCLUDED.mom_sales_pct,
        top_expenses = EXCLUDED.top_expenses,
        updated_at = NOW();
END;
$$;

-- Recompute last 12 months turnover and UMKM level
CREATE OR REPLACE FUNCTION public.recompute_last12m(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_turnover_rp BIGINT := 0;
    v_new_umkm_level umkm_level;
BEGIN
    -- Calculate last 12 months turnover
    SELECT COALESCE(SUM(sales_rp), 0)
    INTO v_turnover_rp
    FROM monthly_metrics
    WHERE user_id = p_user_id 
    AND month_start >= (CURRENT_DATE - INTERVAL '12 months');

    -- Classify UMKM level
    v_new_umkm_level := classify_umkm_by_turnover(v_turnover_rp);

    -- Update or insert profile
    INSERT INTO profiles (user_id, last12m_turnover_rp, umkm_level, last_recomputed_at)
    VALUES (p_user_id, v_turnover_rp, v_new_umkm_level, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
        last12m_turnover_rp = EXCLUDED.last12m_turnover_rp,
        umkm_level = EXCLUDED.umkm_level,
        last_recomputed_at = NOW(),
        updated_at = NOW();
END;
$$;

-- Trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Trigger function to set transaction hash
CREATE OR REPLACE FUNCTION public.set_transaction_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.uniq_hash := generate_transaction_hash(
        NEW.user_id, NEW.date_ts, NEW.kind, NEW.category, NEW.amount_rp, NEW.notes
    );
    RETURN NEW;
END;
$$;

-- Trigger function to handle transaction changes and recompute metrics
CREATE OR REPLACE FUNCTION public.trigger_recompute_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    affected_months DATE[];
    month_date DATE;
BEGIN
    -- Collect affected months
    IF TG_OP = 'DELETE' then
        affected_months := ARRAY[month_start_from_ts(OLD.date_ts)];
    ELSIF TG_OP = 'UPDATE' then
        affected_months := ARRAY[month_start_from_ts(OLD.date_ts), month_start_from_ts(NEW.date_ts)];
    ELSE -- INSERT
        affected_months := ARRAY[month_start_from_ts(NEW.date_ts)];
    END IF;

    -- Recompute affected months
    FOREACH month_date IN ARRAY affected_months
    LOOP
        IF TG_OP = 'DELETE' THEN
            PERFORM recompute_month_for_user(OLD.user_id, month_date);
            PERFORM recompute_last12m(OLD.user_id);
        ELSE
            PERFORM recompute_month_for_user(NEW.user_id, month_date);
            PERFORM recompute_last12m(NEW.user_id);
        END IF;
    END LOOP;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create triggers for updated_at timestamp
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_monthly_metrics_updated_at
    BEFORE UPDATE ON public.monthly_metrics
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger to auto-set transaction hash
CREATE TRIGGER set_transaction_hash_trigger
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_transaction_hash();

-- Create trigger to recompute metrics on transaction changes
CREATE TRIGGER trigger_transaction_metrics_update
    AFTER INSERT OR UPDATE OR DELETE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_recompute_metrics();

-- Storage bucket setup (imports)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('imports', 'imports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for imports bucket
CREATE POLICY "Users can view their own import files" ON storage.objects
    FOR SELECT USING (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own import files" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own import files" ON storage.objects
    FOR UPDATE USING (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own import files" ON storage.objects
    FOR DELETE USING (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Sinak UMKM Management System schema created successfully!';
    RAISE NOTICE 'Tables: profiles, transactions, monthly_metrics, ai_summaries, import_runs';
    RAISE NOTICE 'Functions: recompute_month_for_user, recompute_last12m, classify_umkm_by_turnover';
    RAISE NOTICE 'Triggers: Auto hash generation, metrics recomputation, updated_at timestamps';
    RAISE NOTICE 'Storage: imports bucket with RLS policies';
    RAISE NOTICE 'Next: Deploy edge functions with supabase functions deploy';
END $$;