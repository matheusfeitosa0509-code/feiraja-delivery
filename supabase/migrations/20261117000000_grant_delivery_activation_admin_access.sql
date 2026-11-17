-- Permite que o painel admin leia e altere somente a flag de ativação.
-- A policy delivery_settings_admin_only continua exigindo is_current_user_admin().
GRANT SELECT (delivery_ativa) ON TABLE public.delivery_settings TO authenticated;
GRANT UPDATE (delivery_ativa) ON TABLE public.delivery_settings TO authenticated;
