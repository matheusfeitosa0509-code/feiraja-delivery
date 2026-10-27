# FeiraJá Delivery

Loja estática em português com catálogo Supabase, checkout (Pix Mercado Pago, dinheiro/cartão na entrega), histórico de pedidos e painel administrativo.

## Publicação
O workflow `.github/workflows/pages.yml` publica a raiz do repositório no GitHub Pages a cada push na branch `main`.

- Site: https://matheusfeitosa0509-code.github.io/feiraja-delivery/
- Loja: https://matheusfeitosa0509-code.github.io/feiraja-delivery/loja.html
- Painel: https://matheusfeitosa0509-code.github.io/feiraja-delivery/admin.html
- Recuperação: https://matheusfeitosa0509-code.github.io/feiraja-delivery/recuperar-senha.html

## Supabase
Projeto: `juhwdevvwstmyxyyagzh`.

A chave publishable/anon é pública e pode ser usada no navegador; nunca colocar `service_role`, access token do Mercado Pago ou segredo de webhook no frontend. A migration criada nesta auditoria está em `supabase/migrations/20261027212711_admin_roles_and_order_statuses.sql`. O histórico de versões aplicadas está em `supabase/migrations/README.md`; as políticas RLS atuais estão documentadas em `supabase/policies/current_rls_snapshot.sql`. Os arquivos SQL das migrations antigas não estavam no repositório e não foram reconstruídos por suposição.

## Mercado Pago
A Edge Function `super-worker` recebe pedidos e webhooks. A opção `verify_jwt=false` é intencional para que o Mercado Pago consiga chamar o endpoint sem JWT; a própria função valida assinatura HMAC das notificações e consulta o pagamento à API do Mercado Pago antes de atualizar o pedido.

Configure em **Supabase → Edge Functions → Secrets**:
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`

A URL de notificação usada pelo checkout é `https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/super-worker`. No painel do Mercado Pago, confira também se o evento **Pagamentos** está habilitado para essa URL.

## Autenticação e segurança
- A página de recuperação depende de e-mail/SMTP configurado e da URL `recuperar-senha.html` em Authentication → URL Configuration.
- A autorização administrativa usa a tabela `public.admin_users`; a conta administrativa precisa ter associação nessa tabela.
- As políticas RLS estão nas migrations. Não habilite acesso público de escrita às tabelas.
- O frontend exige senha de 12 caracteres no cadastro; o login aceita senhas antigas válidas.
- O checkout limita pedidos por usuário a 5 em 10 minutos.

## Documentação legal
As páginas de Termos de Uso e Política de Privacidade aguardam os dados comerciais do responsável. Não há links publicados para páginas legais incompletas.
