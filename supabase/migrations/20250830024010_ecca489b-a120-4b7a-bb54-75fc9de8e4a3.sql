-- First, check if the function exists and create it if needed
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