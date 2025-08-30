-- 0) ENUM untuk jenis transaksi (jika belum ada)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'txn_kind') then
    create type public.txn_kind as enum ('income','cogs','expense');
  end if;
end $$;

-- 1) FUNGSI HASH (signature ENUM) — inilah yang dicari oleh kolom generated Anda
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

-- 2) (Opsional, tapi disarankan) Overload: versi KIND=TEXT
--    Berguna bila suatu saat ada view/proses lain yang memanggilnya dengan TEXT.
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

-- 3) Unique index untuk dedup (aman kalau sudah ada)
create unique index if not exists transactions_user_hash_uniq
  on public.transactions(user_id, uniq_hash);