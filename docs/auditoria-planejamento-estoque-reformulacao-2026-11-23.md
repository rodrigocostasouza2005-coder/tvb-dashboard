# Auditoria pré-reformulação — Planejamento Inteligente de Estoque (2026-11-23)

**Tipo:** Fase 1 de uma missão maior (reformulação de UX da área de Planejamento de Estoque). **Somente leitura/diagnóstico — zero código de aplicação alterado nesta rodada.** Não propõe solução; isso é fase 2/3.

**Método:** leitura direta do código real em `src/app/dashboard/planejamento-estoque/`, `src/lib/metrics/*.ts`, `src/app/dashboard/reposicao/`, `src/app/dashboard/distribuicao-estoque/`, `src/app/dashboard/estoque-minimo-manual/`, `src/app/dashboard/mapa-compras/` e `prisma/schema.prisma`; consulta real (read-only) ao Neon **dev** (`ep-super-paper-axg87hqn...`, confirmado nos dois arquivos `.env`/`.env.local` antes de qualquer query, nunca produção) via um script temporário criado, executado e removido nesta sessão; leitura do doc de referência `docs/planejamento-inteligente-estoque.md` (826 linhas) como ponto de partida, com verificação pontual e independente de várias de suas afirmações contra o código e o dado de hoje.

**Aviso de honestidade sobre o próprio método**: este documento não reverificou LINHA POR LINHA todas as ~20 fases já descritas no doc de referência (seria redundante e caro) — verifiquei por amostragem os pontos de maior risco/impacto (a regra mais perigosa, a estrutura visual que gera a queixa do Rodrigo, os dados mais frágeis já documentados) e tracei a estrutura de arquivos de ponta a ponta. Onde não verifiquei pessoalmente, digo isso explicitamente.

---

## 0. Achado operacional que precede todo o resto: o Neon dev está com schema divergente de `main` AGORA

Antes de reportar qualquer número, um achado que afeta a confiabilidade de qualquer consulta a `ClassificacaoProduto` nesta sessão: o Neon dev compartilhado já recebeu, hoje (2026-11-23, `finished_at` 16:49:30), a migration `20261123160000_raise_grao_classificacao_produto_cor` — aplicada por um worktree paralelo e ainda ativo nesta sessão (`tvb-dashboard-classificacao-grao`, branch `feat/classificacao-grao-produto-cor-20261119`, **PR #117, ainda ABERTO, não mergeado em `main`**). Essa migration renomeou a coluna `cod` de `ClassificacaoProduto` para `produto`+`cor`+`produtoCor`, e a tabela está com **0 linhas** no dev agora — provavelmente truncada/recriada pela própria migration.

**Consequência prática**: o `schema.prisma` de `main` (o que este worktree, e presumivelmente produção, usam) ainda declara `cod String @unique` nesse model — uma query Prisma contra `ClassificacaoProduto.cod` falha hoje no dev com `P2022: column does not exist`. Isso **não é um bug de produção** (PR #117 não foi mergeado, produção não foi tocada), mas significa que **não dá pra confiar em nenhuma contagem de `ClassificacaoProduto` tirada do dev agora** — o dado real mais recente e confiável sobre classificação é o que o doc de referência registrou contra **produção** em 2026-11-18 (§14.4/§15.3/§19.8): 8 cods classificados no total (2 `BEST_SELLER`, ambos do produto "Classic Black" tamanhos 36/42; 6 `DROP`, todos em ciclo ativo). Não tentei nem consegui reverificar esse número hoje — é uma limitação explícita desta auditoria, não um fato novo.

Outras tabelas consultadas no dev parecem ser clone/branch de produção com defasagem de alguns dias (contagens como `StockSnapshot` = 2.681 cods distintos e `ProductionOrder.status=Finalizado` = 2.888 batem exatamente com os números que o doc registrou contra produção em 2026-11-18) — então uso essas como razoavelmente representativas, mas registro a mesma cautela: tabelas de uso operacional recente (decisões, mínimos manuais) podem não refletir o que aconteceu em produção depois do clone.

Dados confirmados agora, direto do dev (2026-11-23):
| Tabela | Linhas | Observação |
|---|---|---|
| `StockSnapshot` (cods distintos) | 2.681 | Bate com produção 2026-11-18 — razoavelmente atual |
| `ProductionOrder` total / `Finalizado` | 2.975 / 2.888 | Bate com produção 2026-11-18 |
| `StockMinimumRule` | 645 | Doc citava "1275 regras" importadas — divergência não investigada (pode ser dev defasado, ou regras consolidadas/removidas em produção desde então; **não confirmado**) |
| `CoberturaMeta` | 2 linhas, **0 com `leadTimeDias`, 0 com `leadTimeUrgenteDias`, 0 com `estoqueSegurancaUnidades`** | Confirma que o achado "nenhum grupo com lead time cadastrado" (repetido em §14.6/§16.2/§18/§19.8 do doc) **continua verdadeiro hoje** |
| `EstoqueMinimoManual` | 0 linhas | Feature do PR #110 sem nenhum uso real registrado (no dev; não verificável se produção tem uso sem tocar produção) |
| `DecisaoCompra` | 0 linhas | Confirma §14.5 do doc — motor de decisão de compra formal continua sem nenhuma decisão real registrada |
| `DecisaoMovimentacaoEstoque` | 0 linhas | Ver cautela acima sobre defasagem de dado operacional no clone de dev |
| `StockSnapshotDiario` | **0 linhas, 0 dias** | Ver §2 abaixo — feature mergeada hoje mesmo, ainda sem nenhum dado acumulado |

---

## 1. Mapa completo de funcionalidades existentes

### 1.1 Navegação — 13 abas no grupo "Estoque" (confirmado em `src/lib/tabs.ts`, hoje)

`estoque-atual`, `estoque` (Estoque × Vendas), `cobertura`, `sellthrough`, `curva-vida-colecao` (Cohort), `envelhecimento`, `reposicao` (Reposição de lojas), `estoque-minimo` (por LOJA — `StockMinimumRule`), `estoque-retirada` (Sugestão de Retirada), `mapa-compras`, `distribuicao-estoque` (Inteligência de Distribuição), `planejamento-estoque` (Planejamento de Estoque), `estoque-minimo-manual` (por EMPRESA — `EstoqueMinimoManual`, PR #110). O doc de referência registrava 12 abas (antes do PR #110 adicionar a 13ª) — número atualizado aqui.

### 1.2 Planejamento de Estoque (`src/app/dashboard/planejamento-estoque/`) — a tela-alvo da queixa do Rodrigo

Arquivos: `page.tsx`, `filtros.tsx`, `produtos-table.tsx`, `produto-detalhe.tsx`, `excesso-distribuicao.tsx`, `grade-recomendada.tsx`, `format.tsx`.

Lista principal (fora do detalhe): filtro por grupo/tamanho/busca, 4 `StatTile`s (produtos no filtro, risco de ruptura, possível excesso, sem movimentação), tabela de produtos com situação/classificação.

**Painel de detalhe (`produto-detalhe.tsx`) — confirmado hoje, código lido linha a linha**: ao abrir 1 produto, o painel empilha, **verticalmente, dentro do mesmo card, sem abas nem colapso**, até 8 blocos distintos, nesta ordem fixa:
1. Cabeçalho (nome do produto + nº de SKUs + "Fechar")
2. Grid 2 colunas: gráfico de evolução de vendas (90d) + tabela "Estoque e demanda por loja/CD"
3. *(condicional, só ADMIN/GESTAO + produto não classificado/MISTO)* formulário de classificação em lote
4. Tabela "Distribuição por tamanho (por cor)" — **1 bloco de tabela por cor do produto** (pode ser vários)
5. *(condicional)* aviso de quantidade em produção/trânsito
6. `GradeRecomendadaSection` — que por si só tem **2 subseções**, cada uma repetindo **1 bloco de tabela por cor** de novo: "Quantidade recomendada" (quando há sugestão > 0) e "Proporção observada de venda" (sempre que há venda)
7. *(condicional)* "Recomendação do motor de compras (por SKU)" — cards por `cod` Best Seller/Drop
8. `ExcessoDistribuicaoSection` — 4 mini-stats, até 3 avisos textuais condicionais, tabela de oportunidades de transferência, resumo de decisões já registradas

**Isto confirma literalmente a queixa do Rodrigo**: não é uma impressão — é a estrutura real do componente. Um produto com várias cores e com sinais em todas as seções opcionais pode chegar a mais de 10 blocos de tabela/cards empilhados num único scroll, sem nenhuma hierarquia visual (zonas, abas, colapso) separando "o que é este produto" de "o que fazer sobre ele".

**Redundância concreta encontrada**: os blocos 4 e 6 mostram, em essência, a mesma decomposição cor→tamanho do mesmo produto duas vezes, com números diferentes (estoque atual vs. venda observada) e vocabulário diferente — um usuário pode razoavelmente não perceber que são dois recortes da mesma coisa.

### 1.3 Outras telas relacionadas

- **`distribuicao-estoque/`** (Inteligência de Distribuição): usa um padrão de **4 abas na mesma página** via `aba-nav.tsx` (`visao-geral`, `movimentacoes`, `grade`, `historico`), estado no `searchParam` `aba` (comentário explícito no código: "pedido do Rodrigo, 2026-11-11: não criar módulo/rota separada"). **Esse padrão já existe no próprio código-base e evita exatamente o tipo de empilhamento que ocorre em Planejamento de Estoque** — é um fato observável sobre inconsistência de abordagem de UX entre módulos vizinhos do mesmo app, registrado aqui como achado, não como recomendação.
- **`mapa-compras/`**: usa `<details>/<summary>` (accordion nativo) para "Fila de revisão & Alertas" e "Avaliação de decisões de compra" — outra forma de evitar empilhamento vertical total, diferente da usada em Planejamento de Estoque.
- **`reposicao/`**: tabela por loja com 2 colunas novas aditivas do PR #111 — "Mínimo manual (empresa)" (via `MinimoManualInfo`, `sinais.tsx`) e "Transferência disponível" (via `TransferenciaInfo`). Confirmado em `sinais.tsx`: o texto inline do mínimo manual é `"mínimo manual: X un., atual: Y un., <NÍVEL>"` — o header da coluna diz "(empresa)", mas o texto da célula em si **não repete "empresa" junto de "atual: Y un."** dentro de uma tabela cujo contexto inteiro é por LOJA. Não é um bug (o cabeçalho desambigua), mas é exatamente o tipo de ponto cego que o Rodrigo pediu pra vigiar — risco de leitura rápida confundir "estoque da empresa toda" com "estoque desta loja", numa tela cujas outras colunas são todas por loja.
- **`estoque-minimo-manual/`**: tela nova (PR #110), texto introdutório explicita bem a diferença empresa×loja ("nunca avaliado loja a loja... Não é a mesma coisa que a aba 'Estoque Mínimo' existente"). Esta tela, isoladamente, **trata bem** o risco que o Rodrigo citou.
- **`estoque-minimo/`** (`StockMinimumRule`, por loja): tela mais antiga, independente, usa o mesmo substantivo "Estoque Mínimo" que a tela nova — confirmando a colisão de nome já documentada no doc de referência (§19.3 item 1).

---

## 2. Origem de dado de cada indicador — confiável vs. fraco/vazio

| Indicador/KPI | Vem de | Confiabilidade hoje (confirmado) |
|---|---|---|
| Estoque atual por posição | `StockSnapshot` (upsert, sem histórico) | Bom para "quanto tem agora" (2.681 cods reais); **zero série temporal** — cada sync sobrescreve |
| **Histórico diário real de estoque** | `StockSnapshotDiario` (**PR #116, mergeado hoje**, `prisma/schema.prisma:529`) | **Schema e ingestão existem, mas 0 linhas/0 dias confirmados no dev agora** — é tão novo que ainda não acumulou dado utilizável. Escrito só por `sync-runner.ts`/`upsert-stock.ts`; **nenhum consumidor em `src/lib/metrics` ou em qualquer tela ainda lê essa tabela** (confirmado por grep — zero resultado fora do pipeline de escrita). É a peça que resolveria o gap "sem idade de estoque" historicamente documentado (§4.4/§18 do doc de referência), mas hoje é potencial, não realidade — precisa de tempo de acúmulo e de um consumidor que ainda não existe |
| Classificação Best Seller/Drop | `ClassificacaoProduto.tipoCompra` | **Cobertura extremamente baixa e não reverificável hoje** (ver §0) — último número confiável (produção, 2026-11-18): 8 cods de 2.681 (0,3%). Mesma lição que o Rodrigo já tirou sobre esse campo nesta sessão — não tratar como indicador maduro |
| `dataLancamento` (`ClassificacaoProduto`) | manual, formulário de classificação | **0,04% de cobertura em produção (1 de 2.681 cods), confirmado em 2026-11-18** — gap real e já documentado 3 vezes no doc de referência (§17.3/§18.3). Há um PR aberto e ainda não mergeado (`feat/datalancamento-obrigatorio-20261119`, #115) tentando endurecer isso, mas **ainda não em produção** |
| `leadTimeDias` (`CoberturaMeta`) | manual, por grupo, tela `ParametrosGrupoForm` | **0 de 2 grupos cadastrados hoje no dev** (confirmado agora) — mesmo achado repetido desde §14.6 do doc, ainda verdadeiro |
| `leadTimeUrgenteDias` (`CoberturaMeta`) | manual, **PR #114, mergeado 2026-11-19** (não refletido no doc de referência, que ainda trata isso como "só proposta, zero código" em §13) | Campo existe e tem UI de cadastro (`forms.tsx`), mas **confirmado por comentário explícito no próprio código** (`compras-inteligencia.ts:1115-1118`): "só cadastro/exposição por ora — ainda não consumido por `calcularSugestaoBestSeller` nem por nenhum outro ponto da engine". É cadastro puro, sem nenhum efeito em nenhum cálculo — e 0 grupos o têm preenchido mesmo assim |
| Estoque mínimo manual por SKU (`EstoqueMinimoManual`) | manual, PR #110 | Mecanismo pronto e testado (12 testes), mas **0 linhas no dev hoje** — nenhum uso real capturado nesta consulta |
| `ProductionOrder.dataFinalizacaoProducao` | sync `/ordensproducao/produtos` | **Confiável quando preenchido**: 2.888/2.888 ordens `Finalizado` com a data preenchida (0 lacuna, confirmado hoje) — mas sem `storeId`, não serve para "idade do estoque numa loja" |
| Venda (`Sale`) | sync + backfill único (2025-09-24) | ~14 meses de histórico real, mas é a base para cobertura/velocidade — robusta para o que já é usada |
| `DecisaoCompra` | formulário `ConfirmarDecisaoForm` | **0 linhas hoje** — motor de avaliação retrospectiva (PR #106) correto e testado, mas sem nenhum dado real pra avaliar |
| `StockMinimumRule` | import manual (08/2026) + manutenção manual | 645 linhas hoje no dev (doc citava 1.275 em produção — divergência não investigada, não confirmo qual número é o real atual) |

**Padrão que se repete por toda a área**: o motor de cálculo (código) é, em geral, mais maduro do que o dado manual que ele depende de alguém preencher (`dataLancamento`, `leadTimeDias`, `leadTimeUrgenteDias`, classificação, mínimo manual) — a mesma lição que o Rodrigo já tirou sobre `ClassificacaoProduto.tipoCompra` se generaliza para quase todo campo opcional/manual desta área. Nenhum destes é "falso sucesso" escondido (o código é honesto sobre a ausência — nunca inventa número quando falta dado, confirmado em vários pontos: `leadTimeDias` ausente → reserva = 0, não null fantasiado; `ProductionOrder` insuficiente → `ATENCAO` não é calculado, cai em `NORMAL`), mas a cobertura real de dado continua baixa em quase todo campo que depende de alguém preencher manualmente.

---

## 3. Mapeamento de lógica (confirmado contra o código de hoje)

### 3.1 Risco de ruptura / estoque parado / cobertura — `diagnosticarVariante`

`src/lib/metrics/distribuicao-estoque.ts:94-109` (confirmado hoje, linha por linha):
```
estoqueAtual=0, vendas90=0  → "sem_dado"
estoqueAtual=0, vendas90>0  → "ruptura"
estoqueAtual>0, vendas90=0  → "estoque_parado"   ← incondicional, linha 106
coberturaDias==null         → "sem_dado"
coberturaDias < limiar      → "cobertura_critica"
...                          → "cobertura_excessiva" / "equilibrado"
```
É o motor de diagnóstico mais antigo e mais usado do sistema (distribuição inteira, Planejamento de Estoque, KPI nacional de estoque parado, filtro "Excesso" de Distribuição, o botão "Aprovar" de `movimentacoes.tsx`). **A linha 106 é incondicional e continua sem nenhuma distinção entre "produto recém-lançado, estação ainda não abriu" e "estoque genuinamente morto"** — confirmado hoje que nada mudou desde que o Rodrigo apontou isso (§17.3 do doc, 2026-11-18): `dataLancamento`, `statusComercial` e `colecao` continuam não usados por essa função (reconfirmado por grep nesta auditoria: zero ocorrência desses 3 campos em `distribuicao-estoque.ts`). Esta é a regra de maior impacto potencial e maior incerteza de toda a área — e também a mais claramente identificada como **decisão de negócio pendente**, não bug.

### 3.2 Excesso de estoque e distribuição entre unidades

`src/lib/metrics/planejamento-distribuicao.ts`: `getExcessosEDistribuicao` (linha 157), `aplicarRetencoes` (linha 96, função interna não exportada — reserva de continuidade de Best Seller via `leadTimeDias` real × velocidade própria da posição), `dropEmCicloAtivo` (linha 62, exportada). Confirmado hoje: a proteção de Drop ativo não depende de venda recente (só do ciclo — `statusComercial`/`dataEncerramentoPrevista`), e a reserva de Best Seller é parcial (não imunidade) — ambos consistentes com o que o doc de referência registra em §14/§15, sem sinal de regressão no código atual.

### 3.3 Cobertura

`sellthrough.ts`/`resolveSellThrough` (`estoque.ts:226-240`, não lido linha a linha nesta rodada — herdado do doc de referência) trata todo produto igual, sem conceito Best Seller/Drop; cobertura usada em Planejamento de Estoque é estoque÷velocidade 90 dias, com limiar de 14 dias de histórico mínimo (`MIN_DIAS_HISTORICO_CONFIAVEL`, `planejamento-estoque.ts:21`, confirmado hoje).

### 3.4 Grade recomendada

`src/lib/metrics/planejamento-grade.ts`: decompõe produto→cor→tamanho em 2 passadas, pesada por venda real de cada cor/tamanho (não reaproveita `getTamanhoBreakdown`, que mistura cor — risco já documentado e evitado de propósito). Alimenta `GradeRecomendadaSection` (ver §1.2) com 2 saídas: quantidade sugerida (rara — quase nenhum produto classificado tem `quantidadeSugerida > 0` hoje) e proporção observada (sempre presente quando há venda). `getRecomendacaoGradeProduto` não tinha nenhuma tela consumidora até o PR #111 — hoje tem exatamente 1 (este painel).

### 3.5 Movimentação entre unidades / decisões

`DecisaoMovimentacaoEstoque` (ciclo PENDENTE→APROVADA→EXECUTADA/RECUSADA, UI em `distribuicao-estoque/historico.tsx`) é o motor mais maduro em termos de ciclo de decisão formal — mas **marcar "executada" não debita/credita `StockSnapshot`** (o estoque real só muda no próximo sync, de forma independente) — herdado do doc, não reverificado linha a linha nesta rodada, mas é uma afirmação de arquitetura (não de dado) que não tem motivo pra ter mudado.

### 3.6 Recomendação de compra

`compras-inteligencia.ts`: `calcularSugestaoBestSeller` soma `leadTimeDias` (não `leadTimeUrgenteDias`, confirmado por grep hoje) ao horizonte de cobertura; quando ausente, avisa explicitamente em vez de inventar prazo (linha 87-90, confirmado hoje). `getRecomendacoesDrop` usa `dropEmCicloAtivo` desde o PR #109 (Drop encerrado nunca recebe sugestão positiva).

---

## 4. Classificação de maturidade

**Totalmente implementada e funcionando com dado real:**
- Posição comercial/estoque atual por loja/CD (`getPosicoesEstoque`, `StockSnapshot`) — 2.681 cods reais.
- `diagnosticarVariante`/motor de distribuição (`construirOrigem`, `prepararOrigens`) — maduro, testado, usado por toda a área, mas com o gap conhecido da §3.1.
- Proteção de Drop ativo e reserva (não imunidade) de Best Seller em excesso/distribuição — testado e confirmado sem regressão.
- Cobertura/velocidade de venda por posição (sem dupla contagem, query bruta independente) — padrão replicado e correto em todos os pontos verificados.
- Ciclo de decisão de movimentação (`DecisaoMovimentacaoEstoque`) como mecanismo — maduro como ciclo, mas sem elo automático com o estoque real pós-execução.

**Implementada mas com dado fraco ou vazio (código correto, população real baixa/zero):**
- Classificação Best Seller/Drop (`ClassificacaoProduto.tipoCompra`) — 8/2.681 cods em produção (dado de 5 dias atrás, não reverificável hoje).
- `dataLancamento` — 0,04% de cobertura.
- `leadTimeDias`/`leadTimeUrgenteDias` (`CoberturaMeta`) — 0 de 2 grupos cadastrados.
- `EstoqueMinimoManual` — mecanismo completo e testado, 0 linhas de uso real (no dev).
- `DecisaoCompra`/avaliação retrospectiva — motor correto, 0 decisões reais pra avaliar.
- Grade recomendada com quantidade positiva — a parte "proporção observada" tem dado real; a parte "quantidade sugerida" quase nunca aparece (porque a classificação de origem é rara).

**Só existe visualmente / não conectada / morta:**
- Nenhum achado de UI claramente "mock" foi encontrado nesta rodada — diferente do caso de `ClassificacaoProduto`, não há indicador nesta área que simule dado. O mais próximo disso é `leadTimeUrgenteDias`: tem formulário de cadastro real, mas **zero efeito em qualquer cálculo** (literalmente cadastro sem consumidor) — na prática funciona como um campo "de fachada" até que alguém ligue o consumo no motor.
- `StockSnapshotDiario`: escrita real (não mock), mas **zero consumidor** e **zero dado acumulado ainda** — mais perto de "infraestrutura pronta, funcionalidade ainda não iniciada" do que "placeholder".

**Parcialmente implementada:**
- Lead time urgente vs. normal: schema + cadastro prontos (PR #114), motor de cálculo não usa ainda.
- Grão de classificação produto+cor (PR #117): migration já rodada no dev (tabela vazia), código consumidor ainda não — e o PR está **aberto**, não mergeado em `main`.
- `dataLancamento` obrigatório (PR #115): aberto, não mergeado.
- Integração mínimo manual + transferência disponível na tela de Reposição (PR #111): implementada e com sinal correto, mas depende de `ClassificacaoProduto`/`EstoqueMinimoManual` que hoje têm população quase nula — o sinal existe, mas quase nunca dispara com dado real ainda.

---

## 5. Problemas reais de UX

1. **Empilhamento vertical confirmado no painel de detalhe do Planejamento de Estoque** (`produto-detalhe.tsx`) — até 8 blocos fixos, sem abas/zonas/colapso, incluindo repetição de decomposição cor→tamanho em 2 lugares diferentes (seção "Distribuição por tamanho" e seção "Proporção observada" dentro da grade). Esta é a queixa literal do Rodrigo, confirmada no código, não só na percepção.
2. **"Estoque mínimo" significa 2 coisas diferentes, mesmo substantivo, 2 telas sem link entre elas** (`StockMinimumRule` por loja vs. `EstoqueMinimoManual` por empresa) — mitigado parcialmente por texto explicativo em cada tela, mas sem nenhuma navegação cruzada.
3. **Excesso/ruptura com 3 definições paralelas** entre `cobertura` (limiares fixos), `distribuicao-estoque`/`diagnosticarVariante` (fonte "oficial") e `planejamento-estoque`/`planejamento-distribuicao` (reaproveita a segunda, com retenções adicionais) — um produto pode aparecer "Excesso" numa tela e "Equilibrado" em outra sem explicação visível na UI (só em comentário de código). Herdado do doc de referência (§19.1), não reverificado produto a produto nesta rodada, mas a estrutura de código que causa isso continua presente.
4. **Grade por tamanho calculada em pontos independentes** (`planejamento-grade.ts` vs. `getTamanhoBreakdown` em `estoque.ts`, usado no Mapa de Compras) — risco documentado de mistura de cor no segundo, que `planejamento-grade.ts` evitou de propósito.
5. **Risco explícito que o Rodrigo pediu pra vigiar (estoque total da empresa × disponibilidade numa loja) tem 1 ponto de atenção real**: a coluna "Mínimo manual (empresa)" na tela de Reposição (por loja) mostra `estoqueConsolidado` com o texto "atual: X un." sem repetir "(empresa)" na própria célula — o cabeçalho da coluna desambigua, mas a frase isolada, numa tabela cujo resto do contexto é por loja, é o tipo exato de ponto cego citado. Não é um bug (nenhum cálculo usa o número errado — confirmado, `estoqueConsolidado` é lido, não recalculado localmente), é um risco de leitura.
6. **Inconsistência de padrão de UI entre módulos vizinhos**: Distribuição de Estoque usa abas (`AbaNav`) e Mapa de Compras usa `<details>/<summary>` para evitar empilhamento total; Planejamento de Estoque não usa nenhum dos dois — é o único dos três módulos de "inteligência" da área que empilha tudo verticalmente sem nenhuma divisão.
7. **Indicadores com alta chance de confundir "recém-lançado" com "morto"** (§3.1) — não é um problema de UI isoladamente, mas o resultado (um produto "Alto Verão" aparecendo como "estoque parado"/candidato a transferência/liquidação) é visível em pelo menos 3 telas (Planejamento de Estoque, Distribuição, filtro "Excesso") sem nenhum aviso visual de que o diagnóstico pode estar errado por essa razão específica — o único aviso existente (`demandaPossivelmenteMascarada`) cobre ruptura, não excesso/parado.

---

## 6. Painel consolidado de reposição Best Seller (empresa toda) — verificado, **não iniciado**

Conferido hoje: `gh pr list --state all --search "reposicao-bestseller"` não retornou nenhum resultado. O worktree dedicado (`C:\Users\Dell\Projects\tvb-dashboard-reposicao-bestseller-consolidada`, branch `feat/reposicao-bestseller-consolidada-20261123`) existe, mas está **exatamente na ponta de `origin/main`** — 0 commits próprios, 0 arquivos modificados (`git status` limpo, `git log main..HEAD` vazio). Não há nenhum código, diff ou PR para descrever.

**O que isso significa pra esta auditoria**: não há nada ainda para avaliar como "candidato de funcionalidade para Zona 1/Zona 3" — a tarefa está, no máximo, no estado de intenção registrada (branch criada), sem nenhum trabalho real. Vale apenas registrar, como já sabido por memória de sessão, que a motivação dessa tarefa paralela é usar `colecao === "BESTSELLER"` como fonte alternativa de Best Seller (mais populada que `ClassificacaoProduto.tipoCompra`, que tem só 8 cods) — mas isso é uma intenção relatada, não uma implementação verificável nesta auditoria. Se essa tarefa avançar antes da Fase 2/3 desta reformulação, vale reconferir o PR real quando existir.

---

## 7. O que ficou fora do escopo desta auditoria (declarado, não escondido)

- Não reverifiquei linha a linha toda a lógica de `compras-inteligencia.ts`/`distribuicao-estoque.ts` (são os dois arquivos mais extensos e já mais auditados/testados do projeto — amostrei os pontos de maior risco, não tudo).
- Não roda a suíte de testes completa (`npx vitest run`) nesta rodada — não era necessário para um diagnóstico de dado/UX, e rodar a suíte inteira não valida nada sobre dado real ou UX.
- Não confirmei o número real de `StockMinimumRule` em produção (645 no dev vs. 1.275 citado no doc para produção) — fica como divergência registrada, não resolvida.
- Não investiguei se produção já tem alguma linha em `EstoqueMinimoManual`/`DecisaoMovimentacaoEstoque` desde o clone do dev — tocar produção está fora da autorização desta tarefa.
