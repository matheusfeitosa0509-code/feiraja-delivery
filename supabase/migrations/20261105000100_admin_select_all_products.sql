-- Permite que administradores autenticados consultem também produtos indisponíveis.
-- A política pública existente para produtos disponíveis permanece inalterada.
CREATE POLICY "Admins can read unavailable products"
ON public.products
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = (SELECT auth.uid())
  )
);
