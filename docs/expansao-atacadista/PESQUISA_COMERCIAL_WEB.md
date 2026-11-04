# Agente de pesquisa comercial web

## Objetivo
Localizar presença digital de lojas já cadastradas no Radar e levantar evidências públicas de aderência ao mix TVB: moda masculina, operação multimarcas e marcas comercializadas.

## O que faz
- Pesquisa nome da loja combinado com cidade e UF em mecanismo de busca.
- Identifica URLs candidatas de site e Instagram.
- Não visita Instagram, Facebook ou outras redes sociais; o link social é apenas uma pista para revisão humana.
- Visita no máximo a página inicial de site institucional quando robots.txt permite.
- Extrai título, descrição, menções a moda masculina/multimarcas e marcas de uma lista inicial.
- Registra data, URL da evidência e confiança de correspondência.
- Mantém grupoComercial=PENDENTE e nomeComercialVerificado=false até revisão humana.

## Limitações
Resultado de busca é candidato, não confirmação. Nome parecido não basta. Ausência de site/Instagram não prova que a loja não existe. Menção a marca não prova estoque atual ou autorização de revenda. A busca pública pode limitar ou alterar o HTML. O agente não extrai dados pessoais de sócios, não faz login, não contorna CAPTCHA/bloqueios, não envia mensagens e não atribui leads ao Bruce.

## Instagram e conformidade
A primeira versão não faz scraping do Instagram. A Meta exige autorização expressa para coleta automatizada de dados de seus produtos, conforme https://www.facebook.com/legal/automated_data_collection_terms. O agente apenas identifica links de perfis em resultados de busca, sem acessar o conteúdo do perfil. Consulta programática futura exigirá integração oficial autorizada e permissões aplicáveis.

## Execução
Dry-run:
```bash
npm run prospeccao:pesquisa-web -- --uf RJ --limit 10
```
Gravar no Neon:
```bash
npm run prospeccao:pesquisa-web -- --uf RJ --limit 10 --apply
```
Limite de 25 lojas por execução. Seleciona apenas prospects EM_QUALIFICACAO, grupo PENDENTE, ainda não pesquisados ou com confiança baixa. Execute dry-run primeiro.

## Campos atualizados
site, instagram, evidenciaUrl, evidenciaEm, pesquisadoEm, confiancaPesquisa, justificativaGrupo, observacoes, segmentoComercial e perfilLoja. grupoComercial permanece PENDENTE e nomeComercialVerificado permanece false.
