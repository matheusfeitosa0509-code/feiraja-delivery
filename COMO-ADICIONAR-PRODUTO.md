# Como adicionar produto com foto

1. **Receba os dados:** foto do produto, nome, preço, categoria e unidade. Confirme os dados antes de cadastrar.
2. **Prepare a foto:** use uma imagem correta do produto e salve em `imagens/produtos/`. Nomeie o arquivo em minúsculas, sem acentos nem espaços; use hífens se necessário e mantenha a extensão real (por exemplo, `farinha-ova-caroco-1kg.jpg`).
3. **Envie a imagem ao repositório** dentro de `imagens/produtos/` e confirme que o arquivo foi publicado e abre no site.
4. **Cadastre um produto novo** na tabela `products` do Supabase com os campos exigidos pelo esquema atual, incluindo nome, preço, categoria, unidade e `image`. O valor de `image` deve ser o caminho relativo, por exemplo `imagens/produtos/farinha-ova-caroco-1kg.jpg`. Use um identificador novo e preencha os demais campos obrigatórios conforme os produtos existentes.
5. **Confira o resultado:** releia o registro inserido, confirme os dados e o caminho da imagem, e verifique a foto na loja publicada. Informe o resultado; se algo não puder ser confirmado, escreva **“não verificado”**.

**Importante:** faça apenas um `INSERT` para o produto novo. Não altere outros produtos, preços ou estoque. Não substitua fotos existentes. Se faltar informação ou houver dúvida sobre categoria/unidade ou campos obrigatórios, pare e confirme antes de cadastrar.
