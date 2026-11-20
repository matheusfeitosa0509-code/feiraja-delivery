-- The deployed lalamove-webhook sends p_cancel_reason and p_ambiente.
-- Keep the exact 9-argument RPC used by webhook-event.ts; remove only the
-- obsolete 8-argument overload that PostgREST health checks report as ambiguous.
drop function if exists public.service_apply_lalamove_webhook(
  text, text, timestamptz, text, text, text, jsonb, text
);

revoke all on function public.service_apply_lalamove_webhook(
  text, text, timestamptz, text, text, text, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.service_apply_lalamove_webhook(
  text, text, timestamptz, text, text, text, jsonb, text, text
) to service_role;
