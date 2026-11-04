# Prospecção externa — configuração do armazenamento

## Objetivo

A base bruta da Receita Federal deve permanecer fora do Postgres operacional do Radar. O Neon recebe somente oportunidades que passarem pela pesquisa comercial e forem aprovadas para entrar na fila.

## Armazenamento

O workflow `.github/workflows/agentes-prospeccao.yml` grava o Parquet compactado e um manifesto JSON em um bucket compatível com S3, organizado por competência e UF. O manifesto informa quantidade de linhas, filtros, horário de geração e SHA-256 do arquivo para conferência de integridade:

`receita-cnpj/competencia=AAAA-MM/uf=UF/candidatos.parquet`

Cloudflare R2 é uma opção recomendada. Também é possível usar outro serviço compatível com S3.

## Secrets do GitHub

No repositório, abra **Settings → Secrets and variables → Actions → New repository secret** e cadastre:

| Secret | Valor |
|---|---|
| `PROSPECCAO_S3_ACCESS_KEY_ID` | Access key do bucket |
| `PROSPECCAO_S3_SECRET_ACCESS_KEY` | Secret key do bucket |
| `PROSPECCAO_S3_ENDPOINT` | Endpoint S3 do provedor |
| `PROSPECCAO_S3_BUCKET` | Nome do bucket |
| `PROSPECCAO_S3_REGION` | Região do bucket; no Cloudflare R2, use `auto` |

Crie uma credencial limitada ao bucket de prospecção, sem permissões sobre outros buckets ou serviços. Não coloque credenciais no código, em arquivos versionados ou em logs.

## Primeira execução

1. Configure o bucket e os cinco secrets acima.
2. Abra **Actions → Exportação controlada de candidatos de prospecção TVB → Run workflow**.
3. Escolha a UF e a competência da Receita.
4. Acompanhe a execução e confirme que o arquivo foi gravado no bucket.

O workflow é manual. Não possui agendamento nem gatilho de push. Ele não conecta ao Neon, não cria registros em `AtacadoProspect` e não atribui oportunidades a agentes.

## Escopo atual do extrator

A consulta atual seleciona estabelecimentos:
- com situação cadastral ativa;
- com CNAE principal `4781400`;
- com nome fantasia preenchido;
- com telefone ou e-mail cadastral.

O filtro é uma etapa de captura cadastral, não uma confirmação de que a loja vende moda masculina ou trabalha com multimarcas. Essa validação precisa ser feita depois por pesquisa comercial com evidências verificáveis.

A execução é por UF e competência. O workflow oferece as 27 UFs; para cobrir o território nacional, será necessário executar cada UF e controlar a competência de cada partição. Não interpretar o resultado de uma UF como a base nacional completa. O arquivo é processado sem ordenar toda a base, evitando custo de memória e tempo desnecessário.

## Fluxo desejado após a captura

1. **Captura externa:** mantém os registros brutos no bucket.
2. **Deduplicação:** usa CNPJ como chave e preserva competência/origem.
3. **Pesquisa cadastral:** valida situação, contatos e consistência.
4. **Pesquisa comercial:** verifica site, redes sociais, mix, marcas, moda masculina, perfil multimarcas e evidências.
5. **Revisão humana:** só oportunidades aprovadas entram no Radar.
6. **Bruce:** acompanha negociações já atribuídas, registra resultados e sugere padrões aos agentes de captura; não prospecta nem atribui leads.

## Segurança operacional

- Não importar a base bruta em massa para o Neon.
- Não inferir perfil comercial ou classificação A/B/C/D apenas pelo CNAE.
- Não enviar mensagens automaticamente.
- Não marcar convertido sem confirmação do primeiro pedido no DAPIC.
- Não usar o token WebDAV antigo: ele esteve versionado em repositório público e precisa ser revogado/rotacionado na origem antes de qualquer reutilização.
