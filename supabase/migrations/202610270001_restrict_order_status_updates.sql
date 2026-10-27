-- Restrict authenticated order updates to the status column only.
-- Existing RLS policies still decide which rows may be updated (admin policy for orders).
revoke update on table public.orders from authenticated;
grant update (status) on table public.orders to authenticated;
