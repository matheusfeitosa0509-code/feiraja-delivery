-- Restrict direct privileges on public.admin_users.
REVOKE ALL PRIVILEGES ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL PRIVILEGES (user_id, created_at) ON TABLE public.admin_users FROM anon, authenticated;
GRANT SELECT ON TABLE public.admin_users TO authenticated;
