# Auditoria Técnica — Mapa de Compras, Inteligência de Distribuição, Estoque Mínimo Manual e Alertas (2026-11-26)

**Escopo:** as 4 abas-filhas de "Planejamento de Estoque" (`src/lib/tabs.ts`): Mapa de Compras (`/dashboard/mapa-compras`), Inteligência de Distribuição (`/dashboard/distribuicao-estoque`), Estoque Mínimo Manual (`/dashboard/estoque-minimo-manual`) e Alertas de Estoque Mínimo (`/dashboard/estoque-minimo-alertas`), e a lógica de métricas que elas importam (`src/lib/metrics/compras-inteligencia.ts`, `distribuicao-estoque.ts`, `estoque-minimo-manual.ts`, `planejamento-avaliacao.ts`). **Fora do escopo, deliberadamente:** o núcleo da própria aba `planejamento-estoque` (`planejamento-estoque.ts`, `planejamento-distribuicao.ts`, `planejamento-grade.ts`, `planejamento-recomendacao.ts`, `aba-decisoes.tsx` etc.) — auditado em paralelo por outra sessão.

**Método:** leitura direta do código real (linha a linha nos arquivos centrais), leitura das duas auditorias anteriores desta área (`docs/auditoria-mapa-compras-distribuicao-estoque.md`, 2026-10-30, e `docs/auditoria-planejamento-estoque-reformulacao-2026-11-23.md`) pra não repetir achado já registrado, `npx vitest run` nos testes relacionados, e 2 scripts temporários somente-leitura contra o Neon **dev** (confirmado nos dois arquivos `.env`/`.env.local` antes de rodar, host `ep-super-paper-axg87hqn...`, nunca produção) — criados, executados e removidos nesta sessão (`git status` confirma que nada ficou). Nenhuma produção foi tocada. Nenhum código de aplicação foi alterado.

**Convenção de status:** CONFIRMADO (verificado linha a linha e/ou contra dado real) · SUSPEITA (indício forte, não totalmente verificável sem acesso a produção) · CORRIGIDO DESDE A AUDITORIA ANTERIOR.

---

## 1. Resumo executivo (por impacto)

1. **CONFIRMADO — todo o motor novo de decisão (Distribuição, Mapa de Compras-Inteligência, Avaliação Retrospectiva, Estoque Mínimo Manual) calcula venda bruta, nunca líquida de devolução.** Nenhum dos 4 arquivos (`distribuicao-estoque.ts`, `compras-inteligencia.ts`, `planejamento-avaliacao.ts`, `estoque-minimo-manual.ts`) importa ou usa `returnWhere()`/o model `Return` — zero ocorrência, confirmado por grep. Todos usam `prisma.sale.groupBy`/`aggregate` com `status: { not: "Cancelada" }` apenas. Isso é a MESMA classe de bug encontrada hoje em outras abas ("cálculo bruto onde devia ser líquido"), mas aqui é mais grave: afeta a sugestão de quantidade de compra (Best Seller/Drop), o diagnóstico de ruptura/excesso que decide transferências entre lojas/CD, a velocidade usada no Estoque Mínimo Manual, e a avaliação retrospectiva de decisões já tomadas. Devolução é ~9% do volume de venda em dev (55.809 un. vendidas vs. 5.045 un. devolvidas, não-cancelada, hoje) — não é um resíduo desprezível. A direção do viés é sistemática: venda inflada → velocidade/demanda inflada → cobertura subestimada → MAIS propensão a classificar como "ruptura"/"necessidade" e MENOS a classificar como "excesso"/"estoque parado" do que a realidade líquida sustentaria — ou seja, o motor tende a recomendar mais transferência/compra do que o necessário, não menos.
2. **SUSPEITA (alto impacto, não confirmável sem tocar produção) — a aba "Histórico" (acompanhamento de decisões de movimentação) e os botões "Aprovar"/"Recusar" em "Movimentações" podem estar inoperantes em produção até hoje.** A migration `20261111160000_add_decisao_movimentacao_estoque` foi gerada em 12/11 e, por decisão documentada no próprio código, **deliberadamente não aplicada em produção** na entrega original. Não existe nenhum mecanismo de deploy que rode `prisma migrate deploy` (`package.json` só tem `postinstall: prisma generate`; `vercel.json` só tem crons de sync) nem uma rota dedicada `/api/aplicar-migration-*` para esta tabela especificamente (existem para `mapa-compras` e `armazem-conhecido`, não para esta). Sem uma dessas duas coisas, a tabela normalmente só é criada manualmente — e não há evidência, em 14 dias de commits desde então, de que isso tenha acontecido. O código trata esse estado com elegância (mensagem explicativa, nunca crash — `ehTabelaInexistente`/`mensagemDeErro`, testado em `mensagemDeErroMigration.test.ts`), mas isso não resolve o fato de que, se a migration ainda não foi aplicada, toda decisão de movimentação que alguém clicar "Aprovar" hoje falha silenciosamente para o usuário final (mensagem de erro, não gravação) — 15 dias depois do recurso ter sido anunciado como pronto.
3. **CORRIGIDO desde a auditoria de 2026-10-30 — sell-through do Drop (achado antigo #1).** `quantidadeCompradaOriginal` deixou de ser hardcoded em 0; agora vem de `ProductionOrder.quantidadeOriginal` via `getQuantidadeOriginalProduzidaPorCod` (`compras-inteligencia.ts:758-771`), com histórico real (2.975 ordens de produção com `quantidadeOriginal > 0` em dev hoje). Sell-through do Drop deixou de ser estruturalmente vazio.
4. **CORRIGIDO desde a auditoria de 2026-10-30 — Best Seller invisível na Distribuição quando só a classificação manual era considerada (achado novo, mas já corrigido antes desta auditoria, em 2026-11-25).** `distribuicao-estoque.ts` agora usa `resolverTipoCompraEfetivo` (manual sobrescreve, `colecao === "BESTSELLER"` decide na ausência) — e isso importa: hoje existem 329 cods com `colecao="BESTSELLER"` em `StockSnapshot` contra **0 linhas** em `ClassificacaoProduto` (classificação manual) no dev agora. Sem esse fix, a Inteligência de Distribuição trataria 100% dos Best Sellers reais como "sem classificação".
5. **CONFIRMADO (persiste, não corrigido) — inconsistência no campo `premissas` de `DecisaoCompra` já documentada na auditoria de 2026-10-30 continua existindo hoje**, agora em arquivos diferentes dos citados na época (a tabela antiga `tabelas.tsx` foi removida/substituída por `mapa-compras-grid.tsx`): `mapa-compras-grid.tsx:146` grava `{ premissas: r.premissas, avisos: r.avisos }` (premissas reais do cálculo); `mapa-compras/inteligencia/consolidado-view.tsx:105` grava `{ premissas: item.fatoresPrioridade, avisos: [] }` (fatores de priorização de orçamento, `avisos` sempre vazio por construção). Mesmo campo, dois significados diferentes dependendo de onde o usuário confirma — sobreviveu a pelo menos 2 refatorações desde que foi apontado.
6. **CONFIRMADO — "Alertas de Estoque Mínimo" usa exatamente o mesmo critério/motor que "Estoque Mínimo Manual"** (item 2 do pedido desta auditoria): a página só chama `getEstoqueMinimoManual` (mesma função, zero cálculo duplicado) e filtra por `nivelAlerta IN (CRITICO, ATENCAO)`. Não há divergência de limiar entre as duas telas.
7. **CONFIRMADO — "Avaliação Retrospectiva de Compras" não mistura período parcial com completo.** `planejamento-avaliacao.ts` é rigoroso: só classifica `COMPLETA` quando os 90 dias cheios decorreram E há `cod` (não só grupo); decisão só-por-grupo nunca é `COMPLETA`, qualquer que seja o tempo decorrido; janela que não decorreu inteira nunca é somada parcialmente e exibida como se fosse cheia (`vendasPosDecisao30/60/90` ficam `null` explicitamente, nunca uma soma parcial maquiada). É o módulo mais defensivo e bem documentado dos 4 auditados nesta rodada — mas herda o bug #1 (venda bruta) como todos os outros, e hoje tem **zero decisões reais pra avaliar** (`DecisaoCompra` com 0 linhas em dev).
8. **CONFIRMADO — nenhuma funcionalidade nova encontrada nesta rodada é "visualmente morta" por dado inventado/mockado.** O padrão de honestidade already-documentado (nunca inventar número quando falta dado) se mantém nos 4 arquivos — onde não há dado, a tela mostra "—", "sem dado suficiente", ou mensagem explicativa, nunca zero/fictício disfarçado de real. O que existe, sim, é baixa adoção real (ver §5): `DecisaoCompra`, `EstoqueMinimoManual` e `DecisaoMovimentacaoEstoque` com 0 linhas em dev hoje — mecanismo correto, uso real ainda não começou (ou não está visível no clone de dev).
9. **CONFIRMADO — zero teste automatizado para a camada de dados (Prisma) dos 4 módulos**, só para as funções puras. Padrão idêntico ao já documentado nas 2 auditorias anteriores desta área: `getComparacaoCompleta`, `getHistoricoMovimentacoes`, `registrarDecisaoMovimentacao`, `getEstoqueMinimoManual`, `getAvaliacaoDecisaoCompra`, `getRecomendacoesBestSeller`/`getRecomendacoesDrop` nunca são exercitados contra um banco (nem real nem mockado) — só as funções puras que elas chamam (`diagnosticarVariante`, `calcularNivelAlertaMinimoManual`, `avaliarDecisaoCompra`, `calcularSugestaoBestSeller`/`Drop`). 178 testes passando, 100% neste recorte.

---

## 2. Achado 1 em detalhe — venda bruta vs. líquida nos 4 módulos

### 2.1 O padrão correto já existe no projeto, só não é usado aqui

`src/lib/metrics/core.ts:179-197` centraliza `returnWhere(filters)` com um comentário explícito dizendo que qualquer métrica nova que soma `Sale` deveria, quando aplicável, descontar `Return` pelo mesmo filtro — e `saleWhere(filters):207` centraliza a regra "venda cancelada nunca conta". O padrão "bruto menos devolução = líquido" já é usado em outras partes de `estoque.ts` (citado nominalmente na auditoria de 30/10: `getStockVsSalesCombinado`, `getMapaDeComprasDetalhado` — este último é a função por trás do grid "mês a mês" mais antigo do próprio Mapa de Compras, então a PRÓPRIA aba já tem as duas convenções coexistindo: a parte antiga líquida, a parte nova (Inteligência) bruta).

### 2.2 Onde a venda bruta aparece, confirmado grep + leitura

- `src/lib/metrics/distribuicao-estoque.ts` — `vendas30`/`vendas60`/`vendas90` (linhas 1318-1333, `prisma.sale.groupBy`) alimentam `diagnosticarVariante` (ruptura/excesso/parado/equilibrado) em TODAS as abas da Inteligência de Distribuição (Visão Geral, Movimentações, Análise de Grade). Zero ocorrência de `Return`/`devolu` em 2.029 linhas do arquivo (grep confirmado).
- `src/lib/metrics/compras-inteligencia.ts` — `getVendaMediaDiariaPorCod` (linhas 698-731, usada por Best Seller, Drop E reaproveitada por `estoque-minimo-manual.ts`) e a query de `vendasAcumuladas` dentro de `getRecomendacoesDrop` (linha 921) — mesma ausência, zero `Return` em 1.244 linhas.
- `src/lib/metrics/planejamento-avaliacao.ts` — `somarVendasJanela`/`buscarDadosCruzados` (linhas 282-323) — mesma ausência; o próprio comentário do arquivo (linha 279) admite "Sale ... é lido exatamente como existe hoje (venda bruta por linha ...)" — ou seja, bruto aqui é uma decisão CONSCIENTE e documentada, não um esquecimento, mas não muda a conclusão de que o número reportado como "vendas pós-decisão" não é líquido.
- `src/lib/metrics/estoque-minimo-manual.ts` — não tem query de venda própria (reaproveita `getVendaMediaDiariaPorCod`), então herda o mesmo problema sem adicionar um novo.

### 2.3 Magnitude real (dev, hoje)

```
Sale (status != Cancelada):   55.809 unidades em 50.172 linhas
Return:                        5.045 unidades em  4.880 linhas
Return / Sale:                 9,04%
```
Consulta rodada contra Neon dev (mesmo host de `.env`/`.env.local`, confirmado antes de rodar), script temporário removido depois. ~9% não é um resíduo — é grande suficiente para mudar a classificação de um item que está na fronteira (ex: `coberturaDias` perto do limiar de 30/60 dias) e para inflar sistematicamente a quantidade sugerida de compra Best Seller/Drop.

### 2.4 Por que isso é mais grave aqui do que nas abas já auditadas hoje

As abas Reposição/Cobertura/Envelhecimento (auditadas em 30/10) são leitura passiva — mostram um diagnóstico, sem ação formal associada. Os 4 módulos desta auditoria **decidem e registram decisão**: Mapa de Compras grava `DecisaoCompra` (quanto comprar), Distribuição grava `DecisaoMovimentacaoEstoque` (que transferência aprovar), Estoque Mínimo Manual decide nível de alerta (Crítico/Atenção). Um viés sistemático pra cima na demanda nesses três lugares tem custo real (comprar mais do que precisa, mover estoque que não precisava ser movido, alarme falso de "crítico").

---

## 3. Achado 2 em detalhe — migration de `DecisaoMovimentacaoEstoque` possivelmente ainda não aplicada em produção

### 3.1 Fatos confirmados

- Migration `20261111160000_add_decisao_movimentacao_estoque` existe em `prisma/migrations/`, commitada em 2026-11-12.
- Comentário explícito em `distribuicao-estoque.ts:1843-1845`: "a tabela depende da migration ..., que foi GERADA mas deliberadamente NÃO aplicada em produção nesta entrega."
- `npx prisma migrate status` contra o Neon **dev** (`ep-super-paper-...`, confirmado nos dois `.env`) retorna "Database schema is up to date!" — ou seja, em DEV a migration está aplicada (consistente com a auditoria de 23/11, que já via a tabela existir com 0 linhas, não erro de tabela inexistente).
- **Dev não é evidência de produção.** `package.json` só roda `prisma generate` no `postinstall` — nunca `migrate deploy`. `vercel.json` só define crons de sync, nenhum build step de migration. As únicas duas migrations que se sabe terem sido aplicadas manualmente em produção têm rota HTTP dedicada e documentada (`src/app/api/aplicar-migration-compras/route.ts`, `src/app/api/aplicar-migration-armazem-conhecido/route.ts`) — **não existe rota equivalente para `decisao_movimentacao_estoque`**, e não há menção em nenhum commit desde 12/11 de ter sido aplicada manualmente.
- `getHistoricoMovimentacoes`/`registrarDecisaoMovimentacaoAction`/`atualizarStatusMovimentacaoAction` tratam esse estado com cuidado real (nunca derrubam a página; há teste dedicado, `mensagemDeErroMigration.test.ts`, inclusive para não confundir esse erro com um erro de esquema de outra tabela — correção de um incidente real citado no próprio comentário, 2026-11-25, `ClassificacaoProduto.cod`).

### 3.2 Classificação

**SUSPEITA, não CONFIRMADO** — não há (e não deveria haver, por regra do projeto) acesso de leitura a produção nesta auditoria para confirmar o estado real da tabela lá. O que é CONFIRMADO é a ausência de qualquer mecanismo, automático ou manual-documentado, que teria aplicado essa migration em produção nos 14 dias desde que foi gerada. Se ainda não foi aplicada, a consequência prática e real para o usuário é: a aba "Histórico" mostra a mensagem "Histórico ainda não disponível neste ambiente" em vez do ciclo de decisões, e qualquer clique em "Aprovar"/"Recusar"/"Deixar pendente" na aba "Movimentações" retorna erro ("Histórico indisponível: a migration ... ainda não foi aplicada") em vez de registrar a decisão — silenciosamente, sem crash, mas sem persistir nada.

### 3.3 Resposta ao item 4 do pedido desta auditoria (duplicação/perda de registro, "já distribuído" é intenção ou execução confirmada)

Não há como ter duplicação ou perda de registro numa tabela que, pelo que se pode confirmar a partir do código e do processo de deploy, pode nem existir em produção ainda. Quanto à segunda parte da pergunta — **"Executada" é sempre e só uma confirmação humana, nunca uma verificação contra o sync real**: confirmado nos comentários de `movimentacoes.tsx:23-25` ("Nada aqui executa movimentação física ... A peça só se move quando alguém move, fora do Radar") e reconfirmado pela auditoria de 23/11 (§3.5, não re-verificado linha a linha nesta rodada por não ter mudado): marcar "Executada" não debita/credita `StockSnapshot` — o estoque real só muda no próximo sync, de forma totalmente independente do clique. O relatório de "já distribuído" (quando a tabela existir/estiver populada) é sempre **intenção registrada + confirmação humana de execução física**, nunca uma verificação automática de que o estoque de fato se moveu.

---

## 4. Achados menores / confirmações pontuais

| # | Achado | Classificação |
|---|---|---|
| A | `estoque-minimo-alertas` usa exatamente `getEstoqueMinimoManual` (zero cálculo duplicado), filtrado por `nivelAlerta` — mesmo critério de "mínimo" do núcleo e de Estoque Mínimo Manual, sem divergência de limiar | CONFIRMADO, correto |
| B | Avaliação Retrospectiva nunca mistura período parcial com completo — regras explícitas e testadas (`avaliarDecisaoCompra`, `planejamentoAvaliacao.test.ts`, 10 testes) | CONFIRMADO, correto |
| C | Sell-through do Drop conectado a `ProductionOrder.quantidadeOriginal` — deixou de ser estruturalmente vazio | CORRIGIDO desde 30/10 |
| D | Best Seller via `colecao === "BESTSELLER"` (StockSnapshot) agora prevalece sobre ausência de `ClassificacaoProduto` manual na Inteligência de Distribuição (`resolverTipoCompraEfetivo`) — sem isso, 329 cods reais seriam invisíveis ao motor de Distribuição | CORRIGIDO em 25/11, antes desta auditoria |
| E | Campo `premissas` de `DecisaoCompra` ainda tem 2 formatos diferentes dependendo da tela de confirmação (`mapa-compras-grid.tsx` vs. `consolidado-view.tsx`) | CONFIRMADO, persiste (achado antigo não corrigido) |
| F | Bug real de 13/11 (CD/Site diagnosticado como parado por não contar a demanda que ele abastece pras lojas) foi corrigido com `vendasEfetivasCdSite` — testado e documentado | CORRIGIDO (contexto, não achado novo) |
| G | Nenhuma funcionalidade nova "visualmente morta" por dado mockado encontrada — mas `DecisaoCompra`, `EstoqueMinimoManual` e `DecisaoMovimentacaoEstoque` seguem com 0 linhas em dev hoje (mecanismo correto, adoção real ainda não visível) | CONFIRMADO |
| H | Zero teste para a camada Prisma dos 4 módulos (só funções puras) — 178 testes passando, nenhum toca banco | CONFIRMADO |
| I | Controles inline (edição de mínimo direto na linha, sem formulário separado) — Estoque Mínimo Manual foi redesenhado em 24/11 especificamente por isso e está em conformidade | CONFIRMADO, correto |
| J | Nenhum TODO/FIXME/comentário escondendo limitação encontrado além do que já está documentado explicitamente em prosa (padrão do projeto: admitir limitação em comentário extenso, não em tag) | CONFIRMADO |

---

## 5. O que não foi possível confirmar (declarado, não escondido)

- Estado real de `DecisaoMovimentacaoEstoque` em **produção** — não verificável sem tocar produção, fora da autorização desta auditoria. Recomenda-se ao Rodrigo confirmar isso antes de anunciar a aba "Histórico" como funcional.
- Se alguém já usou `EstoqueMinimoManual`/`DecisaoCompra` em produção depois do clone do dev usado nesta sessão — mesma ressalva já registrada na auditoria de 23/11, não resolvida aqui.
- Não foi medido o impacto numérico exato (em unidades ou R$) que a venda bruta (§2) teria sobre uma sugestão de compra ou transferência específica — a magnitude de 9% é agregada do catálogo inteiro, não por SKU individual (alguns SKUs têm taxa de devolução bem maior que a média, outros zero).

---

## 6. Resumo final priorizado (para decisão)

1. **Venda bruta (nunca líquida de devolução) em 100% dos motores de decisão novos** (Distribuição, Mapa de Compras-Inteligência, Avaliação Retrospectiva, Estoque Mínimo Manual) — ~9% do volume de venda é devolução; viés sistemático pra MAIS compra/transferência do que o líquido justificaria. Maior impacto real, mais fácil de corrigir (um único padrão, `returnWhere`, já existe e é usado em outras partes do mesmo domínio).
2. **Migration `DecisaoMovimentacaoEstoque` sem mecanismo confirmado de aplicação em produção**, 14 dias após gerada — se ainda pendente, toda a aba "Histórico" e os botões Aprovar/Recusar/Deixar pendente de "Movimentações" falham silenciosamente (mensagem de erro, não crash) em produção hoje. Peça ao Rodrigo pra confirmar o estado real; se confirmado pendente, é candidato à mesma rota HTTP dedicada já usada 2x antes (compras, armazém).
3. **Campo `premissas` de `DecisaoCompra` com 2 formatos diferentes** dependendo de onde a decisão é confirmada (grid vs. consolidado) — achado antigo (30/10), ainda não corrigido, sobreviveu a 2 refatorações.
4. Sell-through do Drop e Best Seller via `colecao` — ambos já corrigidos antes desta auditoria; mencionados aqui só pra fechar o ciclo dos achados antigos.
5. "Executada" em Movimentações é e continuará sendo só confirmação humana (nunca verificada contra o sync real) — não é bug, é arquitetura deliberada; só vale deixar claro na UI se ainda não estiver (hoje já está: "A peça só se move quando alguém move, fora do Radar").
6. Nenhuma funcionalidade mockada/fictícia encontrada; adoção real de `DecisaoCompra`/`EstoqueMinimoManual`/`DecisaoMovimentacaoEstoque` continua em zero no dev — mecanismo correto, uso real é decisão do negócio, não bug técnico.
7. Zero teste para a camada Prisma dos 4 módulos — risco de regressão silenciosa em qualquer refatoração futura dessas queries, mesmo padrão já apontado 2x antes.
