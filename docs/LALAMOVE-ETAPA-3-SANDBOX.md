# Etapa 3 — despacho e acompanhamento Lalamove (somente Sandbox)

## Limites operacionais
- O código usa exclusivamente `https://rest.sandbox.lalamove.com`.
- A Edge Function exige chaves `pk_test` / `sk_test`; não existe fallback para produção.
- `delivery_settings.delivery_ativa` permanece `false`. A função de despacho exige sessão de administrador.
- Nenhuma corrida é criada ao abrir o painel ou ao pedir as cotações. A criação ocorre somente após o administrador tocar em **Confirmar e criar corrida**.
- O clique de criação é protegido por transição atômica no banco (`quoted → creating → created`). Se a chamada ao provedor terminar sem confirmação, o estado permanece `pending`/bloqueado para evitar corrida duplicada.

## Dados
- `orders.delivery_fee` continua sendo a taxa cobrada do cliente.
- Endereço, veículo/peso estimado, status, motorista e link de rastreio ficam nos campos operacionais de `orders`, sujeitos à RLS já existente.
- O ID da corrida e as cotações completas ficam em `feira_cost_private.lalamove_dispatches`.
- O custo real recebido na resposta de criação fica em `feira_cost_private.order_delivery_costs.actual_cost`.
- Eventos recebidos ficam em `feira_cost_private.lalamove_webhook_events`, com `event_id` único e ordenação por timestamp.
- A tela de acompanhamento do cliente exclui pedidos marcados como teste.

## Secrets necessários
Em Supabase → Project Settings → Edge Functions → Secrets:
- `LALAMOVE_SANDBOX_API_KEY` — chave Sandbox já usada na Etapa 2 (`pk_test...`).
- `LALAMOVE_SANDBOX_API_SECRET` — segredo Sandbox já usado na Etapa 2 (`sk_test...`).
- `GOOGLE_GEOCODING_API_KEY` — chave de geocodificação já usada na Etapa 2.
- `LALAMOVE_SENDER_NAME` — nome exibido ao motorista no ponto de coleta.
- `LALAMOVE_SENDER_PHONE` — telefone comercial de coleta com DDD, em formato brasileiro; a função normaliza para `+55...`.

Não cole valores desses secrets no GitHub, no painel ou no chat. Não altere as chaves Lalamove existentes da Etapa 2.

## Webhook Sandbox
URL a cadastrar:
`https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/lalamove-webhook`

No Partner Portal da Lalamove:
1. Entre em https://partnerportal.lalamove.com/.
2. Selecione o ambiente **Sandbox** no seletor do topo.
3. Abra **Developers**.
4. No campo **Webhook URL**, cole a URL acima e toque em **Save**.
5. Selecione **Webhook Version V3**.
6. Consulte **Webhook Attempts** para confirmar respostas HTTP 200 e inspecionar tentativas.

A Edge Function `lalamove-webhook` usa `verify_jwt=false` porque valida a assinatura HMAC da Lalamove com a chave/segredo Sandbox. A função não aceita eventos com assinatura inválida. O caminho assinado é `/functions/v1/lalamove-webhook`.

## Teste manual do pedido de teste já existente
Não crie outro pedido nem outro pagamento para este roteiro.

1. Abra a loja e entre com a mesma conta administradora usada no Pix de teste.
2. No painel, localize o pedido marcado com selo **TESTE** e confira o endereço completo.
3. No seletor **Atualizar status**, escolha **Pronto para Retirada** e toque em **Salvar**.
4. No cartão do pedido, toque em **Chamar entregador**. O painel consulta agora as duas opções: moto e carro.
5. Compare o preço atual de cada veículo com a taxa já cobrada. A diferença é absorvida pela loja.
6. Escolha **Moto** ou **Carro** e só então toque em **Confirmar e criar corrida**.
7. Aguarde o retorno. O painel deve mostrar **Procurando motorista** e, quando a Lalamove enviar o evento, o motorista/telefone/placa e o link de rastreio.
8. Abra o link de rastreio. Na conta do cliente, o acompanhamento mostra o status e o mesmo link; pedidos de teste não aparecem no histórico do cliente.
9. Se quiser validar cancelamento, use **Cancelar entrega** enquanto estiver procurando motorista ou nos primeiros 5 minutos após o motorista aceitar (antes de coletado). A própria Lalamove valida a janela e pode recusar com HTTP 409.
10. Confira **Webhook Attempts** no portal e o status atualizado no painel. A entrega concluída deve mudar o pedido para **Entregue**.

Se a criação ficar em **Confirmando criação no Sandbox**, não toque novamente. Atualize o painel e confira o estado antes de qualquer nova tentativa; o bloqueio permanece intencionalmente ativo até confirmação/reconciliação.

## CI
O workflow `Delivery quote tests` executa:
- `deno check` das Edge Functions de cotação, despacho e webhook;
- testes Deno com chamadas Lalamove mockadas para criação, bloqueio de duplicidade, assinatura válida/inválida e cancelamento;
- testes já existentes de geocodificação, cotação, endereço e UI.

