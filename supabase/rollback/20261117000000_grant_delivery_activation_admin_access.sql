-- Reverte os privilégios de coluna adicionados para o interruptor.
REVOKE SELECT (delivery_ativa) ON TABLE public.delivery_settings FROM authenticated;
REVOKE UPDATE (delivery_ativa) ON TABLE public.delivery_settings FROM authenticated;
