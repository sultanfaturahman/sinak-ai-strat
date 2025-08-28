-- Sinak Supabase Database Schema
-- Complete initialization script for UMKM management system

-- Create ENUM for transaction kinds
CREATE TYPE public.txn_kind AS ENUM ('income', 'cogs', 'expense');

-- Profiles table for user data and UMKM classification
CREATE TABLE public.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    city TEXT,
    umkm_level TEXT CHECK (umkm_level IN ('mikro', 'kecil', 'menengah', 'besar')),
    last12m_turnover_rp BIGINT DEFAULT 0,
    last_recomputed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions table with unique hash for deduplication
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date_ts TIMESTAMPTZ NOT NULL,
    kind public.txn_kind NOT NULL,
    category TEXT NOT NULL,
    amount_rp BIGINT NOT NULL CHECK (amount_rp >= 0),
    notes TEXT,
    uniq_hash TEXT GENERATED ALWAYS AS (
        encode(sha256(
            (user_id::text || '|' || 
             date_ts::text || '|' || 
             kind::text || '|' || 
             category || '|' || 
             amount_rp::text || '|' || 
             COALESCE(notes, ''))::bytea
        ), 'hex')
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly metrics table for aggregated financial data
CREATE TABLE public.monthly_metrics (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    month_start DATE NOT NULL,
    sales_rp BIGINT DEFAULT 0,
    cogs_rp BIGINT DEFAULT 0,
    opex_rp BIGINT DEFAULT 0,
    gross_profit_rp BIGINT GENERATED ALWAYS AS (sales_rp - cogs_rp) STORED,
    net_profit_rp BIGINT GENERATED ALWAYS AS (sales_rp - cogs_rp - opex_rp) STORED,
    gross_margin NUMERIC GENERATED ALWAYS AS (
        CASE 
            WHEN sales_rp > 0 THEN ROUND((sales_rp - cogs_rp)::numeric / sales_rp::numeric * 100, 2)
            ELSE 0 
        END
    ) STORED,
    net_margin NUMERIC GENERATED ALWAYS AS (
        CASE 
            WHEN sales_rp > 0 THEN ROUND((sales_rp - cogs_rp - opex_rp)::numeric / sales_rp::numeric * 100, 2)
            ELSE 0 
        END
    ) STORED,
    mom_sales_pct NUMERIC DEFAULT 0,
    top_expenses JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, month_start)
);

-- AI summaries table for storing AI analysis results
CREATE TABLE public.ai_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('strategy_plan', 'cashflow_forecast', 'pricing_review', 'marketing_plan')),
    model TEXT NOT NULL,
    context_snapshot JSONB NOT NULL,
    result_json JSONB NOT NULL,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Import runs table for tracking CSV imports
CREATE TABLE public.import_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    total_rows INTEGER DEFAULT 0,
    total_imported INTEGER DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

-- Create unique indexes
CREATE UNIQUE INDEX idx_transactions_user_hash ON public.transactions(user_id, uniq_hash);
CREATE INDEX idx_transactions_user_date ON public.transactions(user_id, date_ts);
CREATE INDEX idx_transactions_user_kind ON public.transactions(user_id, kind);
CREATE INDEX idx_monthly_metrics_user_month ON public.monthly_metrics(user_id, month_start DESC);
CREATE INDEX idx_ai_summaries_user_type ON public.ai_summaries(user_id, type, created_at DESC);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Users can only access their own data
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" ON public.transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions" ON public.transactions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions" ON public.transactions
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own monthly_metrics" ON public.monthly_metrics
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own monthly_metrics" ON public.monthly_metrics
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own monthly_metrics" ON public.monthly_metrics
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own ai_summaries" ON public.ai_summaries
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ai_summaries" ON public.ai_summaries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own import_runs" ON public.import_runs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own import_runs" ON public.import_runs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own import_runs" ON public.import_runs
    FOR UPDATE USING (auth.uid() = user_id);

-- Utility functions

-- Function to get month start from timestamp
CREATE OR REPLACE FUNCTION public.month_start_from_ts(ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT date_trunc('month', ts)::date;
$$;

-- Function to classify UMKM by turnover (PP 7/2021)
CREATE OR REPLACE FUNCTION public.classify_umkm_by_turnover(turnover_rp BIGINT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE 
        WHEN turnover_rp <= 2000000000 THEN 'mikro'    -- ≤ 2M
        WHEN turnover_rp <= 15000000000 THEN 'kecil'   -- ≤ 15M  
        WHEN turnover_rp <= 50000000000 THEN 'menengah' -- ≤ 50M
        ELSE 'besar'
    END;
$$;

-- Function to recompute monthly metrics for a user and month
CREATE OR REPLACE FUNCTION public.recompute_month_for_user(p_user_id UUID, p_month_start DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sales_rp BIGINT := 0;
    v_cogs_rp BIGINT := 0;
    v_opex_rp BIGINT := 0;
    v_mom_sales_pct NUMERIC := 0;
    v_top_expenses JSONB;
    v_prev_month_sales BIGINT;
BEGIN
    -- Calculate aggregated amounts for the month
    SELECT 
        COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_rp ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN kind = 'cogs' THEN amount_rp ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_rp ELSE 0 END), 0)
    INTO v_sales_rp, v_cogs_rp, v_opex_rp
    FROM public.transactions
    WHERE user_id = p_user_id
        AND date_ts >= p_month_start::timestamptz
        AND date_ts < (p_month_start + interval '1 month')::timestamptz;

    -- Get top 5 expenses for the month
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'category', category,
                'amount_rp', amount_rp
            ) ORDER BY amount_rp DESC
        ), 
        '[]'::jsonb
    )
    INTO v_top_expenses
    FROM (
        SELECT category, SUM(amount_rp) as amount_rp
        FROM public.transactions
        WHERE user_id = p_user_id
            AND kind = 'expense'
            AND date_ts >= p_month_start::timestamptz
            AND date_ts < (p_month_start + interval '1 month')::timestamptz
        GROUP BY category
        ORDER BY SUM(amount_rp) DESC
        LIMIT 5
    ) top_exp;

    -- Calculate MoM sales percentage
    SELECT COALESCE(sales_rp, 0) INTO v_prev_month_sales
    FROM public.monthly_metrics
    WHERE user_id = p_user_id 
        AND month_start = (p_month_start - interval '1 month')::date;

    IF v_prev_month_sales > 0 THEN
        v_mom_sales_pct := ROUND(((v_sales_rp::numeric - v_prev_month_sales::numeric) / v_prev_month_sales::numeric) * 100, 2);
    END IF;

    -- Upsert monthly metrics
    INSERT INTO public.monthly_metrics (
        user_id, month_start, sales_rp, cogs_rp, opex_rp, 
        mom_sales_pct, top_expenses, updated_at
    )
    VALUES (
        p_user_id, p_month_start, v_sales_rp, v_cogs_rp, v_opex_rp,
        v_mom_sales_pct, v_top_expenses, NOW()
    )
    ON CONFLICT (user_id, month_start)
    DO UPDATE SET
        sales_rp = EXCLUDED.sales_rp,
        cogs_rp = EXCLUDED.cogs_rp,
        opex_rp = EXCLUDED.opex_rp,
        mom_sales_pct = EXCLUDED.mom_sales_pct,
        top_expenses = EXCLUDED.top_expenses,
        updated_at = NOW();
END;
$$;

-- Function to recompute last 12 months turnover and UMKM level
CREATE OR REPLACE FUNCTION public.recompute_last12m(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_last12m_turnover BIGINT := 0;
    v_umkm_level TEXT;
BEGIN
    -- Calculate last 12 months turnover from transactions
    SELECT COALESCE(SUM(amount_rp), 0) INTO v_last12m_turnover
    FROM public.transactions
    WHERE user_id = p_user_id
        AND kind = 'income'
        AND date_ts >= NOW() - interval '12 months';

    -- Classify UMKM level
    v_umkm_level := public.classify_umkm_by_turnover(v_last12m_turnover);

    -- Update profile
    INSERT INTO public.profiles (user_id, last12m_turnover_rp, umkm_level, last_recomputed_at)
    VALUES (p_user_id, v_last12m_turnover, v_umkm_level, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
        last12m_turnover_rp = EXCLUDED.last12m_turnover_rp,
        umkm_level = EXCLUDED.umkm_level,
        last_recomputed_at = NOW();
END;
$$;

-- Trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Trigger function for transaction changes
CREATE OR REPLACE FUNCTION public.handle_transaction_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    old_month_start DATE;
    new_month_start DATE;
    target_user_id UUID;
BEGIN
    -- Determine user_id to process
    IF TG_OP = 'DELETE' THEN
        target_user_id := OLD.user_id;
        old_month_start := public.month_start_from_ts(OLD.date_ts);
    ELSE
        target_user_id := NEW.user_id;
        new_month_start := public.month_start_from_ts(NEW.date_ts);
        IF TG_OP = 'UPDATE' THEN
            old_month_start := public.month_start_from_ts(OLD.date_ts);
        END IF;
    END IF;

    -- Recompute affected months
    IF TG_OP = 'INSERT' THEN
        PERFORM public.recompute_month_for_user(target_user_id, new_month_start);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.recompute_month_for_user(target_user_id, new_month_start);
        IF old_month_start != new_month_start THEN
            PERFORM public.recompute_month_for_user(target_user_id, old_month_start);
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM public.recompute_month_for_user(target_user_id, old_month_start);
    END IF;

    -- Always recompute last 12m turnover
    PERFORM public.recompute_last12m(target_user_id);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Create triggers

-- Update timestamp triggers
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Transaction change triggers
CREATE TRIGGER handle_transaction_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_transaction_change();

-- Create storage bucket for CSV imports
INSERT INTO storage.buckets (id, name, public) 
VALUES ('imports', 'imports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for CSV import files
CREATE POLICY "Users can view own import files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'imports' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can upload own import files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'imports' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can update own import files" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'imports' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete own import files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'imports' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );