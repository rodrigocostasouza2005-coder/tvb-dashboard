# Planejamento Inteligente de Estoque — TVB Radar

**Status:** Fase 2A (classificação em lote, tendência de demanda, grade por cor/tamanho) mergeada e em produção (PR #101, SHA `9b4c986`, deploy `dpl_hi5hnbsinp8nhXxiZeZ311NEwcX4`). Validada contra dado real de produção. Fase 1 (PR #100) e Fase 0 concluídas.
**Data:** 2026-11-16 (Fase 0, Fase 1 e Fase 2A)
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
