-- Create ENUM types
CREATE TYPE txn_kind AS ENUM ('income', 'cogs', 'expense');
CREATE TYPE umkm_level AS ENUM ('mikro', 'kecil', 'menengah', 'besar');
CREATE TYPE import_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE ai_summary_type AS ENUM ('strategy_plan', 'cashflow_forecast', 'pricing_review', 'marketing_plan');

-- Create profiles table
CREATE TABLE public.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    city TEXT,
    umkm_level umkm_level DEFAULT 'mikro',
    last12m_turnover_rp BIGINT DEFAULT 0,
    last_recomputed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date_ts TIMESTAMPTZ NOT NULL,
    kind txn_kind NOT NULL,
    category TEXT NOT NULL,
    amount_rp BIGINT NOT NULL,
    notes TEXT,
    uniq_hash TEXT GENERATED ALWAYS AS (
        encode(sha256((user_id::text || '|' || date_ts::text || '|' || kind::text || '|' || category || '|' || amount_rp::text || '|' || COALESCE(notes, ''))::bytea), 'hex')
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create monthly_metrics table
CREATE TABLE public.monthly_metrics (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    month_start DATE NOT NULL,
    sales_rp BIGINT DEFAULT 0,
    cogs_rp BIGINT DEFAULT 0,
    opex_rp BIGINT DEFAULT 0,
    gross_profit_rp BIGINT GENERATED ALWAYS AS (sales_rp - cogs_rp) STORED,
    net_profit_rp BIGINT GENERATED ALWAYS AS (sales_rp - cogs_rp - opex_rp) STORED,
    gross_margin DECIMAL GENERATED ALWAYS AS (
        CASE WHEN sales_rp > 0 THEN ((sales_rp - cogs_rp)::decimal / sales_rp::decimal) * 100 ELSE 0 END
    ) STORED,
    net_margin DECIMAL GENERATED ALWAYS AS (
        CASE WHEN sales_rp > 0 THEN ((sales_rp - cogs_rp - opex_rp)::decimal / sales_rp::decimal) * 100 ELSE 0 END
    ) STORED,
    mom_sales_pct DECIMAL DEFAULT 0,
    top_expenses JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, month_start)
);

-- Create ai_summaries table
CREATE TABLE public.ai_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type ai_summary_type NOT NULL,
    model TEXT NOT NULL,
    context_snapshot JSONB DEFAULT '{}',
    result_json JSONB DEFAULT '{}',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create import_runs table
CREATE TABLE public.import_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    status import_status DEFAULT 'running',
    total_rows INTEGER DEFAULT 0,
    total_imported INTEGER DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

-- Create indexes
CREATE UNIQUE INDEX idx_transactions_uniq_hash ON public.transactions(user_id, uniq_hash);
CREATE INDEX idx_transactions_date_kind ON public.transactions(user_id, date_ts, kind);
CREATE INDEX idx_monthly_metrics_month ON public.monthly_metrics(user_id, month_start DESC);
CREATE INDEX idx_ai_summaries_type_date ON public.ai_summaries(user_id, type, created_at DESC);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions" ON public.transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions" ON public.transactions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions" ON public.transactions
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own metrics" ON public.monthly_metrics
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own metrics" ON public.monthly_metrics
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own metrics" ON public.monthly_metrics
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own summaries" ON public.ai_summaries
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own summaries" ON public.ai_summaries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own import runs" ON public.import_runs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own import runs" ON public.import_runs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own import runs" ON public.import_runs
    FOR UPDATE USING (auth.uid() = user_id);

-- Utility functions
CREATE OR REPLACE FUNCTION month_start_from_ts(ts TIMESTAMPTZ)
RETURNS DATE AS $$
BEGIN
    RETURN date_trunc('month', ts)::date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION classify_umkm_by_turnover(turnover_rp BIGINT)
RETURNS umkm_level AS $$
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
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION recompute_month_for_user(p_user_id UUID, p_month_start DATE)
RETURNS VOID AS $$
DECLARE
    v_sales_rp BIGINT := 0;
    v_cogs_rp BIGINT := 0;
    v_opex_rp BIGINT := 0;
    v_mom_sales_pct DECIMAL := 0;
    v_top_expenses JSONB := '[]';
    v_prev_month_sales BIGINT := 0;
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recompute_last12m(p_user_id UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger function for recomputing metrics
CREATE OR REPLACE FUNCTION trigger_recompute_metrics()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- Create trigger for automatic metric recomputation
CREATE TRIGGER transactions_recompute_metrics
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_recompute_metrics();