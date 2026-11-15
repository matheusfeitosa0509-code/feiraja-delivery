# Entrega Lalamove — fundação Sandbox

Estado: migration e rollback propostos para revisão; nenhum SQL aplicado, nenhuma Edge Function publicada e nenhum segredo consultado ou alterado.

O dono confirmou Manaus disponível na API Sandbox BR/MAO, LALAGO e CAR/HATCHBACK/UV_FIORINO e cotação em 5,9 km de R$ 8,32 (moto) e R$ 13,90 (carro). Esses resultados foram informados pelo dono e não foram reexecutados nesta PR. A função temporária lalamove-check e o Secret LALAMOVE_CHECK_TOKEN foram apagados pelo dono; não recriar.

Modelo:
- products: peso estimado por unidade e indicador volumoso; 33 pesos iniciais sugeridos aprovados, Melancia G/M volumosas.
- customer_profiles: campos separados para rua, número, bairro, complemento e referência; endereço legado preservado.
- orders: endereço, veículo, peso, ID/status/rastreamento/motorista e marcador is_test_order. A taxa cobrada permanece em delivery_fee.
- Custo real exclusivamente em feira_cost_private.order_delivery_costs; nenhum campo de custo real em orders.
- delivery_settings: sem owner_user_id; sem leitura direta por clientes. get_delivery_enabled() retorna somente booleano. RPCs administrativas usam is_current_user_admin().
- is_test_order é ocultado da leitura do cliente e excluído do relatório financeiro.
- Relatório passa a apresentar receita da taxa Lalamove, custo real e resultado após entrega.

Arquivos:
- supabase/migrations/20261114230000_lalamove_delivery_foundation.sql
- supabase/rollback/20261114230000_lalamove_delivery_foundation.sql

Limites desta etapa:
Esta PR contém somente a fundação do banco e rollback. Checkout, cálculo server-side de peso/cotação, Pix de teste administrativo, painel de despacho, webhook com assinatura verificada, rastreio no cliente e testes ponta a ponta permanecem para etapas seguintes. Não mesclar, aplicar SQL, publicar ou ativar.

Revisão obrigatória antes de aplicar:
1. Validar migration em banco descartável.
2. Revisar os 33 pesos estimados e confirmar os IDs atuais.
3. Confirmar a regra de exclusão de pedidos de teste e a política RLS.
4. Confirmar a semântica do lucro líquido após taxa/custo de entrega.
5. Se houver entregas reais, exportar dados antes do rollback.


## Geocodificação dos pontos (Sandbox)

A cotação agora envia latitude/longitude dos dois pontos para a Lalamove e valida que ambos pertencem a Manaus/AM. O serviço usado é o Google Geocoding, exclusivamente no backend da Edge Function.

Configure no Supabase (Project Settings → Edge Functions → Secrets) o segredo:

- Nome: `GOOGLE_GEOCODING_API_KEY`
- Valor: chave do Google Maps Platform com a Geocoding API habilitada.

A chave não deve ser colocada no HTML, no repositório ou em variáveis públicas. Se o segredo não estiver configurado, a função responde com `GEOCODER_NOT_CONFIGURED` e não tenta cotar por texto puro. A resposta ao cliente diferencia endereço não encontrado, endereço fora de Manaus e região não atendida pela Lalamove.
