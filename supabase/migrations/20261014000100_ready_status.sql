-- Separate migration: PostgreSQL must commit a new enum value before use.
alter type public.order_status add value if not exists 'ready' after 'assembling';
