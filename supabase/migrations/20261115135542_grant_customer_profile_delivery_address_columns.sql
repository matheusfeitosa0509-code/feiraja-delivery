-- The customer_profiles RLS policies continue to restrict rows to auth.uid().
-- Grant only the structured delivery-address columns used by the storefront.
GRANT SELECT (address_street, address_number, address_neighborhood, address_complement, address_reference)
ON TABLE public.customer_profiles TO authenticated;

GRANT INSERT (address_street, address_number, address_neighborhood, address_complement, address_reference)
ON TABLE public.customer_profiles TO authenticated;

GRANT UPDATE (address_street, address_number, address_neighborhood, address_complement, address_reference)
ON TABLE public.customer_profiles TO authenticated;
