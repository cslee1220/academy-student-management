-- This RPC is called by the authenticated server route through the service-role
-- client. It must not be callable directly by Data API clients.
revoke all on function public.save_grade_promotion_settings_transaction(
  uuid,
  boolean,
  smallint,
  smallint,
  date,
  uuid
) from public, anon, authenticated;

grant execute on function public.save_grade_promotion_settings_transaction(
  uuid,
  boolean,
  smallint,
  smallint,
  date,
  uuid
) to service_role;
