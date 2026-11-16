# Planejamento Inteligente de Estoque — TVB Radar

**Status:** Fase 0 (diagnóstico técnico) concluída. Nenhuma implementação ainda.
**Data:** 2026-11-16
**Como ler este documento:** é um documento vivo de continuidade — arquitetura, regras de negócio, decisões e pendências. Toda afirmação aqui é fato verificado em código/schema nesta data, salvo quando marcado "não verificado" ou "decisão pendente". O código muda rápido neste projeto — antes de implementar algo listado aqui, reverifique contra o código atual.

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
