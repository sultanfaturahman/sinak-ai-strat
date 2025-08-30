-- Ensure all required types exist
CREATE TYPE txn_kind AS ENUM ('income', 'cogs', 'expense');
CREATE TYPE umkm_level AS ENUM ('mikro', 'kecil', 'menengah', 'besar');
CREATE TYPE import_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE ai_summary_type AS ENUM ('strategy_plan', 'analysis', 'report');

-- Ensure all required tables exist with proper structure
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

-- Ensure the deduplication index exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedup ON public.transactions (user_id, uniq_hash);

-- Ensure RLS is enabled
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Ensure RLS policies exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'transactions' 
        AND policyname = 'Users can insert their own transactions'
    ) THEN
        CREATE POLICY "Users can insert their own transactions" ON public.transactions
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;