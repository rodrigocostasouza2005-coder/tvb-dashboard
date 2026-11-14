# Auditoria Geral e Roadmap — TVB Radar

**Data da auditoria:** 2026-11-14
**HEAD de `main` no momento:** `4296539` (pós-PR #94)
**Regime:** investigação 100% somente-leitura (6 agentes paralelos). Nenhum arquivo foi alterado, nenhum commit, nenhuma escrita em banco de produção, nenhum script de sync/backfill real executado.
**Como ler este documento:** cada afirmação é marcada implicitamente como fato verificado em código/histórico, salvo quando dito "hipótese" ou "não verificado". Este documento substitui a necessidade de reler todas as auditorias anteriores do zero — mas não substitui verificação pontual antes de agir sobre um achado específico, já que o código muda rápido neste projeto.

---

## 1. Resumo executivo

O TVB Radar é um dashboard de gestão interno (Next.js 16 + React 19 + Prisma 6/Postgres) que já cobre, de ponta a ponta e com dados reais (não mockados), a maior parte da operação: vendas, clientes/CRM, estoque, distribuição entre lojas/CD, Black Friday, marketing (GA4 + Meta Ads reais), prospecção B2B de atacado e administração de acessos. O projeto tem uma cultura de engenharia disciplinada — testes (629 testes unitários passando, `tsc`/`lint` limpos), decisões de negócio documentadas no próprio código (comentários que explicam o "porquê", não só o "o quê"), e um padrão recorrente de "investigar com script temporário somente-leitura, confirmar causa raiz, só então corrigir" nas últimas semanas.

Ao mesmo tempo, a auditoria confirmou que **dois problemas estruturais de dados seguem sem correção real**, apesar de bem diagnosticados: (1) o canal CD/Atacado grava vendas e devoluções em espaços de ID incompatíveis, inflando faturamento líquido e KPIs de cliente; (2) o pipeline de deploy nunca roda `prisma migrate deploy`, já causou 2 incidentes reais de produção e depende de rotas de migration ad hoc por feature. Também há bastante trabalho real e não aproveitado perdido em worktrees paralelas (duas features completas nunca chegaram a PR; uma base de planejamento de estoque por tamanho existe mas está desatualizada).

A próxima grande fronteira pedida pelo Rodrigo — planejamento de estoque (o quê/quanto/quando comprar, por tamanho, com lead time de 60 dias) — tem fundação parcial real no código (classificação Best Seller/Drop, núcleo de tamanhos 38-44, lead time por grupo), mas carece de 4 peças centrais: ligação entre sell-through e reposição de best-seller, detecção de sobra recorrente por tamanho, avaliação retrospectiva de decisões de compra, e integração entre os dois motores de "saúde de estoque" (compras-inteligência × distribuição) que hoje não se falam.

## 2. Nota de maturidade: **7/10**

**Por quê não é mais alto:** dois problemas de dado financeiro confirmados e não corrigidos (faturamento negativo + KPIs de cliente inflados) são graves porque são números que informam decisão, não falhas visuais; a ausência de migration automatizada já causou incidentes reais em produção; e a cobertura de teste e2e é mínima (3 de ~45 módulos).

**Por quê não é mais baixo:** a base é genuinamente sólida — zero mock/stub real encontrado em ~40 dos ~45 módulos auditados, integrações externas (GA4, Meta Ads, DAPIC) são chamadas reais e bem tratadas (erros isolados, não derrubam a página), autenticação e autorização são feitas no servidor (não só esconder botão na UI), o histórico de PRs mostra disciplina de diagnosticar antes de corrigir, e os bugs mais graves de falso-sucesso de sync já foram fechados nos pontos principais (PRs #81/82/83).

## 3. Mapa completo dos módulos

### 3.1 Maduros e corretos (baixa prioridade de intervenção)
Vendas, Vendedores, Análise de Vendas, Indicadores (exceto N+1, ver §6), Performance/Análise de Performance (dado manual por decisão de produto, documentado), Resumo do Dia, Inadimplência, Black Friday (sem stubs, tratamento de erro exemplar), Curva ABC, Curva de Vida da Coleção, Envelhecimento, Custo por Família, Análises de Promoção, Brindes, Top Mais/Menos Vendidos, Marketing-Templates, Export (aniversariantes), Admin (gestão de usuário/permissão).

### 3.2 Funcionam, mas com problema real de dado (prioridade alta)
- **Clientes / Clientes-Ficha / Top 5 clientes em Vendas**: KPIs "líquidos" (receita, ticket, unidades) inflados para clientes do canal CD/Atacado porque a devolução (`Return`, via `/vendaspdv`) não casa com a venda original (`Sale`, via `/faturas`) — mesmo espaço de `Id` nunca coincide. **Achado novo desta auditoria** (não documentado em memória anterior), mesma causa raiz do faturamento líquido negativo já conhecido.
- **Notas Fiscais (dentro de Clientes-Ficha)**: selo "com devolução parcial/total" usa o mesmo JOIN quebrado — pode mostrar "sem devolução" em nota que teve devolução real.
- **Mapa de Compras / Distribuição de Estoque**: sell-through de Drop estruturalmente vazio (achado antigo, reconfirmado); os dois motores (`compras-inteligencia.ts` e `distribuicao-estoque.ts`) nunca se importam um ao outro.

### 3.3 Funcionam, mas com nota/texto desatualizado (prioridade baixa/média)
- `/dashboard/marketing`: texto diz "campanhas/CAC ainda não conectadas" — já estão, só migraram para outras abas (Analytics do Site, Black Friday). Confunde navegação.
- `/dashboard/envelhecimento`: texto fala em "sync recente" — já são ~3 meses de histórico.

### 3.4 Decisões de produto deliberadas (não são bugs)
- `getGrupoRestriction` desativada a pedido do Rodrigo (09/2026), mecanismo preservado no código para reativação futura.
- Performance Score combinado avaliado e **não implementado** por falta de volume de dado — decisão registrada no próprio código, não esquecimento.
- Atacado excluído da aba Black Friday por pedido explícito.
- CNAE nunca é prova de revenda na prospecção B2B — só filtro de descoberta.

### 3.5 Integrações externas — confirmado reais, não simuladas
- **Google Analytics 4**: `BetaAnalyticsDataClient` oficial, conta de serviço, testado contra a propriedade real em 09/2026. **Env vars `GA4_PROPERTY_ID`/`GA4_SERVICE_ACCOUNT_KEY` ausentes no `.env.local` de dev — confirmar se estão de fato setadas em produção (Vercel).**
- **Meta Ads**: HTTP direto à Graph API, ROAS vem do `purchase_roas` calculado pelo próprio Meta via pixel. Pendência histórica (09/2026) de token de 60 dias sem confirmação posterior encontrada — vale confirmar operacionalmente.
- **DAPIC**: fonte de tudo (vendas, estoque, faturas, armazéns, produção, parcelas), via `sync-runner.ts` (1950 linhas) com locks e self-heal.

## 4. Situação dos coletores e confiabilidade dos dados

### (a) Resolvido e comprovado no código atual
- PR #81: estoque vazio (`/armazenadores/produtos`) agora lança erro, não `SUCCESS` falso.
- PR #82: armazenadores vazio tratado como falha; `primaryStoreId` ancorado por código (impede repetição do incidente "Conserto roubou o primaryStoreId").
- PR #83: `SyncLog(PRODUCTION)` reflete falha real, não `SUCCESS` incondicional.
- PR #93: `resolveSellThrough` não retorna 0%/"Crítico" para produto sem venda em nenhum canal.
- Proteção estrutural contra duplicação por índice estável (`stableItemIndexes`, `resolveStoreIdsEstaveis`) — ativa e em uso, não é só reparo pontual.
- Hierarquia CD→lojas→produção (PR #87) e recolhimento exigindo venda real no site (PR #89) — presentes e consistentes com a decisão registrada.

### (b) Parcialmente resolvido
- Falso-sucesso de sync corrigido **pontualmente** (estoque, armazenadores, produção) mas **não genericamente**: `syncClientes` e `syncParcelas` continuam sem validação de resposta vazia e sem `SyncSource` próprio no enum.
- `SyncLog` ainda agrega por fonte inteira, não por loja — 1 loja falhando marca a fonte toda como `FAILED` mesmo com as outras OK.
- "Loja fantasma" (armazéns de manufatura classificados como `sellsProducts=true`) corrigida só em alguns consumidores (`core.ts`, `black-friday.ts`) — **ainda presente em `estoque.ts` e `vendas.ts`**, confirmado em produção agora via consulta real (`listar_lojas` retornou "Matérias-primas"/"Produtos acabados"/"Uniformes" como se fossem loja de venda).
- Proteção contra armazém novo é lista fechada de regex (`NAO_VENDE`), não genérica — mitigada por alerta Telegram automático, mas não eliminada.

### (c) Ainda existente
- **Defasagem de estoque recorrente**: reproduzida agora (~3h44min após o cron do meio-dia), mesmo padrão documentado em 12/11 (~3h05min, outro cron) — sugere problema de cadência/conclusão, não isolado a um horário. Causa exata não confirmada (falta acesso a `SyncLog`/logs da Vercel nesta auditoria).
- **Faturamento líquido negativo (cd-atacado)**: causa raiz confirmada (Sale via `/faturas` × Return via `/vendaspdv`, sem chave compartilhada), mas os PRs #88-94 são **100% diagnóstico** — cada um adiciona script/workflow temporário e o commit seguinte os remove, nunca tocando `sync-runner.ts` ou lógica de reconciliação. Zero correção implementada até hoje.
- Mesma causa raiz contamina KPIs por cliente (ver §3.2) — efeito não documentado antes desta auditoria.
- Clientes/Parcelas sem qualquer monitoramento de sync (gap de produto, não falha pontual).

### (d) Causa ainda desconhecida
- Mecanismo exato da defasagem recorrente de estoque (falta `SyncLog` real para confirmar se é cron não disparado, falha real, ou atraso de fila).
- Ambiguidade de ~37,7% dos 507 órfãos de devolução (categoria D, 140 pedidos).

## 5. Prospecção e atacado

- Pipeline 100% determinístico (TypeScript puro), **zero IA** em qualquer etapa: importação Receita → qualificação cadastral (permissiva, propositalmente) → pesquisa comercial web (único ponto que roda o motor completo de elegibilidade) → descoberta comercial (gera CSV para revisão humana, nunca escreve direto).
- Motor de elegibilidade exige evidência real (mínimo 2 marcas de terceiro comprovadas para "multimarcas"); motor de pontuação com pesos definidos pelo Rodrigo (multimarcas 30/moda masculina 25/operação 20/qualidade 15/potencial 10, corte 75). `statusComercial` nunca sai `APROVADO` automático — promoção é sempre manual. Isso reflete fielmente a estratégia "precisão > volume".
- **Bug do PR #86 (fila travada 100%) confirmado corrigido no código atual.** Estado real do banco (run de 13/11, 21h antes desta auditoria): 500 prospectos totais, 0 aprovados pelo gate, 447 ainda sem pesquisa comercial real — **esperado**, pouquíssimo tempo passou desde a correção, não é falha nova.
- **Bruce é papel humano (vendedor), não agente de IA** — só interage com leads já `APROVADO`, nunca prospecta ou atribui.
- Visibilidade de descartados/reprovados oculta por padrão (PR #84), exclusão definitiva com confirmação em 2 etapas, restrita a ADMIN/GESTAO.
- **Correção a uma premissa**: os scripts "dedupe-nithi-pros"/"investigate-nithi-pros-duplicado" não são de prospecção — são de duplicidade de `Sale` por mudança de classificação de canal. A deduplicação de prospectos (`detectarPossivelDuplicata`) existe só para diagnóstico, nunca apaga nada automaticamente (74 prospectos com sinal de duplicata, nenhum removido).

## 6. Arquitetura, histórico e produção

- **Stack**: Next.js 16 (App Router) + React 19 + Prisma 6/Postgres (Neon) + Tailwind 4. ~45 módulos de dashboard, `src/lib/metrics/` (16 arquivos) como núcleo de cálculo, `src/lib/connectors/` para integrações externas, `src/lib/prospeccao/` (~15 módulos).
- **Cron jobs**: 5 rotas via `vercel.json` (midnight/manhã/noon/evening/late) + 1 externo via cron-job.org a cada ~10min (`sync-frequent`, necessário porque o plano Hobby da Vercel não tem cron de minutos) + self-heal em `self-heal-sync.ts` (dispara se `SyncLog(STOCK)` > 5h sem sucesso). `sync-cancelamentos.yml` do GitHub Actions está **desativado deliberadamente** desde 01/11 (secret desincronizado, documentado no próprio YAML).
- **Autenticação/autorização**: sessão por cookie + tabela `Session` (não JWT), bcrypt custo 10, allowlist por usuário (abas/lojas/marcas/tabela de preço), default-deny para loja/marca/tabela.
- **Build atual**: `tsc --noEmit` limpo, `eslint` limpo, 629/629 testes unitários passando.
- **Estado da produção na Vercel**: **não verificado nesta auditoria** — a conexão MCP Vercel retornou 403 (escopo não autorizado) nas 4 tentativas. Precisa reautenticação manual ou CLI (`vercel inspect`) numa próxima sessão.
- **17 worktrees auditados individualmente**: a maioria (12) já está mergeada/obsoleta e pode ser removida com segurança. **3 têm trabalho real nunca integrado**:
  - `agent-aaa4f84bd99268592`: teste completo de `DapicClient.login()`/cache de token (137 linhas), nunca chegou a PR.
  - `agent-af55e6056fe53e292`: feature completa de pré-carregamento de status de sync detalhado por fonte no cabeçalho (333 linhas líquidas), nunca chegou a PR.
  - `tvb-dashboard-planejamento-estoque`: trabalho real e valioso (ver §7), mas desatualizado — foi escrito sobre uma versão de `distribuicao-estoque.ts` anterior aos PRs #87/89/91, então não é um merge direto; precisa reconciliação manual.
- **Dívida técnica**: 21 scripts `backfill-*.ts` de uso único nunca removidos; `sync-runner.ts` com 1950 linhas concentrando tudo; padrão recorrente (e disciplinado) de comitar diagnóstico temporário e remover no commit seguinte; teste e2e de Black Friday com data presa no passado.

## 7. Arquitetura proposta — Planejamento de Estoque

### O que já existe (reaproveitável)
- `ClassificacaoProduto` (Best Seller/Drop) com motores de cálculo próprios em `compras-inteligencia.ts` (`getRecomendacoesBestSeller`, `getVisaoConsolidadaCompras` por grupo para Drop, nunca recompra automática sem confirmação).
- `CoberturaMeta.leadTimeDias` por grupo, já somado ao horizonte de cobertura.
- `TAMANHOS_NUCLEO = [38,40,42,44]` já existe e é usado para priorizar exibição (nunca para filtrar).
- Granularidade por tamanho **já existe de graça** em todo o histórico: `cod` = `IdGradeProduto` é o grão cor+tamanho desde a origem (DAPIC) — não é preciso criar nada para ter o dado bruto.
- `DecisaoCompra` já persiste decisão + premissas; `getHistoricoDecisoesCompra` já lista o histórico.
- **Trabalho real não commitado na worktree órfã** (`tvb-dashboard-planejamento-estoque`, ver §6): campo `StockMinimumRule.produto` (mínimo por produto+tamanho, mais fino que grupo), módulo `grade-tamanhos.ts` com `decomporQuantidadePorTamanho()` (reparte quantidade sugerida por tamanho real, largest-remainder, pesando núcleo quando não há histórico), e `getRecomendacoesBestSellerPorProdutoComTamanho`/`getRecomendacoesDropPorProdutoComTamanho` (calcula no nível de produto, mais robusto, só depois decompõe por tamanho). **Veredito: não é stale nem redundante com os PRs de distribuição — é um domínio diferente (quanto comprar por tamanho vs. onde mover estoque existente) e não resolvido em nenhum PR mergeado.** Mas a parte que toca `distribuicao-estoque.ts` está desatualizada e precisa reconciliação manual, não aplicação direta.

### O que falta (gaps reais confirmados)
1. Sell-through convencional não tem nenhum conceito de Best Seller/Drop — pré-requisito antes de "sell-through considerando reposição de best-seller" ser possível.
2. Nenhum motor detecta sobra recorrente de tamanho **entre ciclos de compra** (só snapshot do momento) — e o histórico de estoque contínuo só existe desde ~08/2026, o que limita a confiabilidade de qualquer padrão detectado.
3. Lead time é só um número somado ao horizonte — falta lógica de "quando exatamente disparar o pedido" e alerta de atraso.
4. Zero avaliação retrospectiva de decisão de compra (comparar decidido vs. realizado).
5. `compras-inteligencia.ts` e `distribuicao-estoque.ts` nunca se importam — sem essa ponte, não dá para responder "tem excesso em outro lugar antes de comprar mais".
6. `getTamanhoBreakdown` (usado no Mapa de Compras) agrega por **nome** de produto, não produto+cor — risco de misturar cores diferentes ao repartir por tamanho; confirmar antes de reusar.

### Recomendação de arquitetura
- **Não criar uma 12ª aba isolada de estoque** (já existem 11). Integrar como mais um grupo de ação dentro da visão de "Painel de Decisões" que o Rodrigo já pediu para Distribuição.
- Manter os três motores (compra centralizada/reposição/drop) conceitualmente separados — prazos e natureza de decisão são diferentes — unidos por uma camada de apresentação comum.
- Terminar e testar a decomposição por tamanho da worktree órfã (hoje sem nenhum teste, violando a convenção do projeto).
- Reaproveitar `getPosicoesEstoque`/`PosicaoEstoque` como fonte única de "posição" — não reinventar.

### Decisões que precisam do Rodrigo antes de implementar
1. Fonte de previsão de demanda: média móvel simples melhorada ou modelo estatístico real?
2. Classificação Best Seller/Drop por `cod` (cor+tamanho) ou subir para produto+cor?
3. Confirmar se `getTamanhoBreakdown` deve ser corrigido para produto+cor antes de reuso.
4. Lead time uniforme (60 dias) ou por grupo/fornecedor (schema já suporta por grupo)?
5. Avaliação retrospectiva: job periódico (snapshot) ou cálculo on-demand?
6. `Return` (devolução) entra na velocidade de demanda ou fica fora, como hoje?
7. Qualquer schema change aqui precisa de PR parado para aprovação explícita — não é decisão autônoma de agente (regra já estabelecida para dado real/schema/migration).

## 8. Experiência e interface

- Navegação: hierarquia real por grupo (11 grupos), não lista plana. Único stub honesto: "Comparativo vs. meta/ano ant." com badge "Em breve".
- Componentes compartilhados (`StatTile`, `FilterBar`, `CollapsibleFilters`) de fato amplamente reutilizados; onde não são importados, os mesmos tokens CSS são replicados manualmente (consistência mantida).
- **Achado médio**: usuário com `allowedTabs` customizado não ganha acesso automático a módulos novos — fica preso na lista antiga até admin atualizar manualmente, sem nenhum aviso visual (só redirect mudo). Já quebra 2 dos 3 arquivos de teste e2e existentes.
- **N+1 confirmado e crescente**: `/dashboard/indicadores` dispara uma query paralela por mês desde 09/2025 (cresce todo mês, nunca compacta); `/dashboard/atacado-prospeccao` dispara uma query de contagem por estado litorâneo em vez de um `GROUP BY`. Mitigado por serem paralelas (`Promise.all`), mas carga real e crescente no Neon.
- Indicador de sync bem construído (poll adaptativo, pausa quando aba oculta, nunca força refresh completo).
- Cobertura e2e mínima: 3 de ~45 módulos, 8 passaram / 5 falharam / 3 não rodaram na última execução; infraestrutura de teste com `PrismaClient` instanciado fora do `next dev` (não carrega `.env.local`), risco de deixar o banner de Black Friday "Forçado ATIVO" perdido no banco se um teste quebrar no meio.
- Validação feita via HTTP real contra as 44 rotas (sessão de dev autenticada) + suíte Playwright — não via browser visual (extensão Chrome não conectou nesta sessão). Nenhum bug crítico de roteamento/auth encontrado.

## 9. Histórico e decisões de negócio já estabelecidas (não reabrir sem justificativa)

- CD/Site é prioridade 1 de abastecimento, nunca "excesso" por função normal.
- Falso-sucesso de sync: estoque e armazenadores tratam resposta vazia como falha; vendas/faturas/clientes/parcelas aceitam zero como válido, por decisão deliberada (gap ainda existente para clientes/parcelas, ver §4b).
- Sell-through sem histórico retorna "sem dado", não 0%/Crítico.
- `getGrupoRestriction` desativada a pedido do Rodrigo (preservada no código, não removida).
- CNAE nunca é prova de revenda na prospecção.
- Bruce só trabalha com leads já aprovados — nunca prospecta.
- Atacado fora da aba Black Friday.
- Grade de tamanho (38/40/42/44) é peso de prioridade, nunca filtro que exclui tamanho.

## 10. Roadmap priorizado de continuidade

### FASE 1 — Estabilidade e confiabilidade
**Entregáveis:** corrigir reconciliação Sale×Return do canal cd-atacado (faturamento negativo + KPIs de cliente inflados); fechar o gap de falso-sucesso em `syncClientes`/`syncParcelas`; corrigir "loja fantasma" nos consumidores restantes (`estoque.ts`, `vendas.ts`); investigar causa real da defasagem recorrente de estoque (precisa acesso a `SyncLog`/logs Vercel); automatizar `prisma migrate deploy` no pipeline de build (elimina a classe de incidente já ocorrida 2x).
**Dependências:** acesso a `SyncLog` de produção e/ou Vercel Functions Logs (hoje bloqueado por falta de autorização do MCP Vercel).
**Riscos:** reconciliação Sale×Return é uma decisão de schema/dado real — exige PR parado para aprovação explícita, não é autônomo.
**Critério de conclusão:** faturamento líquido por loja/mês e KPIs de cliente CD/Atacado batem com conferência manual numa amostra; `SyncLog` não mostra mais falso-sucesso em nenhuma fonte; migration automatizada rodando sem intervenção manual em pelo menos 1 deploy real.
**Complexidade:** alta (reconciliação de dado histórico é o item mais complexo do roadmap inteiro). **Paralelizável:** sim — reconciliação de dado, fix de loja fantasma e automação de migration são frentes independentes.

### FASE 2 — Conclusão dos módulos existentes
**Entregáveis:** resgatar as 2 features órfãs sem PR (teste de `DapicClient.login()`, status de sync detalhado no header); corrigir textos desatualizados (`marketing`, `envelhecimento`); resolver gap de `allowedTabs` para módulos novos (aviso visual ou auto-merge de defaults); decidir ciclo de vida da aba Black Friday pós-campanha; corrigir infraestrutura de teste e2e (Prisma client não carrega `.env.local`); mitigar N+1 de `indicadores`/`atacado-prospeccao`.
**Dependências:** nenhuma externa — tudo é código já mapeado.
**Riscos:** baixo, nenhuma mudança de schema.
**Critério de conclusão:** as 2 features resgatadas em PR revisado; e2e com 0 falhas de infraestrutura (falhas de produto, se houver, documentadas separadamente); `allowedTabs` não deixa usuário sem aviso.
**Complexidade:** média. **Paralelizável:** sim, são itens independentes entre si.

### FASE 3 — Inteligência operacional
**Entregáveis:** ligar `compras-inteligencia.ts` e `distribuicao-estoque.ts` (hoje não se falam); estender sell-through com conceito Best Seller/Drop; granularidade de mínimo por produto+tamanho em produção (aplicar o trabalho da worktree órfã, reconciliado).
**Dependências:** Fase 1 concluída (não vale a pena construir inteligência sobre dado de faturamento/estoque ainda não confiável).
**Riscos:** médio — acopla dois motores que foram deliberadamente mantidos separados; exige decisão do Rodrigo sobre até onde essa ponte vai.
**Critério de conclusão:** Mapa de Compras passa a considerar excesso em outra posição antes de sugerir compra nova; sell-through de Drop deixa de ser estruturalmente vazio.
**Complexidade:** alta. **Paralelizável:** parcialmente — a extensão de sell-through é independente da ponte entre motores.

### FASE 4 — Planejamento de estoque (nova área)
**Entregáveis:** finalizar e testar a decomposição de compra por tamanho (worktree órfã, reconciliada e com testes); lógica de "quando disparar o pedido" dado o lead time de 60 dias; avaliação retrospectiva de decisão de compra; detecção de sobra recorrente de tamanho (com ressalva de confiabilidade histórica limitada a ~08/2026 em diante).
**Dependências:** Fase 3 (sell-through com Best Seller/Drop) para a parte de reposição; decisões do Rodrigo listadas no §7 antes de qualquer schema change.
**Riscos:** fonte de previsão de demanda ainda é regra simples (média móvel), não modelo estatístico — definir expectativa de precisão com o Rodrigo antes de prometer "quanto comprar" como número definitivo.
**Critério de conclusão:** as 8 perguntas do pedido original (o que/quanto/quando comprar, quais tamanhos reforçar, excesso, ruptura, onde distribuir, acerto/erro de decisões passadas) têm resposta na tela, mesmo que com regra simples na v1.
**Complexidade:** alta. **Paralelizável:** limitada — depende de sequência (schema → motor → decomposição → avaliação retrospectiva).

### FASE 5 — Evolução estratégica
**Entregáveis:** alertas inteligentes (ex: Telegram quando lead time de compra está vencendo sem decisão registrada); agentes especializados adicionais (seguindo o padrão Bruce = papel humano assistido, não agente autônomo substituindo decisão); relatórios gerenciais consolidados (Painel de Decisões unificado, já sinalizado como direção pelo Rodrigo).
**Dependências:** Fases 1-4.
**Riscos:** baixo tecnicamente, alto em escopo — risco real de "desenvolver por desenvolver"; cada item precisa resolver um problema operacional concreto do Rodrigo, não ser adicionado por completude.
**Critério de conclusão:** definido caso a caso junto ao Rodrigo.
**Complexidade:** variável. **Paralelizável:** sim, por natureza (itens independentes).

## 11. Próximas cinco tarefas que realmente deveriam ser executadas

1. **Reautorizar o MCP Vercel** (ou usar `vercel inspect`/CLI) para confirmar estado real da produção — pré-requisito para validar qualquer outra correção com confiança.
2. **Investigar a defasagem recorrente de estoque com acesso a `SyncLog`/Logs da Vercel** — hoje é sintoma confirmado duas vezes (horários diferentes), causa ainda desconhecida.
3. **Decidir e implementar a reconciliação Sale×Return do canal cd-atacado** — é o item de maior impacto financeiro/confiança de dado em todo o sistema, afeta 3 módulos diferentes (financeiro agregado, Clientes, Notas Fiscais).
4. **Automatizar `prisma migrate deploy` no pipeline de build** — já causou 2 incidentes reais, é uma correção estrutural de baixo risco relativo.
5. **Resgatar e abrir PR das 2 features órfãs** (`DapicClient.login()` test, status de sync detalhado no header) antes que as worktrees sejam limpas e esse trabalho se perca de vez.

## 12. Arquivos e módulos que merecem atenção primeiro

- `src/lib/sync-runner.ts` (1950 linhas) — centro de gravidade de quase todo achado de coleta de dados.
- `src/lib/metrics/clientes.ts` (linhas 233-255, 420-482, 1223-1540) — JOIN quebrado Sale×Return.
- `src/lib/connectors/armazenadores.ts` + `src/lib/metrics/estoque.ts` + `src/lib/metrics/vendas.ts` — "loja fantasma" ainda presente.
- `src/app/api/aplicar-migration-armazem-conhecido` e `aplicar-migration-compras` — sintoma do pipeline sem `prisma migrate deploy`.
- `prisma/schema.prisma` (model `Return`, `StockMinimumRule`, enum `SyncSource`) — qualquer mudança aqui precisa de PR parado para aprovação.
- `C:\Users\Dell\Projects\tvb-dashboard-planejamento-estoque` (worktree órfã) — trabalho real a reconciliar ou abandonar deliberadamente, não deixar esquecido.
- `.claude/worktrees/agent-aaa4f84bd99268592` e `agent-af55e6056fe53e292` — resgatar antes de limpar.
- `src/lib/tabs.ts:165` — gap de `allowedTabs` para módulos novos.

---

*Documento gerado por auditoria com 6 agentes paralelos somente-leitura em 2026-11-14. Não reabrir investigações já marcadas "resolvido e comprovado" sem evidência nova — reler a seção correspondente antes de redespachar um agente para o mesmo tema.*
