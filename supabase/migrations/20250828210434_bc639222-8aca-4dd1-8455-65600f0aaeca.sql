-- Fix security issues: Set search_path for all functions

ALTER FUNCTION month_start_from_ts(TIMESTAMPTZ) SET search_path = '';

ALTER FUNCTION classify_umkm_by_turnover(BIGINT) SET search_path = '';

ALTER FUNCTION generate_transaction_hash(UUID, TIMESTAMPTZ, txn_kind, TEXT, BIGINT, TEXT) SET search_path = '';

ALTER FUNCTION recompute_month_for_user(UUID, DATE) SET search_path = '';

ALTER FUNCTION recompute_last12m(UUID) SET search_path = '';

ALTER FUNCTION update_updated_at_column() SET search_path = '';

ALTER FUNCTION set_transaction_hash() SET search_path = '';

ALTER FUNCTION trigger_recompute_metrics() SET search_path = '';