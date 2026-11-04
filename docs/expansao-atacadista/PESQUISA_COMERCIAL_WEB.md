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

## Aprendizado comercial com o histórico do Bruce

O Radar usa a interação mais recente de cada loja (não soma contatos repetidos como lojas diferentes) para identificar padrões por segmento, perfil de loja, faixa de preço e UF.

- Só exibe padrões com pelo menos 5 lojas distintas e 3 resultados conclusivos (positivos ou negativos).
- Interesse, pedido de catálogo/preço e negociação são sinais de avanço, não conversões.
- `PEDIDO_REALIZADO` registrado manualmente pelo Bruce também é apenas sinal positivo. Conversão só é contabilizada quando o status `CONVERTIDO` é confirmado pela integração DAPIC.
- `SEM_RESPOSTA` e `OUTRO` não entram no cálculo de sinais positivos/negativos.
- A confiança é baixa entre 5–9 lojas, média entre 10–19 e alta a partir de 20.
- O agente de pesquisa prioriza, entre os prospects já capturados e ainda pendentes, os que compartilham atributos com perfis que tiveram melhor histórico. A pontuação é explicável (segmento, perfil, faixa de preço e UF) e não aprova nem descarta ninguém.
- Se não houver amostra suficiente, não cria padrão nem altera a fila. Nenhum contato é enviado automaticamente.

## Descoberta de lojas novas a partir dos padrões aprendidos

O workflow manual `.github/workflows/descoberta-comercial-radar.yml` gera consultas de busca usando os perfis que o aprendizado do Bruce identificou na UF selecionada. Ele procura sites públicos, visita somente páginas permitidas por `robots.txt` e exige evidência textual de moda masculina e de operação multimarcas (ou pelo menos duas marcas reconhecidas) para listar um candidato.

Execução local:
```bash
npm run prospeccao:descobrir -- --uf RJ --max-queries 8 --max-candidates 40
```

No GitHub, abra **Actions → Descoberta de novas lojas pelo Radar → Run workflow**, escolha a UF e baixe o artefato gerado. O artefato contém CSV e JSON com URL, domínio, trecho de busca, sinais encontrados, marcas mencionadas, pontuação de evidência e perfil que originou a busca. Fica disponível por 30 dias.

### Limites e controles
- O agente é somente leitura: consulta interações do Bruce no Neon, mas não cria, atualiza, atribui ou exclui registros. O código rejeita explicitamente `--apply`.
- Use no secret `DATABASE_URL` uma credencial Postgres de leitura (SELECT) sempre que possível. Não reutilize credencial administrativa para esse workflow.
- O resultado é uma lista de candidatos para revisão, não uma lista de lojas aprovadas. Pontuação mede evidência textual encontrada, não potencial financeiro, crédito, intenção de compra ou legitimidade cadastral.
- A busca pode retornar diretórios, homônimos ou páginas desatualizadas. A equipe deve confirmar nome, cidade, CNPJ, operação ativa, contato comercial e aderência antes de cadastrar no Radar.
- Sites sem evidência textual suficiente são descartados da lista; isso não prova que a loja não exista.
- Redes sociais não são acessadas. Instagram aparece apenas no fluxo de pesquisa anterior como URL candidata em buscador, sem coleta de conteúdo.
- Não há envio de mensagens, importação em massa, aprovação automática ou conversão automática.
- A primeira versão descobre via busca pública e sites indexados; não varre a base bruta de 170 mil CNPJs nem substitui a captura cadastral externa.

## Revisão humana dos candidatos descobertos

Depois de executar **Actions → Descoberta de novas lojas pelo Radar**, baixe o artefato e extraia o CSV. Na Central de Prospecção, use a seção **Revisão de descoberta web** para carregar o CSV.

Para cada loja que deseja incluir:
1. Abra o site e confira se o nome e a operação correspondem à loja real.
2. Marque a loja e confirme/edite o nome comercial.
3. Informe CNPJ, cidade e UF.
4. Aprove somente depois da conferência.

O servidor valida o formato e os dígitos verificadores do CNPJ (incluindo a estrutura alfanumérica), rejeita dados inválidos e ignora duplicados por CNPJ ou site. Essa validação matemática **não confirma situação ativa, endereço, quadro societário ou atividade na Receita Federal**; essa consulta cadastral oficial continua sendo uma etapa separada.

A aprovação coloca o registro como `NOVO`, com `grupoComercial=PENDENTE`, origem `pesquisa_web` e trilha de auditoria. Não o marca como qualificado, não atribui a Bruce e não envia contato. A qualificação comercial e a aprovação para a carteira seguem etapas posteriores.
\n\n## Consulta cadastral oficial via Serpro\n\nA consulta oficial em tempo real é feita pela API Consulta CNPJ do Serpro, diretamente conectada à base da Receita Federal. Para pessoa jurídica privada, a contratação é feita na Loja Serpro e exige certificado digital e-CNPJ; o custo depende do tipo e do volume de consulta. A página do serviço descreve uma demonstração gratuita limitada a 30 dias ou 3.000 consultas, conforme condições do Serpro.\n\n- Serviço e contratação: https://www.gov.br/pt-br/servicos/obter-solucao-de-consulta-de-dados-do-cadastro-nacional-de-pessoas-juridicas-cnpj\n- Manual técnico e autenticação: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cnpj/pt/quick_start/\n\nConfigure no GitHub Actions os secrets `SERPRO_CNPJ_CONSUMER_KEY` e `SERPRO_CNPJ_CONSUMER_SECRET`, obtidos na Área do Cliente Serpro após contratação/ativação. Opcionalmente, configure as variables `SERPRO_CNPJ_API_BASE_URL` e `SERPRO_CNPJ_TOKEN_URL` somente se o Serpro fornecer endpoints diferentes dos padrões documentados. Nunca coloque credenciais no código ou no Neon.\n\nO workflow manual **Consulta cadastral oficial CNPJ - Serpro** começa em modo de prévia e não chama a API. Para consultas reais, é necessário marcar explicitamente `aplicar=true`; cada CNPJ pode consumir a franquia/crédito do contrato. Limite de 25 por rodada; comece com 1 a 5. O agente consulta prospects com CNPJ, status NOVO/EM_QUALIFICACAO, grupo PENDENTE e ainda sem `confiancaPesquisa=CADASTRAL_OFICIAL`.\n\nRegistra situação cadastral, data/motivo, CNAE principal e secundários, endereço, telefone, e-mail e data de abertura. Preserva observações anteriores e mantém status comercial, grupo PENDENTE, responsável e `nomeComercialVerificado=false`. Situação ATIVA não significa aderência comercial; situações BAIXADA/INAPTA/SUSPENSA não são descartadas automaticamente. A integração usa apenas a consulta Básica; não consulta QSA nem CPF de sócios.\n