# Passagem de supervisão — Feira On Delivery

**Atualizado em:** 31/10/2026 (fuso do dono: Manaus, UTC−4)  
**Objetivo:** permitir que outra IA supervisora assuma o projeto sem confundir fatos, hipóteses, estado implantado e alterações apenas propostas.

## 1. Identidade e regras permanentes

- **Nome comercial oficial:** Feira On Delivery.
- **Repositório técnico que não deve ser renomeado:** `matheusfeitosa0509-code/feiraja-delivery`.
- **Arquivos técnicos principais:** `loja.html`, `previa/loja.html` e funções Supabase sob `supabase/functions/`.
- **Hospedagem da loja:** GitHub Pages. O domínio `matheusfeitosa0509-code.github.io` foi identificado no histórico; o URL completo publicado e sua configuração atual não foram revalidados nesta passagem.
- Textos legados com “FeiraJá” ainda podem existir no código. Não tratar esse nome como marca comercial oficial e não trocar textos fora do escopo de uma ordem.
- Não presumir que um PR aberto está implantado. Código em branch/PR, código em `main` e função implantada são estados diferentes.
- Nunca expor senhas, chaves, tokens, dados de clientes, códigos Pix ou valores de segredos. Não incluir dados pessoais reais em documentação.
- Fazer diagnóstico antes de modificar. Alterar somente arquivos/itens autorizados. Se houver conflito de escopo, informação insuficiente ou dúvida de segurança, parar e pedir autorização.
- Distinguir sempre **Confirmado**, **Hipótese** e **Não verificado**. Não declarar testes, compilação, implantação ou correção concluída sem evidência.
- Nenhuma ordem autoriza automaticamente mesclagem ou implantação, salvo autorização explícita.

## 2. Papéis

- **Dono:** decide prioridades, fornece ordens e autoriza ações conforme o nível indicado.
- **IA supervisora:** divide o trabalho em ordens verificáveis, revisa o resultado, cobra evidências e mantém o estado do projeto atualizado.
- **IA executora:** realiza apenas o escopo autorizado, verifica o diff, informa limites e não amplia o trabalho por iniciativa própria.

## 3. Níveis de autorização

- **Nível 0 — somente leitura:** inspeção e relatório; não alterar arquivos, PRs, branches, configurações ou dados.
- **Nível 2 — alterações limitadas em GitHub:** pode criar/atualizar branch, commits e PR dentro do escopo expresso; não mesclar nem implantar quando isso não estiver explicitamente autorizado.
- **Níveis 1, 3 e 4:** definição exata não confirmada no registro disponível. Não inferir permissões nem equiparar um nível a outro; pedir ao dono a definição antes de executar ações que dependam deles.

O nível é o teto de autorização, não uma obrigação de executar tudo. As proibições e condições de parada específicas da ordem continuam valendo.

## 4. Formato obrigatório de ordem e relatório

Cada ordem deve identificar, de forma explícita:

1. Número e título.
2. Objetivo.
3. Contexto e referências/SHA.
4. Diagnóstico inicial, incluindo a hipótese a tentar refutar.
5. Escopo autorizado.
6. Itens proibidos.
7. Procedimento numerado.
8. Critérios de aceitação.
9. Testes obrigatórios.
10. Nível de autorização.
11. Condição de parada.
12. Formato esperado do relatório.

O relatório deve usar o título **Ordem Nº N**, informar **Status** e responder aos itens numerados pedidos. Deve incluir SHAs, arquivos/diff, testes realmente executados, limitações e próximos passos. Separar **Confirmado**, **Hipótese** e **Não verificado**. Se nada foi testado, dizer literalmente que nenhum teste funcional foi executado.

## 5. Arquitetura conhecida

### Front-end e arquivos

- `loja.html`: página principal da loja.
- `previa/loja.html`: versão de prévia; não presumir que é a página publicada.
- `imagens/produtos/`: diretório de imagens de produtos informado pelo dono. A exibição de todas as imagens ainda não foi verificada visualmente.
- `supabase/functions/super-worker/index.ts`: checkout, fluxo Mercado Pago Pix e tratamento de notificações/consultas relacionadas.
- `supabase/functions/asaas-webhook/index.ts`: função nova proposta no PR #31; **não está implantada** conforme o estado verificado.
- `expire-pix`: função Supabase indicada no histórico como versão implantada 2. O caminho-fonte correspondente não foi encontrado em `main` durante a preparação desta passagem; verificar antes de editar.
- GitHub Pages publica a loja; Supabase Edge Functions e banco dão suporte ao checkout e aos pedidos.

### Tabelas e colunas conhecidas — estrutura, sem dados

- `public.products`: `id`, `name`, `price`, `category`, `image`, `available`, `created_at`.
- `public.orders`: `id`, `customer_name`, `customer_phone`, `customer_cpf`, `customer_address`, `delivery_type`, `payment_method`, `items`, `subtotal`, `delivery_fee`, `total`, `status`, `market_checklist`, `created_at`, `customer_email`, `payment_id`, `pix_qr_code`, `pix_qr_code_base64`, `user_id`, `payment_provider`.
- `public.customer_profiles`: `user_id`, `full_name`, `phone`, `cpf`, `address`, `updated_at`, `asaas_customer_id`.
- `public.admin_users`: `user_id`, `created_at`.
- A estrutura acima foi consultada sem ler valores de linhas. As colunas `payment_provider` e `asaas_customer_id` foram confirmadas no esquema; são nullable text sem valor padrão.
- As políticas RLS e as configurações de autenticação não devem ser alteradas sem ordem específica. A coluna `asaas_customer_id` foi descrita como gravável pelo próprio usuário sob a política atual; o servidor precisa verificar o ID no Asaas antes de reutilizá-lo.

### Pagamentos

- **Mercado Pago Pix é o fluxo atual de referência.** A integração Asaas foi preparada para ficar desligada por padrão; só deve selecionar Asaas quando a variável de ativação for exatamente `"true"`.
- O código proposto para Asaas usa cliente, cobrança PIX, QR Code e webhook separado. Não foi executado contra Asaas real nem sandbox.
- O webhook Asaas precisa de configuração própria e, na implantação autorizada, de `verify_jwt=false` no gateway do Supabase, mantendo autenticação pelo cabeçalho próprio do webhook. Essa configuração ainda não foi aplicada nem verificada para a função nova.
- Não executar transações reais como parte de uma revisão de código. O dono informou que prefere testar a conta real com um Pix de valor mínimo apenas após revisão e autorização separada.

## 6. Estado atual do GitHub

### `main`

- **SHA:** `69cee8d55b45da90581047701768730863419ad8`.
- A comparação de `main` com esse SHA foi verificada como idêntica na preparação deste documento.
- Blob de `loja.html`: `09da97edc577a4cf8d60729fc14c76cad9856c7f`.
- Blob de `previa/loja.html`: `d62c390fd68da361559c9ac143c889e28f23f9d3`.

### PR #30 — reconciliação da `super-worker` v24

- **Estado:** aberto, não mesclado.
- **Branch:** `chore/reconciliar-super-worker-v24`.
- **Head:** `bd0897afd90e315261a9d876ea5dd80d09433a59`.
- **Base:** `main` em `69cee8d55b45da90581047701768730863419ad8`.
- A proposta altera somente `supabase/functions/super-worker/index.ts), para corresponder à fonte da versão 24 implantada.
- A fonte da função implantada foi comparada com a fonte nessa branch e coincidiu exatamente no momento da revisão.

### PR #31 — integração Asaas

- **URL:** https://github.com/matheusfeitosa0509-code/feiraja-delivery/pull/31
- **Estado:** aberto, não mesclado e não implantado.
- **Branch:** `feat/asaas-pix`.
- **Head atual ao preparar esta passagem:** `60303154cf13631a518f592cb4c8c78671d71989`.
- **Base atual:** `chore/reconciliar-super-worker-v24`, SHA `bd0897afd90e315261a9d876ea5dd80d09433a59`.
- A Ordem 38 adicionou commits para: retentativa do webhook quando ainda não há `payment_id`; verificação do cancelamento; verificação de respostas de exclusão de cobrança; e reconciliação de falhas inesperadas.
- **Pendência de escopo:** depois de mudar a base, o diff ainda mostra quatro arquivos: os dois arquivos TypeScript e as duas páginas HTML com uma alteração antiga de mensagem. A Ordem 38 autorizou editar somente os dois arquivos TypeScript. Não remover as duas alterações HTML sem autorização adicional do dono. Portanto, o critério de diff limitado a dois arquivos ainda não foi satisfeito.
- A compilação integral TypeScript/Deno não foi executada. Nenhum teste funcional foi executado. Não houve implantação, mesclagem, chamada à API do Asaas ou criação de pagamento.

## 7. Histórico resumido e pendências

### Histórico — distinguir relato do dono de verificação independente

- O dono informou que um Pix real de teste em **30/10/2026** foi pago, mudou para **Pagamento Confirmado** e retornou à área de pedidos. Esse relato é parte do histórico; não foi repetido nesta passagem.
- O dono informou que o login e a recuperação de senha por e-mail funcionaram em um teste anterior. O estado atual de autenticação não foi revalidado nesta passagem.
- Houve relato de problema de rolagem no modal de finalização do Pix em celular. A resolução definitiva e a confirmação visual atual não estão verificadas neste registro.
- O dono informou que o histórico de pedidos após sair/entrar e após alterações de status foi retestado e passou a funcionar. Não foi reexecutado nesta passagem.
- Pedidos antigos de teste sem vínculo foram identificados no histórico. Não há confirmação suficiente aqui de que todos tenham sido cancelados ou removidos; não os alterar sem ordem.
- A `super-worker` v24 está implantada; o PR #30 tenta reconciliar o código-fonte no GitHub com ela.
- As colunas `payment_provider` e `asaas_customer_id` foram confirmadas no esquema.
- O Asaas está apenas em PR, não implantado. As ordens 37 e 38 proibiram testes funcionais em produção e sandbox.

### Pendências abertas

1. **Asaas:** resolver os pontos de código pendentes do PR #31; completar compilação/revisão; corrigir o diff para conter somente os dois arquivos autorizados, após autorização para retirar as alterações antigas das páginas HTML; configurar o webhook apenas em uma ordem de implantação autorizada; testar os cenários antes de habilitar a integração.
2. **Páginas legais e CNPJ:** conteúdo e estado final não verificados; precisam de decisão/conteúdo do dono.
3. **WhatsApp:** o dono indicou que haverá um número novo. O número não deve ser incluído nesta passagem e ainda não foi fornecido/confirmado para uso.
4. **Produtos:** continuar cadastro e associação de imagens somente com produto corretamente identificado. O dono pediu imagens do produto real, cartão com imagem inteira (`object-fit: contain`) e um placeholder visível quando a imagem falhar. A exibição final das imagens não está visualmente verificada.
5. **Textos legados:** revisar “FeiraJá” e mensagens de Pix quando houver ordem específica; não fazer busca-e-substituição ampla nem alterar conteúdo fora do escopo.
6. **Deploy:** não mesclar nem implantar PR #30 ou #31 sem autorização explícita.

## 8. Preferências do dono e lições aprendidas

- Prefere respostas curtas, simples e práticas.
- Prefere ordens prontas em bloco de código para copiar e encaminhar.
- Trabalhar uma etapa por vez; explicar claramente o que foi feito, o que falta e o que depende do dono.
- Corrigir somente o que foi pedido. Se encontrar algo fora do escopo, informar em vez de corrigir.
- Confirmar data e fuso antes de afirmar horários; o fuso de referência é **Manaus, UTC−4**.
- Não transformar hipótese em fato. Indicar a evidência e o que ainda não foi verificado.
- Não afirmar “compilado”, “testado”, “corrigido”, “cancelado”, “mesclado” ou “implantado” sem confirmação correspondente.
- Após cada ordem futura, atualizar este documento em **PR próprio**, sem misturar a passagem com alterações de código do projeto, salvo instrução explícita diferente.
- Ao criar/atualizar este documento, verificar que contém somente fatos necessários de projeto e não inclui dados pessoais, chaves, tokens, senhas, códigos Pix ou valores de segredos.
