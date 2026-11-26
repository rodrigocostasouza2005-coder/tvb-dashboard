# Auditoria — Pesquisa e Marketing (2026-11-26)

**Status:** auditoria concluída (somente leitura, nenhum código/dado alterado). Testes existentes rodados (`npx vitest run`), produção consultada via logs reais de GitHub Actions (nunca via acesso direto ao banco de produção), dev DB usada só para verificações estruturais (sem dado de prospecção real — branch separada).

**Escopo:** abas do grupo "Pesquisa" e sub-abas de "Marketing" ainda não cobertas pelas auditorias anteriores (Vendas, Estoque, Atacado, Black Friday, Performance, Planejamento de Estoque, e a auditoria de identidade/segurança do Marketing de 2026-11-25).

---

## 0. Correção de premissa antes de tudo

O pedido partia da hipótese de que a aba **"Pesquisa"** (`/dashboard/pesquisa`) seria a tela do motor de prospecção comercial (`src/lib/prospeccao/`, `scripts/prospeccao/`). **Isso não é verdade** — confirmado lendo `src/app/dashboard/pesquisa/page.tsx` e `src/lib/tabs.ts`:

- `/dashboard/pesquisa` é uma ferramenta de **busca de produto/cliente** (nome, tamanho) com sell-through e quebra por loja — não tem nenhuma importação de `src/lib/prospeccao/*`.
- O motor de prospecção comercial real vive em **`/dashboard/atacado-prospeccao`** (grupo `atacado`, não `marketing`/`pesquisa`), já auditado em `docs/auditoria-prospeccao-qualidade-painel-2026-11-12.md`.

Como o achado histórico citado no pedido ("500/500 nunca passaram pela pesquisa comercial real") é exatamente sobre esse motor, decidi verificar o estado atual dele mesmo estando fora do grupo "Pesquisa" — ver seção 2. A aba `/dashboard/pesquisa` em si foi auditada separadamente na seção 1.

---

## 1. Aba "Pesquisa" (`/dashboard/pesquisa`) — busca de produto/cliente

### 1.1 CONFIRMADO — "Vendido no período" é bruto, sem aviso, inconsistente com Top 10

A coluna "Vendido no período" da tabela de Pesquisa (`pesquisa-table.tsx`) vem de `searchStockVsSalesComTamanhos` → `getStockVsSales` (`src/lib/metrics/estoque.ts:333-414`). Essa função soma `Sale.quantidade` via `getSalesByDimension` e **nunca chama `getReturnsByDimension` nem desconta devolução** — é bruto de verdade.

Comparando com o `/dashboard/marketing` (mesma função, mesmo dado): lá a coluna equivalente é **rotulada explicitamente "Vendido (bruto)"** (`src/app/dashboard/marketing/page.tsx:110`). Na Pesquisa, a coluna é só **"Vendido no período"**, sem qualificação — indistinguível visualmente de uma métrica líquida.

Isso quebra consistência com o resto do Radar: Top 10 Mais/Menos Vendidos foi corrigido em 2026-08-24 (pedido do Rodrigo) especificamente para **descontar devolução** porque bruto estava distorcendo o ranking. A Pesquisa nunca recebeu a mesma correção e nem avisa que o número ali é bruto. Um usuário comparando o "vendido" de um produto entre Pesquisa e Top 10 Mais Vendidos no mesmo período pode ver números diferentes sem entender por quê.

**Evidência:** `src/lib/metrics/estoque.ts:333-414` (função `getStockVsSalesUncached`, sem chamada a `getReturnsByDimension`); `src/app/dashboard/pesquisa/pesquisa-table.tsx:70-71` (header sem qualificador); `src/app/dashboard/marketing/page.tsx:110` (mesmo dado, rotulado "(bruto)" lá).

### 1.2 Sell-through / filtros — sem achados

O tooltip do sell-through (`sellThroughTooltip` em `pesquisa-table.tsx`) já é explícito sobre ser "empresa toda, histórico completo" — comportamento documentado e intencional (Rodrigo pediu isso em 2026-08-10/08-12). A liberação de todas as lojas na busca (sem respeitar `allowedStores`) também é decisão explícita do Rodrigo (2026-09-03), documentada no código. Nenhum achado aqui.

---

## 2. Motor de prospecção comercial (`atacado-prospeccao`) — acompanhamento do achado anterior

Fora do escopo original ("Pesquisa"), mas é o destino real do achado histórico citado no pedido. Consultei via `gh run view <id> --log` os runs reais do workflow `diagnostico-prospeccao.yml` (execução contra produção, script somente-leitura `scripts/prospeccao/diagnostico-base.ts`) — não acessei o banco de produção diretamente.

### 2.1 CONFIRMADO — parcialmente corrigido desde 2026-11-12, não resolvido

Run mais recente disponível (`2026-11-24T20:31`, run `45481492307`):

| Métrica | 2026-11-12 (auditoria anterior) | 2026-11-24 (run real) |
|---|---|---|
| Total prospectos | 500 | 500 |
| `statusComercial` EM_INVESTIGACAO | 500 (100%) | 440 (88%) |
| `statusComercial` REPROVADO | 0 | **60 (12%)** |
| Pesquisados com evidência REAL (`resultadoEliminacao` preenchido) | 0 | **60** |
| APROVADO_GATE (passou pro estágio de pontuação) | 0 | **0** |
| Ainda sem pesquisa real (`confiancaPesquisa=CADASTRAL`, pendente) | 487 | **427 (85,4%)** |
| Eventos de busca bloqueada (anti-bot) | não medido | 677 (427 prospects distintos) |
| Sinais de duplicata (nome+município) | 74 / 574 ocorrências | **74 / 574 ocorrências (sem mudança)** |

O motor **passou a rodar de verdade** para uma fração real (60 de 500, via `agente-pesquisa-comercial.ts`, workflow `pesquisa-comercial-web.yml` com dezenas de execuções entre 24/11 19h-20h). Não é mais "0 de 500 nunca pesquisado" como em 12/11. Mas a maioria (427/500, 85%) continua travada no mesmo bloqueio já documentado desde a auditoria anterior: busca via DuckDuckGo bloqueada por anti-bot em infraestrutura de nuvem, sem fallback de domínio de e-mail/site cadastrado disponível para esses registros.

Verifiquei o código (`scripts/prospeccao/agente-pesquisa-comercial.ts:161-191`) para confirmar que o bloqueio **não está gerando falso REPROVADO**: quando a busca é bloqueada e nenhuma página real é examinada, o código deliberadamente só avança `pesquisadoEm` (checkpoint) e grava uma `AtacadoProspectActivity` tipo `PESQUISA_COMERCIAL_BLOQUEADA` — nunca toca `statusComercial`/`confiancaPesquisa`/`resultadoEliminacao`. Isso é o comportamento correto e documentado (comentário no próprio arquivo, linhas 162-171) — não é um bug novo, é a proteção que já existia funcionando como esperado.

Os 60 REPROVADO têm 100% `resultadoEliminacao="REPROVADO" → Inadequado` (0 por cadastro inválido, 0 `APROVADO_GATE`) — ou seja, toda vez que o motor conseguiu examinar uma página real até agora, reprovou. Amostra pequena (12% da base) para afirmar se isso é um padrão real do mercado-alvo ou se há algo na régua de eliminação valendo revisão — não dá para confirmar nem negar com o dado disponível; registro como observação, não como achado.

**Duplicidade:** os mesmos 74 prospectos / 574 ocorrências de 12/11 continuam idênticos em 24/11 — nenhuma ação de limpeza foi tomada entre as duas datas (consistente com a pendência nº2 já registrada na auditoria anterior).

---

## 3. Top 10 Mais Vendidos / Menos Vendidos

### 3.1 Dedução de devolução — correto

Ambas as páginas (`top-mais-vendidos/page.tsx`, `top-menos-vendidos/page.tsx`) usam `netByReturns(getSalesByGrupoProduto(filters), getReturnsByGrupoProduto(filters))`. As duas funções de origem já usam a **chave composta `${grupo}::${produto}`** (corrigida em auditoria 2026-11-25, coberta por `src/lib/metrics/__tests__/colisaoIdentidadeGrupoProduto.test.ts`, 3 testes passando) — não há mais mistura de devolução entre produtos de grupos diferentes com o mesmo nome aqui. Dedução de devolução confirmada correta nos dois rankings.

### 3.2 CONFIRMADO — "Top Mais Vendidos" ranqueia por receita mesmo quando rotulado "por unidades"

`src/app/dashboard/top-mais-vendidos/page.tsx:42-61`:

```ts
const allRows = netByReturns(allRowsBrutas, returns).sort((a, b) => b.revenue - a.revenue);
...
const top = allRows.slice(0, LIMIT); // SEMPRE os top 10 por receita, mesmo sem showFinancials
```

O título da seção já troca de texto conforme `showFinancials` ("por receita líquida" vs. "por unidades líquidas" — linha 79), mas o **conjunto dos 10 produtos e a ordem exibida nunca mudam** — são sempre os 10 maiores por receita. Para um usuário sem `canSeeFinancials`, a tela diz "Top 10 produtos por unidades líquidas" mas na prática mostra o Top 10 por receita, só troca qual valor aparece na barra do gráfico. Pode haver produto que vendeu muitas unidades a preço baixo e ficaria fora do Top 10 real por unidades, enquanto um produto caro de baixo volume ocupa a vaga.

`top-menos-vendidos/page.tsx` **não tem esse problema** — ordena por `unitsSold` ascendente sem nenhuma dependência de `showFinancials` (linhas 42-54).

**Impacto real confirmado:** consultei a dev DB (13 usuários) — 4 contas têm `canSeeFinancials=false`: `leblon@`, `barra@`, `riosul@`, `atendimento@tvbshorts.com` (todas `VENDEDOR`, logins de loja física/atendimento). São exatamente essas contas que veem o ranking errado hoje.

---

## 4. Templates de Mensagem (`marketing-templates`)

### 4.1 Validação de placeholder — sem achado de quebra

`renderTemplate` (`src/lib/message-templates.ts:135-137`) usa `texto.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "")` — qualquer placeholder sem valor correspondente vira string vazia, nunca lança erro nem deixa `{chave}` literal na mensagem. Testado manualmente contra os 3 pontos de chamada reais (`clientes/page.tsx`, `clientes-sugestoes-contato/page.tsx` × 2) — todos passam exatamente os placeholders que o template default espera.

### 4.2 XSS — não encontrado

Varredura em todo `src/` por `dangerouslySetInnerHTML`: **zero ocorrências no projeto inteiro**. A mensagem renderizada só chega ao navegador por dois caminhos, nenhum deles vulnerável:
- `href` de link `wa.me`/`whatsapp://` via `waHref`/`waAppHref` (`src/lib/whatsapp.ts`) — sempre com `encodeURIComponent(mensagem)`.
- Texto dentro de nó JSX (`{mensagem}`/`<pre>{texto}</pre>` em `marketing-templates/page.tsx`) — React escapa automaticamente.

Mesmo um nome de cliente com `<script>`, aspas ou `{`/`}` no meio não gera injeção nem quebra o parsing do placeholder (o valor substituído nunca é re-escaneado pela regex).

### 4.3 CONFIRMADO — zero teste dedicado

Não existe nenhum arquivo de teste para `src/lib/message-templates.ts` em todo o repositório (busca por `renderTemplate`/`message-templates` em `*.test.ts(x)` não retornou nada). A lógica é simples e o comportamento manual confirmado é seguro (seções 4.1/4.2), mas não há cobertura automatizada que garanta isso continue assim em mudanças futuras.

### 4.4 Permissão de edição — correta

`salvarTemplateAction`/`restaurarPadraoAction`/`limparTemplateAction` (`actions.ts`) checam `requireGestao()` (ADMIN/GESTAO) independentemente do controle de aba — defesa em profundidade adequada, não depende só de `allowedTabs`.

---

## 5. CAC (`/dashboard/marketing`)

### 5.1 Correção de premissa

O pedido assumia que `/dashboard/marketing` mostra CAC. **Não mostra.** O código da página (`src/app/dashboard/marketing/page.tsx:146-148`) termina com a frase explícita: *"Outras métricas de marketing (campanhas, CAC etc) ainda não estão conectadas."* O conteúdo real da página é só o ranking de "estoque parado" (`currentStock − unitsSold`, bruto, corretamente rotulado).

O módulo `src/lib/metrics/cac.ts` **existe, é robusto e está testado** (26 testes em `cac.test.ts` + 2 em `cac.contract.test.ts`, todos passando) — mas o contrato (`cac.contract.test.ts:5-8`) já documenta que seu único consumidor pretendido é a **Central Black Friday** (`/dashboard/black-friday`), não o Marketing. Confirmado por busca de uso: `getCacEcommerce`/`getCacEvolucaoMensal` só aparecem importados em `src/app/dashboard/black-friday/page.tsx`.

**Risco a observar (não é bug, é um gap estrutural):** a Central Black Friday é descrita no próprio `tabs.ts` como painel "temporário pro período". Se/quando ela for desativada, o CAC perde seu único lugar de exibição no Radar — hoje não existe nenhum caminho permanente (fora do Black Friday) para ver CAC no dashboard.

### 5.2 Fórmula — correta e com limitações já disclosed

- **"Novos clientes" exclui recompra corretamente:** `getNovosCompradoresEcommerce` (`cac.ts:83-142`) classifica como "novo" só quem teve a **1ª compra GLOBAL** (qualquer loja/canal da empresa, não só e-commerce) dentro do período filtrado; quem já tinha `first < from` conta como recorrente e fica fora do denominador. Decisão deliberada e documentada (comentário linhas 74-82): evita subestimar o CAC tratando migração de canal como aquisição nova.
- **Investimento não soma múltiplas fontes — é só Meta Ads, de propósito e com aviso.** `getInvestimentoAquisicao` soma só `getInsightsPorConjunto` (Meta Ads). Não há risco de dupla contagem porque não há segunda fonte somada. O próprio módulo documenta isso como limitação conhecida (`RESUMO DE CONFIABILIDADE`, item 4: "não inclui Google Ads, influencer, SEO pago ou qualquer outro canal") — undercount, não duplicação, e já é avisado via `confiavel: false` + `motivoLimitacao` sempre presentes no retorno.
- `getCacPorCampanha()` é explicitamente não implementado (sem `utm_campaign`/`click_id` em `Sale`) — decisão documentada, testada (`cac.contract.test.ts`), não inventa atribuição.

Nenhum achado de cálculo incorreto aqui — é o módulo mais bem documentado e testado de todo o escopo desta auditoria.

---

## 6. Analytics do Site (`analytics-site`) — conversão/funil/atribuição

(Fora de escopo, por pedido explícito: token do Meta Ads e vazamento financeiro já corrigidos em 2026-11-25 — não revisitados aqui.)

### 6.1 CONFIRMADO — funil de compra usa contagem bruta de evento, pode produzir conversão >100% entre etapas

`getFunilCompra` (`src/lib/connectors/google-analytics.ts:333-362`) busca `eventCount` (contagem total de disparos do evento no GA4) para `view_item/add_to_cart/begin_checkout/add_payment_info/purchase` e calcula `pctDoAnterior = eventos_etapa / eventos_etapa_anterior * 100` direto, sem nenhum clamp.

`eventCount` **não é usuário/sessão única** — é a soma de todos os disparos do evento. Em e-commerce é comum `add_to_cart` disparar mais de uma vez por sessão (cliente adiciona 2+ itens, ou adiciona/remove/adiciona de novo) sem um `view_item` correspondente a cada disparo. Isso pode fazer uma etapa posterior do funil ter **mais** eventos que a etapa anterior — o que é logicamente impossível num funil de verdade (que deveria ser monotonicamente decrescente), mas é matematicamente possível aqui porque a métrica usada não impõe isso.

Na UI (`src/app/dashboard/analytics-site/page.tsx:524-531`), a largura da barra usa `Math.max(f.pctDoInicio ?? 0, 3)` — só garante um mínimo visual de 3%, **nunca limita o máximo** a 100%. Se `pctDoAnterior`/`pctDoInicio` passar de 100%, a barra fica com `width` acima do contêiner (estoura visualmente) e o número exibido (ex.: "134%") não faz sentido como taxa de conversão.

**Sem teste cobrindo esse caso:** os dois testes de `getFunilCompra` em `google-analytics.test.ts` (linhas 78-115) usam só dados sintéticos monotonicamente decrescentes (1000→400→200→150→100) — nenhum cenário com uma etapa maior que a anterior. O caso real mais provável de disparar o problema nunca foi exercitado.

**O que seria necessário para corrigir:** trocar `eventCount` por uma métrica de usuário/sessão única por etapa (ex.: `activeUsers` com filtro de evento, ou a API de Funnel Exploration dedicada do GA4) — mudança de métrica, fora do escopo desta auditoria (só investigação).

### 6.2 SUSPEITA — "Taxa de conversão" do topo pode não corresponder à etapa "Comprou" do funil

`getConversoes` usa a métrica genérica `conversions` do GA4 (`google-analytics.ts:95-107`) para o stat tile "Conversões"/"Taxa de conversão" no topo da página. Essa métrica reflete qualquer evento marcado como "key event" na configuração da propriedade GA4 — não necessariamente só `purchase`. Não há no código nenhuma garantia nem checagem de que a propriedade GA4 da TVB tem *apenas* `purchase` marcado como key event. Se houver outro key event configurado (ex.: `generate_lead`, cadastro de newsletter), a "Taxa de conversão" do topo e o degrau final "Comprou" do funil abaixo estariam medindo coisas diferentes, sem nenhum aviso na tela de que podem não ser comparáveis. Não dá para confirmar nem refutar isso só pelo código — fica como suspeita a verificar na configuração real da propriedade GA4 (fora do alcance desta auditoria, que foi só leitura de código + logs).

---

## 7. Resumo de achados

| # | Achado | Classificação | Área | Severidade |
|---|---|---|---|---|
| 1 | "Pesquisa" não é a tela de prospecção (premissa do pedido errada) | Esclarecimento | Pesquisa | — |
| 2 | Motor de prospecção: 60/500 (12%) já roda de verdade, 427/500 (85%) ainda bloqueado por anti-bot; duplicidade (74/574) sem nenhuma ação desde 12/11 | Confirmado | Atacado→Prospecção | Alta (mas já era conhecida, progresso parcial real) |
| 3 | Pesquisa: "Vendido no período" é bruto sem aviso, inconsistente com Top 10 (líquido) | Confirmado | Pesquisa | Média |
| 4 | Top Mais Vendidos ranqueia por receita mesmo quando rotulado "por unidades" (sem `canSeeFinancials`) | Confirmado, afeta 4 contas reais hoje (lojas físicas) | Marketing | Média |
| 5 | Zero teste para `message-templates.ts`; XSS/validação de placeholder checados manualmente e OK | Confirmado (gap de teste) / Não-achado (seguro) | Marketing | Baixa |
| 6 | CAC não aparece em `/dashboard/marketing` (só na Central Black Friday, temporária); fórmula correta e bem documentada | Esclarecimento + risco estrutural futuro | Marketing | Baixa/estrutural |
| 7 | Funil de conversão usa `eventCount` bruto, pode exceder 100% entre etapas; sem teste cobrindo cenário não-monotônico | Confirmado | Analytics do Site | Média |
| 8 | "Taxa de conversão" do topo pode não bater com o degrau "Comprou" do funil, dependendo da config do GA4 | Suspeita (não verificável só por código) | Analytics do Site | Baixa |

## Resumo de uma frase

A aba Pesquisa não é a tela de prospecção (é busca de produto/cliente, e mostra vendido bruto sem avisar); o motor de prospecção de verdade evoluiu de 0% para 12% de cobertura real desde a última auditoria mas ainda trava em 85% por bloqueio de busca; Top Mais Vendidos mostra ranking por receita rotulado como "por unidades" pras 4 contas de loja física sem visão financeira; CAC está correto e bem testado mas só existe dentro do painel temporário de Black Friday; e o funil de conversão do site pode exibir taxas acima de 100% porque usa contagem bruta de evento em vez de sessão única — nenhum desses é um bug de segurança, todos são de cálculo/exibição.
