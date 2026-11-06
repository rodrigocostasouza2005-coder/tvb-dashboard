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

A execução é por UF e competência. **Correção (2026-11): o workflow NÃO oferece as 27 UFs hoje.** O job `exportar-sem-neon` em `.github/workflows/agentes-prospeccao.yml` chama `extrair-parquet-receita.py` com uma lista fixa de 17 UFs litorâneas (`AL AP BA CE ES MA PA PB PE PI PR RJ RN RS SC SE SP`), e o próprio script rejeita qualquer UF fora dessa lista (`ESTADOS_LITORANEOS`, hard-coded). Não interpretar o resultado de uma UF — nem dos 17 estados litorâneos somados — como a base nacional completa. O arquivo é processado sem ordenar toda a base, evitando custo de memória e tempo desnecessário.

### Checklist de preparação da descoberta nacional (27 UFs) — NÃO executada ainda

Levantamento feito ao preparar o motor de qualificação (rebuild Fase 1, PR #51) para uso real. Isto é só preparação/documentação — nenhuma coleta nacional foi disparada.

- **Caminho 1 (em uso hoje, só 17 UFs litorâneas):** `extrair-parquet-receita.py` lê um espelho Parquet remoto (`hf://datasets/cnpjaberto/...`) via DuckDB, sem baixar o dump nacional. Rápido, mas bloqueado por um allowlist de 17 UFs no próprio script e hard-coded de novo no step do workflow. Para virar nacional: (1) expandir `ESTADOS_LITORANEOS` pras 27 UFs (26 estados + DF), (2) trocar o `--ufs` fixo do workflow por um input real, (3) **confirmar antes com Rodrigo** que o dataset `cnpjaberto` no Hugging Face tem cobertura completa pros estados do interior com a mesma qualidade dos litorâneos — não testamos isso, é suposição razoável pelo nome do dataset ("brasil"), não um fato verificado.
- **Caminho 2 (não usado em CI, só manual/local):** `baixar_receita_cnpj.py` (download retomável via WebDAV dos ZIPs oficiais da Receita) + `gerar-prospects-rj.py` (parsing local dos CSVs). Este caminho **não tem** a restrição de 17 UFs no código — `--ufs` aceita qualquer sigla de 2 letras, porque os arquivos da Receita já vêm com todo o Brasil misturado, sem particionamento por UF. Mas nunca foi testado/comprovado fora do RJ (nome do script é literalmente `gerar-prospects-rj.py`) e não está ligado a nenhum workflow — é só execução manual local, com os ZIPs nacionais (dezenas de GB) baixados e extraídos à mão.
- **quota-geografica.ts / capitais-estaduais.ts:** não estavam importados em nenhum lugar fora dos próprios arquivos/testes até este PR. Agora o `capitalEstadual` é calculado e gravado de verdade nas duas etapas reais do pipeline (`agente-qualificacao.ts` e `agente-pesquisa-comercial.ts`); `prepararCandidatosParaQuota()` (novo, em `adaptadores-qualificacao.ts`) traduz prospects já qualificados pro formato que `aplicarQuotaGeografica()` espera — mas nenhum processo real ainda chama `aplicarQuotaGeografica()` sobre o conjunto completo de candidatos de uma rodada nacional, porque essa rodada não existe ainda. Isso é trabalho da fase seguinte (a descoberta nacional real), não desta.
- **Custo/limite Serpro:** `consultar-cnpj-serpro.ts` já limita a 25 consultas por execução e avisa que cada chamada pode ter custo pelo contrato Serpro — **desconhecido: qual é o limite de contrato/orçamento mensal real da TVB com o Serpro**, precisa confirmar com Rodrigo antes de rodar em volume nacional.
- **Frescor/volume dos dados da Receita por UF:** desconhecido se o volume de CNAE 4781400 por UF do interior é proporcional à população (plausível) ou se há distorções regionais relevantes — nenhum dado real foi puxado pra verificar.
- **Antes de disparar a rodada nacional real, a próxima tarefa precisa:** (1) decidir qual dos dois caminhos de coleta usar (ou resolver o Caminho 1 pras 27 UFs), (2) confirmar limites/custo Serpro com Rodrigo, (3) rodar por UF respeitando a cota (`aplicarQuotaGeografica`, 2 por município / 5 por capital) antes de qualquer gravação em massa, (4) nunca pular a revisão humana — `statusComercial` segue chegando no máximo em `PENDENTE_REVISAO_HUMANA`, nunca `APROVADO` automaticamente.

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
