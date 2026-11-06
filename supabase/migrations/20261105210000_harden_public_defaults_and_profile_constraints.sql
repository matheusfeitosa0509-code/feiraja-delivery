-- Feira On Delivery
-- Migration: harden_public_defaults_and_profile_constraints
-- Restringe privilégios padrão, leitura de perfis e validações de dados.
-- Não altera RLS, pagamentos, Asaas, Mercado Pago ou Edge Functions.

BEGIN;

-- 1. DEFAULT PRIVILEGES: supabase_admin
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
IN SCHEMA public
REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- PUBLIC EXECUTE é um privilégio padrão global, não restrito ao schema.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 2. DEFAULT PRIVILEGES: postgres
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
IN SCHEMA public
REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3. CUSTOMER_PROFILES: SELECT somente nas colunas permitidas
REVOKE SELECT ON TABLE public.customer_profiles
FROM authenticated;

GRANT SELECT (
    user_id,
    full_name,
    phone,
    cpf,
    address,
    updated_at
)
ON TABLE public.customer_profiles
TO authenticated;

-- 4. PRODUCTS: preço positivo
ALTER TABLE public.products
ADD CONSTRAINT products_price_positive_check
CHECK (price > 0);

-- 5. ORDERS: quantidade positiva nos itens JSON
ALTER TABLE public.orders
ADD CONSTRAINT orders_items_positive_quantity_check
CHECK (
    jsonb_typeof(items) = 'array'
    AND NOT jsonb_path_exists(
        items,
        '$[*] ? (
            (!exists(@.qty) && !exists(@.quantity))
            ||
            (
                exists(@.qty)
                &&
                (
                    @.qty.type() != "number"
                    ||
                    @.qty <= 0
                )
            )
            ||
            (
                exists(@.quantity)
                &&
                (
                    @.quantity.type() != "number"
                    ||
                    @.quantity <= 0
                )
            )
        )'
    )
);

-- 6. ORDERS: limites de comprimento dos campos de texto
ALTER TABLE public.orders
ADD CONSTRAINT orders_text_lengths_check
CHECK (
    char_length(id) <= 64
    AND char_length(customer_name) <= 120
    AND char_length(customer_phone) <= 30
    AND char_length(coalesce(customer_cpf, '')) <= 20
    AND char_length(customer_address) <= 500
    AND char_length(delivery_type) <= 20
    AND char_length(payment_method) <= 30
    AND char_length(status) <= 60
    AND char_length(coalesce(customer_email, '')) <= 254
    AND char_length(coalesce(payment_id, '')) <= 200
    AND char_length(coalesce(pix_qr_code, '')) <= 10000
    AND char_length(coalesce(pix_qr_code_base64, '')) <= 500000
    AND char_length(coalesce(payment_provider, '')) <= 30
);

-- 7. CUSTOMER_PROFILES: limites de comprimento dos campos de texto
ALTER TABLE public.customer_profiles
ADD CONSTRAINT customer_profiles_text_lengths_check
CHECK (
    char_length(full_name) <= 120
    AND char_length(phone) <= 30
    AND char_length(coalesce(cpf, '')) <= 20
    AND char_length(address) <= 500
    AND char_length(coalesce(asaas_customer_id, '')) <= 100
);

COMMIT;
