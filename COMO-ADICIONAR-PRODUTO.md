# Como adicionar um produto com foto

## 1. Receba os dados
Peça ao dono:
- Foto correta do produto;
- Nome;
- Preço;
- Categoria;
- Unidade (por exemplo, kg, g ou pacote).

Se faltar algum dado ou houver dúvida, confirme antes de cadastrar.

## 2. Salve a foto
1. Salve o arquivo em `imagens/produtos/`.
2. Use nome em minúsculas, sem acentos nem espaços; separe palavras com hífens.
3. Mantenha a extensão verdadeira do arquivo (`.jpg`, `.png` etc.).
4. Confira que a imagem foi publicada e abre no site.

Exemplo de nome: `farinha-ova-caroco-1kg.jpg`.

## 3. Cadastre somente o produto novo
Na tabela `products` do Supabase, faça um `INSERT` com os dados recebidos e os campos obrigatórios do esquema atual. Use um identificador exclusivo, seguindo o padrão dos produtos existentes. No campo `image`, grave o caminho relativo, sem domínio:

```text
imagens/produtos/farinha-ova-caroco-1kg.jpg
```

Antes de inserir, confira um produto existente para seguir os nomes dos campos e preencher os demais campos obrigatórios corretamente.

## 4. Confira e informe
Leia de volta o registro inserido e confira nome, preço, categoria, unidade e caminho da imagem. Verifique também a foto na loja publicada. Informe o resultado; se algo não puder ser confirmado, escreva **“não verificado”**.

**Importante:** faça apenas um `INSERT` para o produto novo. Não altere outros produtos, preços ou estoque, não substitua fotos existentes e não faça alterações fora deste procedimento.
