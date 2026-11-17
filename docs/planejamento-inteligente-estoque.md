# Planejamento Inteligente de Estoque — TVB Radar

**Status:** Fase 2A (classificação em lote, tendência de demanda, grade por cor/tamanho) mergeada e em produção (PR #101, SHA `9b4c986`, deploy `dpl_hi5hnbsinp8nhXxiZeZ311NEwcX4`). Validada contra dado real de produção. Fase 1 (PR #100) e Fase 0 concluídas. **Fase 2B concluída e em produção**: excesso/distribuição (PR #105, §11) e avaliação retrospectiva (PR #106, §12) mergeados, com ajuste de regra de negócio (Drop/Best Seller/produto não classificado, pedido do Rodrigo em 2026-11-17) implementado antes do merge — ver §14 pra resultado final, validação em produção e limitações. Correção pontual pós-entrega (PR #108, §15): proteção de Drop ativo deixou de depender de venda recente, mergeada e validada. Proposta técnica de lead time normal/urgente permanece só diagnóstico, zero código, decisão pendente do Rodrigo (§13).
**Data:** 2026-11-16 (Fase 0, Fase 1, Fase 2A e Fase 2B)
**Como ler este documento:** é um documento vivo de continuidade — arquitetura, regras de negócio, decisões e pendências. Toda afirmação aqui é fato verificado em código/schema nesta data, salvo quando marcado "não verificado" ou "decisão pendente". O código muda rápido neste projeto — antes de implementar algo listado aqui, reverifique contra o código atual.

---

## 0. Fase 1 — o que foi entregue (ver seção completa no final do documento, §9)

Primeira versão funcional em `src/lib/metrics/planejamento-estoque.ts` + `src/app/dashboard/planejamento-estoque/`. **Achado importante da implementação, documentado em detalhe no §9.2**: o motor de distribuição (`VariantePorLoja`, `distribuicao-estoque.ts`) tem uma armadilha de dupla contagem pra quem reaproveitar `vendasDias30/60/90` por posição sem saber — a posição CD/Site já embute a demanda das lojas como proxy. **O motor antigo não foi alterado** (continua correto pro que ele mesmo faz); a camada nova contorna isso com uma query independente, documentada no código e abaixo.

---

## 1. Resumo executivo da Fase 0

Investigação feita por 4 agentes paralelos, somente-leitura (nenhum arquivo alterado, nenhum commit, nenhuma escrita em banco), cobrindo: (1) dados de estoque/DAPIC, (2) vendas/demanda/sazonalidade, (3) compras/notas fiscais/fornecedores, (4) arquitetura/interface. Reverificou achados de uma auditoria geral anterior (2026-11-14) e corrigiu dois pontos que haviam mudado nesses 2 dias.

**A boa notícia:** a fundação é mais madura do que a auditoria de 2 dias atrás sugeria. Já existe classificação Best Seller/Drop (`ClassificacaoProduto`), motor de recomendação de compra (`compras-inteligencia.ts`), um ciclo completo de decisão+execução de movimentação de estoque já em produção (`DecisaoMovimentacaoEstoque`, PR #78), e os dois motores de estoque (compras × distribuição) já se falam numa direção (desde 13/11).

**A notícia que importa para o desenho:** não existe série histórica de estoque (só o snapshot atual), não existe ETA confiável de chegada de produção/compra, não existe avaliação retrospectiva de decisão de compra (o código existe mas é morto — zero tela usa), e a classificação Best Seller/Drop roda no grão errado para o que o Rodrigo pediu (SKU cor+tamanho, não produto).

---

## 2. Inventário de fontes de dados

### 2.1 Estoque

| Fonte | Onde está | Coletor | Frequência | Histórico | Confiabilidade |
|---|---|---|---|---|---|
| Estoque atual por SKU+loja | `StockSnapshot` (schema) | `syncEstoque()`, `sync-runner.ts:177-213`, via `/armazenadores/produtos` | 5x/dia fixas (crons `vercel.json`) | **Nenhum — é upsert, só o estado atual** (`@@unique([storeId, cod])`) | Boa para "quanto tem agora"; zero para série temporal |
| Estoque por tamanho | `StockSnapshot.tamanho` (nullable) | mesmo acima | mesmo acima | — | Não verificado contra produção real (MCP indisponível na sessão); por código, API pode não mandar o campo |
| Posição comercial (loja vs. CD/Site) | `getPosicoesEstoque()` (`core.ts:521-599`) | — | — | — | **Fonte única confirmada**, CD+Atacado tratados como 1 posição via `displayGroup` |
| Estoque mínimo | `StockMinimumRule` (grupo+tamanho+coleção, não produto individual) | tela própria `/dashboard/estoque-minimo` (CRUD real, ADMIN/GESTAO) | manual | import único em 08/2026 (1275 regras) + manutenção manual desde então | Granularidade grossa (grupo, não produto) |
| Estoque em produção/trânsito | `ProductionOrder` | `/ordensproducao/produtos` | — | — | **Sem ETA confiável** — `dataPrevista: null, confiavel: false` explícito no próprio código (`compras-inteligencia.ts:27-32,689-704`) |
| Transferência executada | `DecisaoMovimentacaoEstoque.quantidadeExecutada` | ação manual na UI (`distribuicao-estoque/historico.tsx`) | — | desde PR #78 (11/11) | É log de decisão/auditoria — **não debita/credita StockSnapshot**, estoque real só muda quando o próximo sync trouxer o número |
| Estoque negativo | — | — | — | — | Não verificado contra produção; schema não tem constraint, sync não faz clamp |

### 2.2 Vendas e demanda

| Fonte | Onde está | Histórico real | Observação |
|---|---|---|---|
| Venda bruta por SKU/tamanho | `Sale` | **desde 2025-09-24** (`scripts/backfill-vendas.ts:15-17`) — hoje ~14 meses | Sync rotina é janela rolante, histórico veio de backfill único |
| Venda média diária / velocidade | `getVendaMediaDiariaPorCod` (`compras-inteligencia.ts:646-679`) | janela fixa **56 dias**, não configurável | **Bruta, não líquida** — zero referência a `Return` nesse cálculo |
| Sell-through | `sellthrough.ts` / `resolveSellThrough` (`estoque.ts:226-240`) | — | Trata todo produto igual, sem conceito Best Seller/Drop. Bug de "0% pra produto sem venda" já corrigido (PR #93) |
| Sazonalidade ano-contra-ano | **não existe** | — | `sazonalidadeFator` em `compras-inteligencia.ts` é parâmetro morto, default 1, nunca alimentado. Só 14 meses de histórico = sem baseline antes de set/2025 |
| Censura de demanda por ruptura | **não existe** | — | Gap confirmado: nenhum tratamento de "tamanho ficou indisponível, venda observada subestima demanda real" |
| Distribuição por tamanho | `getTamanhoBreakdown` (`estoque.ts:1507-1543`) | — | Agrega por **nome do produto**, sem `cor` — risco real de misturar cores diferentes |

### 2.3 Compras, classificação e fornecedores

| Fonte | Onde está | Observação |
|---|---|---|
| Classificação Best Seller/Drop | `ClassificacaoProduto` (schema, `@@unique(cod)`) | Grão = SKU completo (cor+tamanho), **não produto**. `resolverTipoCompraProduto`/`getClassificacaoPorProduto` existem pra resolver divergência entre tamanhos do mesmo produto, mas o problema de origem persiste |
| Tela de administração da classificação | `/dashboard/mapa-compras` + `classificacao-actions.ts` | Confirmado existir (correção ao achado antigo que dizia "não existe tela") — `classificarProdutoAction`, `setParametrosBestSellerGrupoAction`, `confirmarDecisaoCompraAction`, gated ADMIN/GESTAO |
| Decisão de compra | `DecisaoCompra` (schema) | Grava via `confirmarDecisaoCompraAction`. **`getHistoricoDecisoesCompra` que lê isso é código morto — zero chamada em qualquer tela** |
| Decisão de movimentação (transferência) | `DecisaoMovimentacaoEstoque` (schema, PR #78) | **Maduro**: ciclo PENDENTE→APROVADA→EXECUTADA/RECUSADA, com `quantidadeExecutada`/`executadoEm`/`executadoPor`, UI em `distribuicao-estoque/historico.tsx`. Confirmado aplicado em produção (migration `20261111160000` rodou com sucesso) |
| Notas fiscais/faturas de **compra** (fornecedor) | **não existe** | Conector `nota-fiscal.ts` é só lado venda. Zero menção a "Fornecedor" como entidade — é varejo/e-commerce, não tem compra-a-terceiro modelada |
| Pedido em aberto (produção) | `getPedidosEmAbertoPorCod` (`compras-inteligencia.ts:689-704`) | Só soma `ProductionOrder.quantidade` com `dataFinalizacaoProducao: null`. Sinal de quantidade, nunca de prazo |

### 2.4 Correção importante a um achado da auditoria de 2 dias atrás

`compras-inteligencia.ts` e `distribuicao-estoque.ts` **já se importam** (unidirecional: distribuição → compras, desde 13/11, pedido do Rodrigo) — `distribuicao-estoque.ts` usa `getPedidosEmAbertoPorCod` pra não mostrar necessidade de reposição como "esquecida" quando já tem produção em andamento cobrindo. O comentário de cabeçalho de `distribuicao-estoque.ts:22-24" ainda diz "nunca importa nada de compras-inteligencia.ts" — está desatualizado, vale corrigir numa limpeza futura (não bloqueia este projeto).

---

## 3. Worktree órfã — decisão pendente

`C:\Users\Dell\Projects\tvb-dashboard-planejamento-estoque` (branch `feat/planejamento-estoque-20261113`) continua existindo com trabalho real não commitado:
- `src/lib/metrics/grade-tamanhos.ts` (novo, inédito em main): `decomporQuantidadePorTamanho()` — reparte uma quantidade de compra já calculada no nível de produto entre os tamanhos reais, proporcional à venda recente.
- Campo `produto String?` em `StockMinimumRule`, ampliando a chave única pra `[storeId, grupo, produto, tamanho, colecao]` — permite mínimo por produto individual, não só por grupo.

**Status confirmado agora**: a branch está **24 commits atrás de main**, incluindo os PRs #78/#87/#89/#91 que reescreveram `distribuicao-estoque.ts` por completo (1884 linhas em main vs. 1708 na worktree). Reaproveitar exige reconciliação manual linha a linha, não merge direto.

**Decisão pendente para o Rodrigo**: reconciliar esse trabalho (provavelmente mais rápido que refazer do zero, já que a lógica de decomposição por tamanho é exatamente o que o Módulo 3 do briefing pede) ou abandonar e reimplementar direto sobre o main atual. Recomendo reconciliar — ver Fase 2 abaixo.

---

## 4. Arquitetura proposta

### 4.1 Princípio geral: aditivo, sem sistema paralelo

Confirmado pelo agente de arquitetura: o padrão de módulo deste projeto é `page.tsx` (busca sessão+permissão+filtros, chama `src/lib/metrics/*.ts`) + `actions.ts` (mutações server-side, sempre re-checando role) + componentes client que só recebem dado já calculado como prop. A nova área deve seguir exatamente esse padrão, reusando `StatTile`, `FilterBar`, `CollapsibleFilters`, `DimensionToggle`, `TopBarChart`, `MetricBarChart`, `TopProdutosTable` — nenhum desses precisa ser reinventado.

### 4.2 Modelo de dados — o que reaproveitar, o que estender, o que criar

**Reaproveitar sem mudança:**
- `Sale`, `StockSnapshot`, `Return`, `ProductionOrder` — dado bruto por tamanho já existe via `cod`.
- `ClassificacaoProduto` — mecanismo de Best Seller/Drop já existe, só precisa de ajuste de grão (ver 4.3).
- `CoberturaMeta.leadTimeDias` — lead time por grupo já existe.
- `getPosicoesEstoque()` — nunca reimplementar "o que é uma posição comercial válida".
- `DecisaoMovimentacaoEstoque` como **referência de design** para qualquer novo ciclo de decisão (já tem o padrão certo: sugerido → aprovado → executado → auditável).

**Estender (schema change aditivo, precisa de PR + aprovação explícita do Rodrigo antes do merge — regra já estabelecida no projeto):**
- `StockMinimumRule`: adicionar `produto String?` (reconciliando o trabalho da worktree órfã) pra permitir mínimo por produto individual, mantendo grupo como fallback quando `produto` for null.
- `ClassificacaoProduto`: **decisão pendente** — manter grão por `cod` (como hoje) ou subir pra produto+cor. Ver 4.3.

**Criar (tabelas novas, aditivas):**
1. **Avaliação retrospectiva de decisão de compra** — hoje `DecisaoCompra` grava a decisão mas nada compara "aprovado" com "o que aconteceu depois". Proposta: ou (a) uma tabela nova `DecisaoCompraAvaliacao` gravada por job periódico (snapshot do resultado N dias depois), ou (b) um cálculo on-demand na tela que cruza `DecisaoCompra` + `Sale`/`StockSnapshot` numa data futura, sem persistir nada novo. **Recomendo (b) pra começar** — zero schema novo, zero job periódico pra manter, e já responde a pergunta do Módulo 7. Evolui pra (a) só se o cálculo on-demand ficar caro.
2. **Snapshot diário de estoque** (decisão pendente, ver 4.4) — só necessário se decidirmos medir "sobra recorrente ao longo de ciclos" ou "idade de estoque" de forma histórica real, já que `StockSnapshot` hoje não guarda série temporal.

### 4.3 Decisão pendente — grão da classificação Best Seller/Drop

Hoje `ClassificacaoProduto` é por `cod` (SKU completo, cor+tamanho). Isso significa que um tamanho de um produto pode ser classificado Best Seller e outro tamanho do MESMO produto Drop — o código já tem `resolverTipoCompraProduto` pra lidar com essa divergência quando ela aparece, mas não impede que ela aconteça.

**Preciso que o Rodrigo decida**: a classificação deveria subir pra nível de produto+cor (um tamanho não deveria poder divergir do resto do mesmo produto/cor, salvo decisão deliberada)? Isso é uma migration de dado real (reclassificar o que já existe), não só schema — por isso fica como decisão explícita antes de eu tocar nisso.

### 4.4 Decisão pendente — vale criar série histórica de estoque?

Para os seguintes pedidos do briefing, falta histórico que hoje não existe:
- Módulo 6 (Drops): "dias em estoque", "projeção de estoque restante" — precisa saber o estoque em datas passadas, não só agora.
- Sobra recorrente de tamanhos menores "ao longo de ciclos de compra" — mesma necessidade.

Três caminhos possíveis, do mais barato ao mais caro:
1. **Aproximar usando Sale histórica** (estoque em T = estoque atual + vendas desde T) — não precisa de tabela nova, mas é aproximação (não considera entradas de produção/transferência entre T e agora com precisão).
2. **Snapshot diário amostrado** — uma tabela nova que grava 1 linha por produto+loja+dia (ou só fim de semana/mês, pra reduzir volume), alimentada por um job que lê `StockSnapshot` periodicamente e persiste a foto. Custo de armazenamento crescente, mas dado real.
3. **Pedir ao DAPIC se existe histórico de estoque que o Radar nunca explorou** — não investigado nesta Fase 0, vale uma pergunta rápida ao conector antes de assumir que não existe.

**Recomendo não decidir isso agora** — começar a Fase 1/2 com a opção 1 (aproximação via Sale, zero schema novo) e só evoluir pra snapshot diário se a aproximação se mostrar insuficiente na prática.

---

## 5. Regras de negócio da TVB (registradas, para não precisar redescobrir)

- Lead time de compra centralizada: ~60 dias. Lead time de reposição urgente: ~2 dias. Hoje só existe `CoberturaMeta.leadTimeDias` por grupo — não existe distinção formal "normal vs. urgente" no schema, isso precisa ser modelado (provavelmente como um segundo campo ou um enum de tipo de reposição).
- Grade de tamanhos: 30 a 48. Núcleo de maior peso esperado: 38, 40, 42, 44 (`TAMANHOS_NUCLEO`, já existe em `distribuicao-estoque.ts`, usado só pra destacar/priorizar, nunca pra filtrar).
- Tamanhos menores (30-36) merecem atenção por sobra recorrente — gap confirmado, nenhum motor detecta isso hoje.
- Best-seller: análise individual por produto, considerando reposição contínua — sell-through convencional NÃO deve ser usado isolado (distorce com entrada de reposição). Drop: análise por grupo, ciclo ~2 meses.
- Recomendações nunca viram compra automática — sempre aprovação humana. Isso já é o padrão em `DecisaoCompra`/`DecisaoMovimentacaoEstoque` (nunca grava `APROVADO` sozinho).
- Não contar transferência como venda, não contar devolução como entrada — regras já respeitadas pelos modelos atuais (`Sale`/`Return`/`DecisaoMovimentacaoEstoque` são conceitualmente separados).

---

## 6. Roadmap (fases do Rodrigo, com nota de arquitetura por fase)

### Fase 0 — Diagnóstico técnico — **concluída** (este documento)

### Fase 1 — Estoque atual
Entregável: tela com estoque por produto/loja/tamanho/CD + histórico de vendas + excesso/ruptura — usando só o que já existe (`getPosicoesEstoque`, `StockSnapshot`, `Sale`). Zero schema novo necessário nesta fase. Risco baixo.

### Fase 2 — Inteligência de demanda
Entregável: classificação (reusar `ClassificacaoProduto`, resolvendo 4.3 antes), cobertura considerando reposição (resolver o gap "sell-through tradicional distorce com best-seller"), grade ideal por produto/grupo (reconciliar a worktree órfã — `decomporQuantidadePorTamanho`). Precisa de decisão 4.3 antes de começar.

### Fase 3 — Planejamento de compras
Entregável: estoque mínimo (estender `StockMinimumRule` com `produto`, reconciliando worktree), ponto de reposição, recomendação com aprovação/edição/rejeição (padrão já existe em `DecisaoCompra`/`confirmarDecisaoCompraAction`, só falta expandir os campos retornados). Precisa de PR de migration + aprovação do Rodrigo.

### Fase 4 — Distribuição
Entregável: em grande parte **já existe** (`distribuicao-estoque.ts` + `DecisaoMovimentacaoEstoque`) — esta fase é principalmente de integração visual com o módulo novo, não construção do zero.

### Fase 5 — Aprendizado e otimização
Entregável: avaliação retrospectiva (resolver 4.4 pro histórico, implementar comparação on-demand descrita em 4.2), alertas inteligentes.

---

## 7. Pontos de decisão pendentes (resumo, para o Rodrigo)

1. **Onde a nova área vive na navegação** — já existem 10 abas de estoque com overlap conceitual documentado entre elas. 11ª aba isolada, ou integrar a algo existente/futuro Painel de Decisões? (seção 4.1 do agente de arquitetura)
2. **Grão da classificação Best Seller/Drop** — subir de `cod` pra produto+cor, ou manter como está? (seção 4.3)
3. **Série histórica de estoque** — vale o custo de uma tabela nova de snapshot diário, ou começar com aproximação via Sale? (seção 4.4, recomendação: começar com aproximação)
4. **Worktree órfã** — reconciliar (recomendado) ou abandonar e reimplementar?
5. **Lead time urgente vs. normal** — como modelar formalmente essa distinção (hoje só existe lead time único por grupo).

Nenhuma dessas decisões bloqueia o início da Fase 1 (que não depende de nenhuma delas) — só bloqueiam Fase 2 em diante.

---

## 8. O que falta pra próxima fase

Fase 1 pode começar assim que o Rodrigo confirmar o ponto de decisão #1 (onde a área vive na navegação) — todo o resto dessa fase usa dado e código já existentes, sem schema novo.

---

## 9. Fase 1 — entrega (2026-11-16)

PR `feat-planejamento-estoque-fase1-20261116` (#100). Sem schema novo, sem migration.

### 9.1 O que foi implementado

- `src/lib/metrics/planejamento-estoque.ts`: `getProdutosPlanejamento(filtro)` (visão agregada por produto) e `getProdutoPlanejamentoDetalhe(produto, filtro)` (detalhe: por cor→tamanho, por loja/CD, evolução de vendas, recomendação do motor quando classificado).
- `src/app/dashboard/planejamento-estoque/`: página, filtros (grupo/tamanho/busca), tabela principal, painel de detalhe. Segue o padrão `page.tsx`+componentes server já estabelecido no projeto.
- Nova chave de aba `planejamento-estoque`, dentro do grupo `estoque` já existente (ponto de decisão #1 ainda **não resolvido** — só adiei pra poder entregar algo navegável; mover é 1 linha em `tabs.ts`).
- 12 testes novos em `src/lib/metrics/__tests__/planejamentoEstoque.test.ts`.

### 9.2 Achado crítico da implementação — dupla contagem no reaproveitamento de `VariantePorLoja`

**Não é um bug no motor de distribuição** (`distribuicao-estoque.ts`) — é um detalhe de design que vira armadilha pra qualquer consumidor novo que não saiba disso.

`VariantePorLoja.vendasDias30/60/90`, para a posição `cd_site`, já é `vendasEfetivasCdSite(vendaDiretaCdSite, demandaLojas)` = venda direta do site **mais** a demanda agregada das lojas que esse CD abastece (`distribuicao-estoque.ts:113-129`) — uma correção deliberada (pedido do Rodrigo, 2026-11-13) pra diagnóstico de giro do CD não ficar cego ao que sai dele via abastecimento interno.

Se um consumidor novo somar `vendasDias30` de **todas** as posições de um produto (lojas + CD/Site) pra chegar numa "venda total da empresa", ele conta a demanda das lojas **duas vezes**: uma vez na própria linha da loja, outra vez embutida na linha do CD/Site. `estoqueAtual` por posição **não** tem esse problema (é soma direta, sem proxy) — só `vendasDias30/60/90`/`velocidadeDiaria`/`coberturaDias` carregam a correção.

**Decisão tomada nesta entrega**: não mexi em `distribuicao-estoque.ts` (ele está certo pro que ele mesmo faz — diagnosticar a posição CD/Site isoladamente). Em vez disso, `getProdutosPlanejamento` **nunca** soma `porLoja[].vendasDias30/60/90` — vendas por produto vêm de uma query direta e independente (`prisma.sale.groupBy({by:["produto"], ...})`), bruta, sem a correção de proxy. `estoqueTotal/estoqueCD/estoqueLojas` continuam vindo da soma de `porLoja[].estoqueAtual` (seguro, sem proxy). Documentado no código (`planejamento-estoque.ts`, comentário acima do loop de agregação) e testado explicitamente (`"NUNCA soma porLoja[].vendasDias30..."`, `planejamentoEstoque.test.ts`).

**Recomendação pra quem for mexer em `distribuicao-estoque.ts` ou criar outro consumidor de `VariantePorLoja` no futuro**: se precisar de "venda real da empresa" (não "giro aparente de uma posição"), não some `vendasDias30` entre posições — ou peça uma venda bruta independente (como fiz aqui), ou exponha a venda direta (pré-correção) como um campo separado em `VariantePorLoja` se isso virar uma necessidade recorrente (não fiz essa mudança estrutural nesta entrega — era mais risco que o Fase 1 pedia).

### 9.3 Validação de reconciliação (pedido explícito do Rodrigo)

3 testes dedicados em `planejamentoEstoque.test.ts` (cenário com 2 cores × 2 tamanhos × 2 posições = 8 combinações):
- Soma do detalhe por cor→tamanho == `estoqueTotal` da lista principal.
- Soma do detalhe por loja/CD == `estoqueTotal`, e `estoqueCD`+`estoqueLojas` reconcilia exatamente com o detalhe por posição.
- Cada cor soma certo isoladamente (nenhum SKU vaza pra cor errada).

Todos os 3 passam. Nenhuma inconsistência de reconciliação foi encontrada na lógica nova — o único risco real identificado foi o da seção 9.2 (já contornado e testado, não uma inconsistência não resolvida).

### 9.4 Validação contra produção real — concluída

Executada após o merge (script temporário somente-leitura, removido num commit de limpeza em seguida). Dado real, 2026-11-16:

- 360 produtos retornados. Por situação: 134 cobertura excessiva, 76 equilibrado, 74 sem dado, 62 sem movimentação, 11 ruptura, 3 cobertura crítica.
- Por classificação: 354 não classificados, 5 Drop, 1 Best Seller — bate com o achado da Fase 0 de que a classificação ainda cobre uma fração pequena do catálogo.
- **0 produtos com estoque/venda negativo.**
- 13 produtos com quantidade em trânsito > 0 — **todos** com `transitoConfiavel=false`, confirmando que a regra "nunca tratar trânsito como certeza" se sustenta com dado real, não só no teste sintético.
- 14 produtos com `necessidadeReposicao=true` (11 ruptura + 3 cobertura crítica — soma exata).
- Detalhe testado de ponta a ponta com um produto real em ruptura ("Boné 5 Panel Dry Black"): breakdown por loja mostrou ruptura real em 2 posições e "sem_dado" nas outras 2 (consistente — produto sem estoque E sem venda recente nelas), evolução de vendas trouxe histórico real de `Sale`.

Nenhuma inconsistência encontrada contra dado real de produção.

### 9.5 Limitações que seguem existindo (não escondidas, expostas na UI)

- Sem série histórica de estoque — "dias em estoque"/"idade" não é mostrado como fato.
- `ProductionOrder` sem ETA confiável — trânsito sempre separado do disponível, `transitoConfiavel` sempre `false` hoje.
- Histórico de venda curto — "dados insuficientes" explícito quando < 14 dias.
- Classificação ainda por `cod`, não produto+cor (ponto de decisão #2, não resolvido nesta fase) — `getProdutosPlanejamento` expõe isso como `MISTO` quando cods do mesmo produto divergem, em vez de esconder a divergência.

---

## 10. Fase 2A — inteligência de demanda, grade e classificação em lote (2026-11-16)

PR `feat-planejamento-estoque-fase2a-20261116`. Sem schema novo, sem migration. Entrega incremental — itens 5 (distribuição/excesso) e 6 (avaliação retrospectiva) do pedido de Fase 2 ficam para a próxima entrega (Fase 2B), conforme instrução explícita do Rodrigo de não tentar tudo de uma vez.

### 10.1 Causa raiz real da baixa cobertura de classificação (354/360 não classificados)

**Não é um problema de grão/schema** (zero `MISTO` detectado em produção antes desta entrega — nenhuma evidência de conflito entre cods do mesmo produto). A causa real, confirmada lendo `getFilaRevisaoClassificacao` e `ClassificarProdutoForm`: a fila e o formulário de classificação são **por `cod`** (SKU individual, cor+tamanho) — classificar 1 produto com várias cores/tamanhos exigia 1 submit por SKU. Fix: `classificarProdutoEmLoteAction` (nova, em `mapa-compras/classificacao-actions.ts`, reaproveitando `upsertClassificacaoProduto` já existente) classifica todos os cods de um produto de uma vez, com a mesma decisão — ainda 100% manual, só reduz o atrito. Exposta na UI do Planejamento de Estoque (painel de detalhe, só quando o produto não está classificado ou está `MISTO`).

A pergunta de grão (produto+cor) continua em aberto (decisão pendente #2 da Fase 0) — não resolvida aqui porque não havia evidência de necessidade real, e seria uma migration de dado sem benefício demonstrado ainda.

**Correção de segurança aplicada antes do merge** (revisão pontual pedida pelo Rodrigo): a primeira versão de `classificarProdutoEmLoteAction` confiava nos `cod` recebidos dos campos ocultos do formulário sem checar se de fato pertenciam ao `produto`/`grupo` informados — um campo oculto adulterado no cliente (DevTools, requisição manual) classificaria um SKU de **outro produto** com a decisão errada. Corrigido: a action agora confere cada `cod` contra a fonte real (`Sale`/`StockSnapshot`, mesmo universo de `getFilaRevisaoClassificacao`), descarta silenciosamente qualquer `cod` que não pertença ao produto submetido (nunca grava nada para ele), deduplica `cod` repetido, e sempre grava `grupo` vindo da fonte real — nunca do formulário. Se **nenhum** `cod` submetido for válido, a ação não grava nada (não deixa o produto com classificação parcial/errada). 8 testes novos cobrindo especificamente isso (`src/app/dashboard/mapa-compras/__tests__/classificarProdutoEmLote.test.ts`): cod de outro produto, cod inexistente, dedup, grupo da fonte real, zero-grava quando tudo é inválido, mesma decisão aplicada a todos os cods válidos, permissão ADMIN/GESTAO, e histórico preservado quando o cod já tinha classificação diferente.

### 10.2 Inteligência de demanda

- `Tendencia` (`crescimento`/`estavel`/`desaceleracao`/`sem_dado`): compara `vendasDias30` contra a janela anterior de 30 dias (`vendasDias60 - vendasDias30`), nunca ano-contra-ano (Fase 0 confirmou histórico curto demais pra isso). Margem de 20% antes de marcar tendência, pra não reagir a ruído.
- `demandaPossivelmenteMascarada`: aviso booleano (não um número calculado) quando `situacao` é `ruptura`/`cobertura_critica`. Não existe série histórica de estoque (Fase 0 §2.1), então não dá pra saber QUANDO a ruptura começou — qualquer "demanda estimada sem a ruptura" seria fabricado. A honestidade aqui é o próprio aviso, não um número.
- Venda por loja no detalhe (`vendasDias30`/`vendasDias90` em `LojaDetalhe`) — usa o valor já calculado por posição em `VariantePorLoja`, nunca somado entre posições (mesma cautela de dupla contagem do CD/Site documentada na Fase 1).

### 10.3 Inconsistência real encontrada e corrigida na própria camada nova (Fase 1)

Ao estender `LojaDetalhe`, encontrei que `getProdutoPlanejamentoDetalhe` (Fase 1) mantinha `coberturaDias`/`diagnostico` do **primeiro cod visto** por loja, só somando `estoqueAtual` dos demais cods do mesmo produto — pra produto com várias cores/tamanhos, a cobertura/diagnóstico exibidos no detalhe vinham de 1 SKU arbitrário, não do agregado real daquela loja. Corrigido: agora acumula `estoqueAtual`+`vendasDias30`+`vendasDias90` de todos os cods por loja e só então recalcula com `diagnosticarVariante` (mesma função pura do resto do módulo). Testado explicitamente (`"agrega vendasDias30/90 de TODOS os cods..."`, `planejamentoEstoque.test.ts`). Reportado aqui por instrução direta do Rodrigo de não esconder limitação encontrada.

### 10.4 Planejamento de grade — divergência deliberada da worktree órfã

A worktree órfã (`tvb-dashboard-planejamento-estoque`) decompunha quantidade por tamanho usando `getTamanhoBreakdown` (`estoque.ts`), que agrega por **nome do produto sem cor** — exatamente o risco de misturar cores já documentado na Fase 0 (§2.2) e que a Fase 1 deste módulo evitou de propósito. Não reaproveitei esse pedaço: `src/lib/metrics/planejamento-grade.ts` decompõe em **duas passadas** (produto→cor, depois cor→tamanho), cada uma pesada pela venda real daquela cor/tamanho especificamente, via query direta e independente (mesma cautela de dupla contagem do CD/Site). `getTamanhoBreakdown` continua como estava — não foi alterado, é usado em outro lugar do Radar (Mapa de Compras) e corrigi-lo silenciosamente estava fora do escopo desta entrega.

`decomporProporcional` (função pura, `planejamento-grade.ts`) reaproveita o algoritmo de maior resto (largest remainder) da worktree, generalizado pra qualquer dimensão — testado isoladamente (5 testes) e via `getRecomendacaoGradeProduto` (4 testes, incluindo fechamento exato cor↔total e tamanho↔cor).

### 10.5 Planejamento de compras (parcial)

`getRecomendacaoGradeProduto` agrega `getRecomendacoesBestSeller`/`getRecomendacoesDrop` (motor já existente, por cod) pro nível de produto e decompõe em grade — reaproveita 100% o cálculo de "quanto comprar", só redistribui. Surfaced no painel de detalhe do Planejamento de Estoque. **Ainda não incluído nesta entrega**: aprovação/edição/rejeição da recomendação (isso já existe em `mapa-compras` via `confirmarDecisaoCompraAction` — decisão de não duplicar esse fluxo aqui, só mostrar a sugestão; ligar os dois fica pra Fase 2B), distinção formal lead time urgente (2 dias) vs. normal (60 dias) — ainda só existe `CoberturaMeta.leadTimeDias` único por grupo.

### 10.6 Pendente para Fase 2B

- Gestão de excesso/distribuição: surfacing de `distribuicao-estoque`/`DecisaoMovimentacaoEstoque` no painel de detalhe (motor já maduro, só falta integrar visualmente).
- Avaliação de decisões: reviver `getHistoricoDecisoesCompra` (hoje código morto, zero tela usa) + construir comparação on-demand (recomendado vs. realizado), sem schema novo.
- Lead time urgente vs. normal — precisa de schema change (campo novo em `CoberturaMeta` ou modelo de fornecedor/modalidade), fica como PR separado com aprovação explícita do Rodrigo antes do merge, por tocar schema.

### 10.7 Correção de segurança (revisão pontual antes do merge) e validação final em produção

**Vulnerabilidade real encontrada e corrigida antes do merge** (pedido explícito do Rodrigo de revisão pontual): a primeira versão de `classificarProdutoEmLoteAction` confiava nos `cod` recebidos dos campos ocultos do formulário sem checar se pertenciam ao `produto`/`grupo` informados — um campo oculto adulterado no cliente classificaria um SKU de **outro produto** com a decisão errada. Corrigido: a action agora confere cada `cod` contra a fonte real (`Sale`/`StockSnapshot`), descarta silenciosamente qualquer `cod` que não pertença ao produto submetido, deduplica, e grava `grupo` sempre vindo da fonte real — nunca do formulário. Se nenhum `cod` for válido, nada é gravado. `requireGestao()` preservado. 8 testes novos (`src/app/dashboard/mapa-compras/__tests__/classificarProdutoEmLote.test.ts`) cobrindo especificamente: cod de outro produto, cod inexistente, dedup, grupo da fonte real, zero-grava quando tudo inválido, mesma decisão em todos os cods válidos, permissão, histórico preservado.

**Merge:** PR #101 → `main` SHA `9b4c986` (2026-11-16T18:30Z aprox.). **Deploy de produção:** `dpl_hi5hnbsinp8nhXxiZeZ311NEwcX4`, status `Ready`, confirmado via `vercel inspect`.

**Validação final contra produção real** (script temporário somente-leitura, removido em seguida — commit `f4acf25`):
- 360 produtos retornados, sem erro.
- Tendência: 122 crescimento, ~30 estável, 154 sem dado, ~54 desaceleração (pequena variação entre duas execuções minutos apart — dado real mudando ao vivo, não bug).
- `demandaPossivelmenteMascarada=true` em 14 produtos — **100% deles em ruptura/cobertura_critica**, 0 inconsistência (nenhum produto em risco sem a flag).
- 6 produtos classificados (Best Seller/Drop) hoje em produção — **todos com quantidade sugerida 0 ou nula** (nenhum gerou recomendação de grade com quantidade real ainda). Isso é esperado dado o estágio atual de adoção da classificação (Fase 0/2A resolveram o *mecanismo*, não substituem a decisão humana de classificar o catálogo) — **não foi possível validar a decomposição de grade contra uma quantidade real positiva em produção nesta rodada**; a cobertura de "fecha exatamente com o total" vem dos 4 testes unitários com dado sintético positivo (`recomendacaoGradeProduto.test.ts`). Revisitar quando houver mais produtos classificados com sugestão > 0.
- **Detalhe por produto validado com dado real multi-SKU**: "Calça Confort Black" (10 cods, `estoqueTotal=23`) — soma por cor→tamanho fechou em 23, soma por loja fechou em 23. Confirma a correção da seção 10.3 (agregação por loja) funcionando com produto real do catálogo, não só cenário sintético.
- **Limitação declarada**: a validação "a página abre" foi feita no nível de função (mesmas queries que `page.tsx` chama), não via browser com sessão de produção real — não há credencial de produção disponível nem foi solicitada/usada para isso. Como o build local (`npm run build`) já passou e as funções chamadas pela página rodaram sem erro contra produção com os mesmos dados que a página usaria, é uma prova equivalente para o que a página faz (ela só mapeia essas estruturas, já testado nos testes de componente/tipo) — mas não é literalmente um screenshot da página renderizada.
- **Teste de classificação em lote em produção**: **não executado** deliberadamente. Submeter o formulário real gravaria uma classificação real em produção sem uma autorização específica para aquele SKU/produto — a cobertura de corretude e segurança da action vem dos 8 testes unitários (que simulam exatamente os cenários de adulteração/erro), não de uma escrita real de teste no banco de produção.

---

## 11. Fase 2B — excesso e distribuição (2026-11-16, PR #105 — **mergeado e em produção**, ver §14)

Agente A da Fase 2B (ver §10.6 — pendente desta fase: "surfacing de distribuicao-estoque/DecisaoMovimentacaoEstoque no painel de detalhe, motor já maduro, só falta integrar visualmente"). Branch `feat-planejamento-estoque-fase2b-distribuicao-20261116`. **Sem schema novo, sem migration.** Conteúdo original do PR (antes dos ajustes de regra pedidos pelo Rodrigo — ver §14) preservado abaixo; status final e resultado da validação em produção estão em §14.

### 11.1 O que foi implementado

- `src/lib/metrics/planejamento-distribuicao.ts` (novo): `getExcessosEDistribuicao(filtro)` — visão por produto com `excessoCD`, `estoqueCDPermanece`, `excessoLojas`, `rupturaLojas`, `rupturaComExcessoDisponivel` (sinal-chave: loja em risco de ruptura enquanto outra posição do mesmo produto tem excesso) e `oportunidades` (sugestões de transferência já calculadas pelo motor, reaproveitadas sem recálculo). `getProdutoExcessoDistribuicao(produto, filtro)` — atalho pra 1 produto (reaproveita o mesmo resultado cacheado). `getDecisoesMovimentacaoPorStatus(filtro)` — extensão mínima de `getHistoricoMovimentacoes` (já existente) pra buscar as 4 categorias de status de uma vez e, opcionalmente, filtrar por produto (pós-leitura, sem mudar a tabela).
- Tela: nova seção "Excesso e distribuição entre unidades" dentro do painel de detalhe já existente do Planejamento de Estoque (`src/app/dashboard/planejamento-estoque/excesso-distribuicao.tsx`, renderizada por `produto-detalhe.tsx`) — **decisão de arquitetura**: não criou 11ª aba isolada nem duplicou o fluxo de Aprovar/Recusar (que já existe em `distribuicao-estoque/actions.ts`); a seção é só leitura, com um link que abre a aba Movimentações da Distribuição de Estoque já filtrada por este produto (`busca=<produto>`) pra quem for decidir/executar de fato.
- Mostrada só quando o produto aberto tem classificação Best Seller/Drop **e** há algum sinal real (excesso/ruptura/oportunidade) — ver `page.tsx`/`produto-detalhe.tsx`. **Decisão que precisa de validação do Rodrigo**: essa restrição a Best Seller/Drop foi literal ao pedido desta fase, mas o motor de distribuição não depende de classificação pra funcionar — pode fazer sentido mostrar também pra produtos MISTO/NAO_CLASSIFICADO.
- 16 testes novos em `src/lib/metrics/__tests__/planejamentoDistribuicao.test.ts` (ver §11.3).

### 11.2 Único ponto tocado em `distribuicao-estoque.ts` (fora do arquivo novo)

`construirOrigem` (função pura, calcula `disponivel`/`margemSeguranca` = a mesma fórmula que `prepararOrigens` usa pra decidir quem pode doar) **passou a ser exportada** — zero mudança de lógica, só adicionado `export`. Motivo: `planejamento-distribuicao.ts` precisa do número "quanto desta posição deve permanecer reservado (mínimo + margem)" pra responder "o que deve ficar no CD" (pedido do briefing), e essa é literalmente a mesma fórmula já madura do motor — reexpor em vez de duplicar a conta (StockMinimumRule + 7 dias × 0.5 de giro) em outro arquivo.

### 11.3 Regras de negócio confirmadas/testadas nesta fase

1. **Dupla contagem de demanda (CD/Site)**: `planejamento-distribuicao.ts` nunca soma `vendasDias30/60/90` entre posições — só usa `estoqueAtual` (soma direta, segura) e `velocidadeDiaria`/`diagnostico` de **cada posição isoladamente** via `construirOrigem`. Teste dedicado prova que dobrar a venda de uma loja não muda `excessoCD` nem `estoqueCDPermanece` (que dependem só da própria linha do CD).
2. **Nunca gera ruptura na origem**: teste com origem `estoqueAtual=95, estoqueMinimo=90, velocidadeDiaria=2` (margem=7) — a conta ingênua diria 5 un. disponíveis, mas `construirOrigem` (reaproveitado, não reimplementado) reserva mínimo+margem (97 > 95) e zera: nada é oferecido. Segundo teste confirma que, quando sobra de verdade, só a sobra REAL (23, não a conta ingênua de 30) é exposta como excesso.
3. **Disponível vs. trânsito**: `planejamento-distribuicao.ts` nunca chama `getPedidosEmAbertoPorCod`/toca `ProductionOrder` — teste prova isso diretamente (mock configurado pra lançar erro se chamado, nunca é). "Disponível" é sempre e só estoque atual já reservado pelo mínimo+margem, nunca produção em aberto (que já é sempre `confiavel: false`, documentado desde a Fase 0).
4. **Reconciliação**: teste prova que a soma do que sai das origens (`quantidadeSugerida`) é exatamente igual à soma do que entra nos destinos (`estoqueDestinoDepois - estoqueDestinoAntes`), e que os objetos de oportunidade são passados sem mutação — esta camada só agrupa/filtra, nunca recalcula quantidade.
5. **Regra nova desta fase — Drop em ciclo ativo nunca é tratado como excesso**: o motor já protegia Best Seller de recolhimento (regra existente), mas não tinha proteção equivalente pra Drop nas direções CD↔loja/loja↔loja. Esta fase adiciona um FILTRO (não uma mudança no motor) em `getExcessosEDistribuicao`: oportunidade cujo SKU de origem é Drop, ainda dentro do ciclo (`dataEncerramentoPrevista` no futuro ou nula, status comercial não encerrado/descontinuado) **e** com venda real nos últimos 90 dias (`vendasOrigem90 > 0` — ou seja, "excesso" por estoque alto relativo à própria venda, não estoque morto) é suprimida da lista exposta por esta tela, nunca da tabela de Distribuição de Estoque em si (`dropsCicloAtivoProtegidos` conta quantas, nunca esconde silenciosamente). Testado: suprime quando ativo+vendendo, não suprime quando ciclo já encerrado, não suprime quando `estoque_parado` (zero venda — verdadeiramente morto, não "ainda em ciclo"). **Decisão que precisa de validação do Rodrigo**: se a mesma régua deveria valer formalmente pra Best Seller nas 3 direções (hoje só protegido no recolhimento, pela regra já existente do motor).

### 11.4 Validação contra produção — pendente do merge

Script `scripts/validar-planejamento-distribuicao-fase2b-temp.ts` + workflow `validar-planejamento-distribuicao-fase2b-temp.yml` (workflow_dispatch, somente leitura) preparados e incluídos no PR, seguindo o mesmo padrão das fases anteriores — **não executados por este agente**: o workflow só pode ser disparado depois que o PR for mergeado em main (GitHub só lista workflows que já existem na branch default). Mergear primeiro, disparar manualmente depois.

### 11.5 Resultado das verificações locais

`npx tsc --noEmit`: sem erros. `npx eslint` nos arquivos tocados: 0 erros (1 warning cosmético, variável `_a` deliberadamente não usada num mock). `npx vitest run` (suíte completa): **690 testes passando** (674 anteriores + 16 novos), 0 regressão. `npm run build`: sucesso (rota `/dashboard/planejamento-estoque` compilada normalmente, sem rota nova — reaproveitou a existente).

---

## 12. Fase 2B — avaliação retrospectiva de decisões de compra (2026-11-16, PR #106 — **mergeado e em produção**, ver §14)

Agente B da Fase 2B. Branch `feat-planejamento-estoque-fase2b-avaliacao-20261116`, PR #106. Trabalhou em worktree isolada (`tvb-dashboard-avaliacao-compras`), sem tocar nos arquivos do Agente A. **Sem schema novo, sem migration, sem tabela/job nova** — cálculo 100% on-demand, exatamente a opção já recomendada no §4.2 desde a Fase 0. Status final e resultado da validação em produção estão em §14.

### 12.1 O que foi implementado

- `src/lib/metrics/planejamento-avaliacao.ts` (novo): reaproveita `getHistoricoDecisoesCompra` (`compras-inteligencia.ts`, intocado) como **única leitura** de `DecisaoCompra` — nunca duplica esse acesso Prisma. Cruza por `cod` (quando a decisão tem) ou por `grupo` (fallback, quando a decisão foi registrada só agregada).
- `avaliarDecisaoCompra(decisao, dadosCruzados, agora)` — **núcleo puro, sem Prisma**, testável com dado sintético (mesma convenção de `diagnosticarVariante`/`vendasEfetivasCdSite`). Classifica `avaliabilidade: "SEM_DADOS" | "PARCIAL" | "COMPLETA"` (critérios exatos abaixo, §12.2) e só preenche `diagnosticoPosDecisao`/`indicioRupturaPosDecisao`/`indicioExcessoRemanescente` quando `COMPLETA`, reaproveitando `diagnosticarVariante` (`distribuicao-estoque.ts`) sem reinventar régua.
- `getAvaliacaoDecisaoCompra(decisaoId)` e `getAvaliacaoDecisoesPorProdutoGrupoPeriodo(filtro)` — camada de dado, registradas no barrel.
- Tela: seção colapsável "Avaliação de decisões de compra" dentro de `/dashboard/mapa-compras/page.tsx` (mesmo padrão visual da seção "Fila de revisão & Alertas" já existente) — decisão de não criar rota/aba nova, já que `DecisaoCompra` já é lida/escrita nessa mesma página.
- 10 testes novos em `src/lib/metrics/__tests__/planejamentoAvaliacao.test.ts`, incluindo um nomeado literalmente `"nunca inventa resultado histórico quando não há dados suficientes (PARCIAL preserva null em vez de estimar)"`.

### 12.2 Critérios de avaliabilidade (exatos, do código)

- **SEM_DADOS**: zero `StockSnapshot` E zero `Sale` cruzável no período pós-decisão (por `cod` ou por `grupo`, conforme disponível) — nenhum número é calculado, tudo fica `null`.
- **PARCIAL**, dois casos: (a) decisão registrada **só por grupo** (sem `cod`) — **nunca** vira COMPLETA, por mais tempo que passe, porque a imprecisão do join por grupo (mistura outros produtos do mesmo grupo) não desaparece com o tempo; (b) decisão **com `cod`** mas a janela de 90 dias pós-`decididoEm` ainda não decorreu inteira — reporta só `vendasPosDecisaoAteAgora`/`estoqueAtual` (o que já pôde ser calculado honestamente), nunca preenche `vendasPosDecisao30/60/90` com soma parcial disfarçada de janela cheia.
- **COMPLETA**: `cod` presente + janela de 90 dias cheia decorrida + dado real disponível — único caso em que `diagnosticoPosDecisao` é calculado, via `diagnosticarVariante` com `tipoPosicao="loja"` (limiar mais conservador, mesma escolha de `planejamento-estoque.ts`).

### 12.3 Limitações reais declaradas (não escondidas)

- **Sem FK entre `DecisaoCompra` e `Sale`/`StockSnapshot`/`ProductionOrder`** — o cruzamento é sempre um join implícito por `cod` ou `grupo`, nunca uma relação formal. Decisão só-grupo mistura dado de outros produtos do grupo — por isso nunca COMPLETA.
- **Sem série histórica de estoque** (mesma limitação da Fase 0/1) — `estoqueAtual` é sempre o snapshot de HOJE, nunca "o estoque no fim exato da janela de avaliação".
- **Honestidade sobre dado real em produção**: não há evidência no histórico de commits de que `DecisaoCompra` tenha sido exercitada em produção até agora (o formulário está conectado desde `7bbb596`, ~2026-10-27, mas nenhuma validação de fase anterior consultou essa tabela contra produção). É esperado que a tabela esteja vazia ou quase vazia — a maioria das avaliações reais pode cair em `SEM_DADOS` só por falta de decisão registrada, não por bug desta entrega.

### 12.4 Validação contra produção — pendente do merge

**Gap encontrado pelo coordenador**: diferente das demais fases, o Agente B não incluiu o script+workflow de verificação no PR original — por isso o CI de testes (`commercial-intelligence-tests.yml`, que só dispara em paths específicos como `.github/workflows/**`) nunca rodou no PR #106. Corrigido: script `scripts/validar-planejamento-avaliacao-fase2b-temp.ts` + workflow `validar-planejamento-avaliacao-fase2b-temp.yml` adicionados num commit extra (`ab2fb0b`) pelo coordenador, mesmo padrão das demais fases — conta `DecisaoCompra` real, reporta a distribuição SEM_DADOS/PARCIAL/COMPLETA contra produção, e confirma que nenhuma avaliação não-COMPLETA tem `diagnosticoPosDecisao` preenchido. Não executado ainda — depende do merge.

### 12.5 Resultado das verificações locais (reportado pelo agente)

`npx tsc --noEmit` limpo. `npm run build` com sucesso. `npx vitest run`: **684/684 passando** (674 + 10 novos, 0 regressão) — número reportado ANTES do commit de correção do coordenador (§12.4); a suíte completa do repo (que já inclui os 16 testes do Agente A) precisa ser revalidada no momento do merge final, não somada ingenuamente aos 690 da Fase A (os testes não são cumulativos entre PRs ainda não mergeados — ver §14 para o número real após merge de ambos).

---

## 13. Fase 2B — proposta técnica de lead time normal vs. urgente (2026-11-16, SOMENTE DIAGNÓSTICO — zero código)

Agente C. Regime estritamente somente-leitura, conforme pedido — nenhum arquivo criado, nenhuma branch, nenhum PR. Esta seção é só proposta, **não pode ser implementada sem aprovação explícita do Rodrigo**.

### 13.1 Estado atual confirmado (fresco)

`model CoberturaMeta` (`prisma/schema.prisma:155-162`) tem hoje `grupo` (único), `mesesCobertura`, `estoqueSegurancaUnidades?`, `leadTimeDias?` — um único campo de lead time, por grupo, sem distinção normal/urgente. Único consumidor real: `calcularSugestaoBestSeller` (`compras-inteligencia.ts:74-120`), que soma `leadTimeDias` ao horizonte de cobertura. Confirmado (de novo, fresco): **zero menção** a "urgente"/"urgência" em qualquer schema/código relacionado a lead time; **zero conceito de fornecedor** modelado em qualquer lugar do schema (TVB é produção própria via `ProductionOrder`, não compra de terceiro). `ProductionOrder` continua sem campo de data prevista de finalização (só `dataEntradaCelula`/`dataFinalizacaoProducao`, essa última null enquanto aberta).

### 13.2 Três opções (resumo — texto completo do agente arquivado na transcrição desta sessão, disponível sob pedido)

- **Opção A — mínima (recomendada para começar)**: um segundo campo `leadTimeUrgenteDias Int?` em `CoberturaMeta`, mais um parâmetro `tipoReposicao?: "NORMAL" | "URGENTE"` na função pura `calcularSugestaoBestSeller` (fallback pro lead time normal quando o urgente não está cadastrado — zero quebra de teste existente). Migration de 1 linha, 100% aditiva (`ALTER TABLE ADD COLUMN`, nullable, sem default), mesmo padrão já usado pela migration que criou `leadTimeDias`. UI: um terceiro input inline em `ParametrosGrupoForm` (`mapa-compras/inteligencia/forms.tsx:123-166`), mesmo padrão de controle inline já aprovado pelo Rodrigo. Risco: praticamente nenhum.
- **Opção B — intermediária**: tabela nova `LeadTimePorGrupo` (enum `TipoLeadTime: NORMAL | URGENTE`, `@@unique([grupo, tipo])`), coexistindo com `CoberturaMeta.leadTimeDias` (nunca remover campo em uso). Exige backfill revisado (não script de massa automático) e lógica de fallback. Só se justifica se surgir um 3º tipo de lead time real — hoje não há sinal disso.
- **Opção C — completa**: modelar `Fornecedor`+`ModalidadePedido` com lead time por fornecedor+modalidade. Exigiria seed artificial de um "Fornecedor: Produção própria TVB" (hoje não existe fornecedor real nenhum pra ancorar a entidade) — risco de over-engineering pra um requisito (compra de terceiro) que não existe ainda na operação da TVB.

### 13.3 Recomendação do agente

**Começar pela Opção A.** Resolve 100% do problema declarado (60 dias vs. 2 dias, ambos configuráveis) com uma migration de uma linha, sem tabela nova, sem FK, sem seed, mantendo o padrão de UI inline já em uso. Opção B só se justifica com um 3º cenário real de lead time; Opção C só se justifica no dia em que a TVB de fato comprar de terceiro — modelar fornecedor agora seria estrutura sem necessidade comprovada.

**Decisão pendente do Rodrigo**: qual opção seguir, e quando — nenhuma migration foi criada, nenhum código foi escrito, conforme exigido. Implementação só começa após aprovação explícita.

---

## 14. Fase 2B — fechamento: ajuste de regra de negócio, merge dos dois PRs e validação final em produção (2026-11-17)

Depois de revisar as entregas de §11/§12/§13, o Rodrigo pediu ajustes de regra em #105 antes do merge (Drop, Best Seller e produto não classificado — pedido verbatim abaixo) e autorizou seguir com #105 → validar → #106 → validar, nessa ordem, concluindo as duas frentes antes de iniciar a próxima etapa. **Sem migration, sem lead time urgente, sem escrita real em produção, sem tocar coletores/regras de venda/classificação fora deste escopo, sem nova auditoria geral** — todas as restrições explícitas respeitadas.

### 14.1 Pedido do Rodrigo (regra de negócio, decide as 3 pendências abertas em §11.1/§11.3)

1. **Drop**: ativo nunca é excesso nem gera recomendação de retirada/transferência que prejudique a exposição. Encerrado é avaliado normalmente (estoque/venda/ciclo), sem proteção especial.
2. **Best Seller**: proteção contra decisão precipitada, mas **não imunidade absoluta** — preserva o estoque necessário pra continuidade de venda/reposição, mas ainda identifica excesso real quando há evidência de estoque acima da necessidade; transferências continuam permitidas quando não arriscam ruptura na origem.
3. **Produto não classificado**: aparece na visão de excesso/distribuição, com "classificação pendente" explícita — nunca escondido, nunca com comportamento de Best Seller/Drop inventado. Quando a falta de classificação impede uma recomendação confiável, mostra o diagnóstico, não gera recomendação automática baseada em premissa desconhecida.

### 14.2 O que foi implementado em `planejamento-distribuicao.ts` (PR #105, commit `2113acb` antes do merge)

- **Consistência Drop**: a proteção de ciclo ativo (já existente, §11.3.5) só bloqueava a lista de oportunidades (Passo 2). Passou a bloquear também o CONTADOR de excesso (Passo 1, `excessoCD`/`excessoLojas`) — mesma condição (`vendasDias90 > 0`/`vendasOrigem90 > 0`, mesmo significado por posição). Drop encerrado continua sem nenhuma proteção especial, como pedido.
- **Reserva de continuidade de Best Seller** (não imunidade): nova função pura `aplicarRetencoes` usa `leadTimeDias` REAL por grupo (`getParametrosBestSellerPorGrupo`, `CoberturaMeta`, já em produção — nunca um valor inventado) × `velocidadeDiaria` da própria posição (sem risco de dupla contagem) pra reservar o necessário até a próxima reposição. O que sobra ALÉM da reserva continua contando como excesso real. Quando o grupo não tem `leadTimeDias` cadastrado, a reserva é 0 — comportamento idêntico ao de antes desta mudança, nunca assume um prazo não configurado. Afeta só o contador de excesso (Passo 1); as oportunidades de transferência (Passo 2) nunca são bloqueadas para Best Seller — `construirOrigem` já protege a origem contra ruptura por construção.
- **Campo `classificacao`** (novo, em `ProdutoExcessoDistribuicao`): `BEST_SELLER | DROP | MISTO | NAO_CLASSIFICADO`, mesma convenção de `planejamento-estoque.ts` — lógica extraída pra uma função pura exportada (`classificarAgregado`, em `planejamento-estoque.ts`) e reaproveitada aqui, nunca duplicada.
- **Contadores de transparência novos**: `excessoDropProtegido` (unidades retidas do contador de excesso por Drop ativo) e `reservaContinuidadeBestSeller` (unidades retidas como reserva de Best Seller) — nunca escondem silenciosamente o que foi filtrado, mesmo princípio de `dropsCicloAtivoProtegidos` já existente.
- **UI**: removidos os dois gates que restringiam a seção "Excesso e distribuição entre unidades" a produtos Best Seller/Drop (`page.tsx` linha ~67, `produto-detalhe.tsx` linha ~50) — a seção agora é buscada/mostrada pra qualquer produto com sinal real, com aviso explícito de "classificação pendente" quando `classificacao` é `NAO_CLASSIFICADO`/`MISTO` (`excesso-distribuicao.tsx`), e novos textos informativos pros dois contadores de transparência.
- **Produto NAO_CLASSIFICADO/MISTO verificado estruturalmente imune** a ambas as réguas: tanto o filtro de Drop quanto a reserva de Best Seller são indexados por mapas que só contêm cods com `tipoCompra` DROP/BEST_SELLER respectivamente — nenhum código extra foi necessário pra "proteger" o produto não classificado, é uma consequência direta da estrutura existente (confirmado também contra produção, ver §14.4).

### 14.3 Testes novos (`planejamentoDistribuicao.test.ts`, 16 → 23 testes no arquivo)

Drop ativo agora também exclui do contador de excesso (não só das oportunidades) e soma em "deve permanecer"; Drop encerrado continua sem retenção; Best Seller com `leadTimeDias` configurado tem reserva parcial que reduz o excesso sem zerá-lo (prova de não-imunidade); Best Seller sem `leadTimeDias` configurado tem reserva 0 (comportamento idêntico ao anterior, sem regressão); reserva de Best Seller nunca suprime oportunidades de transferência; produto NAO_CLASSIFICADO mostra excesso real completo, sem nenhuma retenção; `classificacao` agregada corretamente como MISTO quando os cods do mesmo produto divergem. `npx vitest run` completo (todo o repo): **697 testes passando** (690 + 7 novos), 0 regressão. `npx tsc --noEmit` e `npx eslint` (arquivos tocados) sem erros. `npm run build` com sucesso.

### 14.4 Merge, deploy e validação contra produção — PR #105

Merge squash em `4bacadb1a21e8162848d55215008bea5d3641597` (2026-11-17). Deploy de produção confirmado (status do commit via Vercel: `success`). Script temporário `scripts/validar-planejamento-distribuicao-fase2b-temp.ts` atualizado (commit `4e9a9c4`, pra reportar os campos novos — `classificacao`, `excessoDropProtegido`, `reservaContinuidadeBestSeller` — e checar vazamento de regra) e disparado via `workflow_dispatch` contra o banco de produção, **somente leitura**:

- 282 produtos com algum sinal de excesso/ruptura/oportunidade/retenção.
- Classificação real na base: **276 NAO_CLASSIFICADO, 5 DROP, 1 BEST_SELLER** — prova concreta de que a maioria dos produtos (que antes ficavam fora da seção por causa do gate removido) agora aparece corretamente.
- **1 produto** com excesso retido pela proteção de Drop ativo (prova real do fix de consistência Passo 1/Passo 2, não só sintética).
- **0 produtos** com reserva de continuidade de Best Seller aplicada — esperado: nenhum grupo tem `leadTimeDias` cadastrado em `CoberturaMeta` hoje, então a reserva fica em 0 pra todos, comportamento idêntico ao de antes desta mudança (nenhuma regressão, nenhuma premissa inventada).
- **0 produtos** NAO_CLASSIFICADO/MISTO com retenção indevida de Drop/Best Seller (checagem de honestidade/vazamento, prova contra dado real).
- **0 oportunidades** com `estoqueOrigemDepois` negativo, **0 divergências** saída≠entrada (mesmas checagens de integridade das fases anteriores, continuam verdes).

Script/workflow temporários removidos depois (commit `3e3d355`), mesmo padrão das fases anteriores.

### 14.5 Merge, deploy e validação contra produção — PR #106

PR #106 ficou com conflito trivial em `src/lib/metrics/index.ts` (ambos os PRs da Fase 2B adicionaram seu próprio `export *`) depois do merge de #105 em main — resolvido mantendo as duas linhas (commit `5ca2933` na worktree `tvb-dashboard-avaliacao-compras`), suíte completa revalidada pós-merge (**709 testes passando** — 697 + 12 do Agente B, 0 regressão), `tsc`/`build` limpos. Merge squash em `4eb31204b7563a4ad03e3a4e37edf985d8afdc08`. Deploy de produção confirmado.

**Integração confirmada**: `AvaliacaoDecisoesView` está de fato renderizada em `mapa-compras/page.tsx` (não é componente órfão) e o build de produção compila a rota normalmente.

Script `scripts/validar-planejamento-avaliacao-fase2b-temp.ts` (já incluído no PR, ver §12.4) disparado contra produção, somente leitura:

- **`DecisaoCompra` tem 0 linhas em produção hoje** — a avaliação retrospectiva está integrada e funcionando (não quebra, não inventa dado), mas não há nenhuma decisão real pra avaliar ainda. Confirma a suspeita já registrada em §12.3 ("é esperado que a tabela esteja vazia"). **Isto é uma limitação de dado, não um bug da função** — `avaliabilidade` ficaria SEM_DADOS/PARCIAL/COMPLETA = 0/0/0 porque não há nenhuma linha-fonte, nunca porque dado existente foi escondido.

Script/workflow temporários removidos depois (commit `5e42abc`).

### 14.6 Limitações finais que seguem existindo (não escondidas)

- **Nenhum grupo Best Seller tem `leadTimeDias` cadastrado em `CoberturaMeta` hoje** — a reserva de continuidade está implementada e testada, mas não tem efeito prático em produção até alguém cadastrar o lead time real por grupo (tela já existente de `ParametrosGrupoForm`, fora do escopo desta entrega).
- **`DecisaoCompra` está vazia em produção** — a avaliação retrospectiva (PR #106) não tem nenhuma decisão real pra avaliar ainda; só passa a mostrar algo quando o formulário de registro de decisão de compra (já existente desde `7bbb596`) for usado de fato.
- **Lead time urgente permanece só proposta técnica** (§13), não implementado nesta etapa, conforme pedido explícito.
- Ambas as decisões de arquitetura que ficavam pendentes em §11.1/§11.3.5 (restrição Best Seller/Drop na UI, e se a régua de ciclo ativo valeria pra Best Seller) foram resolvidas pelo pedido do Rodrigo nesta seção — não há mais pendência de validação aberta nesta frente.

### 14.7 Resumo de commits e deploys desta etapa

| Commit | O quê | Branch/alvo |
|---|---|---|
| `2113acb` | Ajuste de regra Drop/Best Seller/classificação + testes | `feat-planejamento-estoque-fase2b-distribuicao-20261116` (PR #105) |
| `4bacadb1a2` | **Merge PR #105** (squash) | `main`, deploy produção confirmado |
| `4e9a9c4` | Atualiza script temp de validação pra cobrir os campos novos | `main` |
| `3e3d355` | Remove script/workflow temp de #105 (pós-validação) | `main`, deploy produção confirmado |
| `5ca2933` | Resolve conflito trivial em `metrics/index.ts` | `feat-planejamento-estoque-fase2b-avaliacao-20261116` (PR #106) |
| `4eb31204b7` | **Merge PR #106** (squash) | `main`, deploy produção confirmado |
| `5e42abc` | Remove script/workflow temp de #106 (pós-validação) | `main`, deploy produção confirmado |

**As duas frentes da Fase 2B estão concluídas, integradas e validadas contra produção.** Próxima etapa (lead time urgente, ou outro item do roadmap em §6) aguarda decisão explícita do Rodrigo, conforme pedido.

---

## 15. Correção pontual — proteção de Drop ativo não deve depender de venda recente (2026-11-17)

Depois de revisar o relatório final da Fase 2B (§14), o Rodrigo encontrou uma divergência: a proteção de Drop ativo implementada em §14.2 ainda estava condicionada a `vendasDias90`/`vendasOrigem90 > 0` (herdada da régua original de §11.3.5) — mas a regra de negócio aprovada por ele é mais simples e mais ampla: **Drop ativo nunca é excesso, independente de ter vendido ou não nos últimos 90 dias.** Pedido tratado como correção pontual, sem reabrir o resto da Fase 2B.

### 15.1 O que mudou

`src/lib/metrics/planejamento-distribuicao.ts`: removida a condição de venda tanto no contador de excesso (Passo 1: `isDropAtivo && l.vendasDias90 > 0` → só `isDropAtivo`) quanto na lista de oportunidades de transferência (Passo 2: `dropAtivoPorCod.get(m.cod) === true && m.vendasOrigem90 > 0` → só `dropAtivoPorCod.get(m.cod) === true`). Só o CICLO (`dropEmCicloAtivo` — ativo vs. encerrado) decide a proteção agora; Drop encerrado continua sem nenhuma proteção especial, avaliado normalmente, como já era. Textos de UI em `excesso-distribuicao.tsx` atualizados pra não mencionar mais "venda real" como condição da proteção.

### 15.2 Testes

8 testes dedicados (as 4 combinações pedidas × Passo 1/Passo 2): Drop ativo com vendas recentes, Drop ativo sem vendas recentes, Drop encerrado com vendas, Drop encerrado sem vendas. O teste antigo que esperava "NÃO suprime Drop ativo com estoque_parado/vendasOrigem90=0" foi invertido (a regra mudou propositalmente) e expandido pros dois passos. `npx vitest run` (suíte completa): **712 testes passando** (709 + 3 novos líquidos), 0 regressão — confirma que Best Seller, produto não classificado e MISTO continuam intocados (nenhum desses testes mudou de resultado). `npx tsc --noEmit` e `npx eslint` sem erros. `npm run build` com sucesso.

### 15.3 Merge, deploy e validação contra produção

PR #108, branch `fix/drop-ativo-protecao-independente-de-venda-20261117`. CI (`test`/`Vercel`) só disparou depois de incluir o script+workflow de validação no próprio PR (mesmo gap de path-filter já visto em §12.4 — PRs que só tocam `src/lib/metrics/*.ts`/`src/app/dashboard/*` sem tocar `.github/workflows/**` não disparam o job `test`). Merge squash em `fe9c20847a413cf7376245b1d78bd2664c9e91d9`. Deploy de produção confirmado.

Script `scripts/validar-fix-drop-ativo-sem-venda-temp.ts` (somente leitura) contra produção:

- **6 cods classificados como DROP em produção hoje, todos em ciclo ativo (0 encerrados)** — não há exemplo real de Drop encerrado em produção neste momento, só os 4 cenários sintéticos dos testes cobrem esse caso.
- **2 produtos com excesso efetivamente retido pela proteção** (`excessoDropProtegido > 0`): Ultra Light Treko Reverso e Classic Marinho.
- **Achado real, não um bug**: 5 produtos rotulados `classificacao: "DROP"` ainda aparecem com `excessoCD`/`excessoLojas` > 0. Drill-down cod a cod confirmou a causa: cada um desses produtos tem só 1-2 cods de fato classificados como DROP e **8-9 cods irmãos (mesmo nome de produto, outra cor/tamanho) sem nenhuma classificação**. `classificarAgregado` (Fase 1) só considera cods COM `tipoCompra` pra decidir o rótulo agregado — por isso o produto aparece como "DROP" mesmo com a maioria dos SKUs não classificados. A proteção desta fase é aplicada POR COD (`isDropAtivo` é calculado por `v.cod`, nunca por produto), então os cods sem classificação corretamente NÃO herdam a proteção e continuam mostrando o excesso real deles — exatamente o que a regra #3 do pedido original (§14.1) exige ("não inventar comportamento de Drop" pra quem não é Drop). **Não é uma pendência a corrigir** — é a granularidade correta (por SKU, não por nome de produto) já documentada desde a Fase 1 (MISTO/NAO_CLASSIFICADO também são conceitos por produto que escondem mistura de cods por baixo).
- **0 produtos não-DROP com `excessoDropProtegido > 0`** — zero vazamento da régua pra Best Seller/não classificado/MISTO, confirmado contra dado real.

Script/workflow temporários removidos depois (commit `ba8f69b`), mesmo padrão das fases anteriores.

### 15.4 Commits desta correção

| Commit | O quê | Branch/alvo |
|---|---|---|
| `2380f1f` | Remove condição de venda da proteção de Drop ativo + testes | `fix/drop-ativo-protecao-independente-de-venda-20261117` (PR #108) |
| `78d7064` | Adiciona script/workflow temp de validação | mesma branch |
| `fe9c2084` | **Merge PR #108** (squash) | `main`, deploy produção confirmado |
| `eb6cc8e` | Drill-down cod-a-cod no script temp (investigação do achado) | `main` |
| `ba8f69b` | Remove script/workflow temp (pós-validação) | `main`, deploy produção confirmado |

**Fechada a divergência de regra apontada pelo Rodrigo.** Resto da Fase 2B (§11-§14) permanece como estava — nenhum outro comportamento foi alterado.
