# FeiraJá Delivery

Site estático em português com página inicial e fluxo de recuperação de senha Supabase.

## Publicação
O workflow em `.github/workflows/pages.yml` publica a raiz do repositório no GitHub Pages a cada push na branch `main`.

URL esperada: https://matheusfeitosa0509-code.github.io/feiraja-delivery/

## Ativar recuperação de senha
1. No Supabase Dashboard do projeto `juhwdevvwstmyxyyagzh`, abra **Project Settings → API** e copie a chave pública **publishable** ou a chave legada **anon**.
2. Em `recuperar-senha.html`, substitua `COLE_AQUI_SUA_CHAVE_PUBLICA_SUPABASE` pela chave pública.
3. No Supabase, em **Authentication → URL Configuration**, configure o Site URL e inclua a URL publicada e `https://matheusfeitosa0509-code.github.io/feiraja-delivery/recuperar-senha.html` em Redirect URLs.
4. Confirme que o provedor Email está habilitado.

Nunca use a chave `service_role` ou qualquer chave secreta no frontend.
