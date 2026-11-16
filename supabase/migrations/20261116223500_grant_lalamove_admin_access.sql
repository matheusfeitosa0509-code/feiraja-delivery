GRANT SELECT (singleton, lalamove_ambiente)
ON TABLE public.delivery_settings
TO authenticated;

GRANT UPDATE (lalamove_ambiente)
ON TABLE public.delivery_settings
TO authenticated;
