-- Fix search_path security warning untuk fungsi generate_transaction_hash yang baru dibuat
create or replace function public.generate_transaction_hash(
  p_user_id   uuid,
  p_date_ts   timestamptz,
  p_kind      public.txn_kind,
  p_category  text,
  p_amount_rp bigint,
  p_notes     text
) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select md5(
    coalesce(p_user_id::text,'') || '|' ||
    to_char(date_trunc('day', p_date_ts), 'YYYY-MM-DD') || '|' ||
    p_kind::text || '|' ||
    coalesce(trim(p_category),'') || '|' ||
    coalesce(p_amount_rp::text,'') || '|' ||
    coalesce(trim(p_notes),'')
  );
$$;

-- Fix search_path security warning untuk overload text version
create or replace function public.generate_transaction_hash(
  p_user_id   uuid,
  p_date_ts   timestamptz,
  p_kind      text,
  p_category  text,
  p_amount_rp bigint,
  p_notes     text
) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select md5(
    coalesce(p_user_id::text,'') || '|' ||
    to_char(date_trunc('day', p_date_ts), 'YYYY-MM-DD') || '|' ||
    coalesce(trim(p_kind),'') || '|' ||
    coalesce(trim(p_category),'') || '|' ||
    coalesce(p_amount_rp::text,'') || '|' ||
    coalesce(trim(p_notes),'')
  );
$$;