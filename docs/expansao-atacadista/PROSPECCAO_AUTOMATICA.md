# Motor de prospecção de revendedores TVB — política gratuita

> Atualizado na faxina pós-auditoria de 2026-11 (PR #51-53 já em `main`; esta revisão do documento
> não mudou nenhum critério comercial, só corrigiu a descrição pra bater com o código real). A
> versão anterior deste arquivo ainda descrevia a classificação ABCD por score simples do PR #43
> (código morto, removido) como se fosse o estado atual — não era mais verdade desde o rebuild do
> motor (PR #51/#52/#53).

## Decisão de produto

O usuário definiu que esta iniciativa não pode gerar despesas recorrentes sem aprovação explícita.
Portanto, não utilizar sem autorização prévia:
- APIs pagas, planos por consulta ou cobrança por registro (a única exceção avaliada, Serpro, está
  descrita em "Dependente de autorização operacional futura" abaixo — e mesmo essa não está ativa);
- trials que exijam cartão ou possam converter em cobrança;
- DadosAPI, BigDataCorp, Serasa ou fornecedores equivalentes;
- serviços externos pagos para enriquecimento ou agendamento.

Qualquer mudança dessa política exige autorização explícita antes de implementar ou ativar fornecedor.

## Arquitetura atual do motor de qualificação (PR #51/#52/#53)

Fonte de verdade do código: `src/lib/prospeccao/motor-elegibilidade.ts` (gate),
`motor-pontuacao.ts` (score) e `motor-qualificacao.ts` (orquestração). Substituiu por completo o
pipeline anterior (`avaliacao-comercial.ts`, removido nesta faxina — ver auditoria) e a
classificação ABCD por score único 0-100 que misturava eliminação e pontuação num só número.

1. **Gate obrigatório (`avaliarEliminacao`)** — 6 critérios, todos têm que ser `ATENDE` pra passar:
   existência verificável, atividade comercial real, varejo de vestuário, moda masculina,
   **multimarcas** (mínimo de **2 marcas de terceiros distintas e comprovadas**, cada uma com
   `evidencia` + `fonteUrl` + `dataVerificacao` + `tipoEvidencia` + `confianca` preenchidos — um
   registro incompleto não conta) e posicionamento TVB. Qualquer `NAO_ATENDE` (inclusive os
   bloqueios automáticos de categoria: lingerie, joalheria/bijuteria, móveis, alimentação, brechó,
   alfaiate sem multimarcas, fabricante/marca própria sem revenda, só feminino, só infantil,
   cadastro inativo) reprova de forma definitiva, mesmo que outros critérios estejam só
   inconclusivos. Resultado possível: `APROVADO_GATE`, `REPROVADO` ou `INCONCLUSIVO` (falta
   evidência em algo, mas nada foi bloqueado).
2. **Pontuação 0-100 (`pontuarProspect`)** — só roda sobre quem recebeu `APROVADO_GATE`. Pesos:
   multimarcas 30, moda masculina 25, operação comprovada 20, qualidade da informação 15,
   potencial comercial 10. Classificação: `ALTA_PRIORIDADE` (≥85), `QUALIFICADO` (≥75, ponto de
   corte de aprovação), `REPROVADO` (<75).
3. **`statusComercial` (campo persistido) nunca é `APROVADO` automaticamente.** Mesmo um
   `ALTA_PRIORIDADE` perfeito sai do motor como `PENDENTE_REVISAO_HUMANA` — só uma pessoa promove
   manualmente pra `APROVADO`. Essa regra está formalizada em `motor-qualificacao.ts` e teria que
   ser violada deliberadamente pra um prospect virar `APROVADO` sem revisão humana; nenhuma
   correção desta faxina tocou essa regra.

### Camada de adaptação

`src/lib/prospeccao/adaptadores-qualificacao.ts` traduz o que cada etapa do pipeline sabe (dados
cadastrais da Receita, ou evidência coletada numa pesquisa web em `scripts/prospeccao/
agente-pesquisa-comercial.ts`) pro formato que o motor entende. Mantém a mesma régua conservadora
de sempre: marca citada "de passagem" (sem sinal textual explícito de revenda multimarcas) nunca
entra na contagem, mesmo que apareça no site.

### 17 estados litorâneos

Lista fechada usada em todo filtro geográfico de prospecção:
`AL, AP, BA, CE, ES, MA, PA, PB, PE, PI, PR, RJ, RN, RS, SC, SE, SP`. Não é uma regra de negócio
que este motor relaxe — expandir pra outros estados exige decisão de negócio explícita, fora do
escopo deste documento e desta faxina.

## Funcionalidades implementadas e em uso

- Gate de 6 critérios + pontuação 0-100 + `statusComercial` nunca auto-aprovado (acima).
- Painel "Qualificação B2B" (`src/app/dashboard/atacado-prospeccao/page.tsx`) lendo diretamente o
  resultado do motor (`statusComercial`/`classificacaoProspect`/`resultadoEliminacao`) — sem mais
  depender do campo legado `grupoComercial` (A/B/C/D), que nunca foi gravado com esses valores em
  produção (só `"PENDENTE"`) e foi removido da UI nesta faxina.
- Cadastro manual, importação de CSV (até 500 linhas / 900 KB) e registro de interações comerciais
  (Bruce) pela carteira existente.
- Consulta cadastral oficial (Receita Federal/Serpro) já integrada ao fluxo — ver seção de
  dependência de orçamento abaixo para o estado real de uso.
- `avaliarMultimarcas`/`detectarPossivelDuplicata` cobertos por teste automatizado
  (`motor-elegibilidade.test.ts`, `motor-qualificacao.ts`).

## Funcionalidades implementadas mas não testadas em produção real

- **Coleta/qualificação nacional.** O motor foi religado (PR #51-53), mas ainda não rodou de ponta
  a ponta sobre a base nacional — hoje a carteira real no Neon dev está vazia (0 prospects) e todo
  teste é unitário/mockado. "Em investigação" na UI é o estado honesto da maior parte da carteira
  quando ela existir, não um erro.
- **Importação direta pro Neon (`scripts/prospeccao/importar-receita.ts`).** Caminho de gravação
  real nunca testado fora de uma amostra do RJ. Nesta faxina (ver `IMPORTADOR_RECEITA.md` e a seção
  de ingestão abaixo) ele passou a validar UF litorânea antes de persistir qualquer registro, mas
  continua não tendo sido executado com `--apply` contra produção nem dev como parte deste trabalho.
- **Exportação Parquet multi-UF (`scripts/prospeccao/extrair-parquet-receita.py`).** Respeita as 17
  UFs litorâneas e nunca grava no Neon, mas só foi validado com uma amostra de dados, não com o
  dump nacional completo da Receita.

## Funcionalidades ainda não executadas

- **`aplicarQuotaGeografica()` (`src/lib/prospeccao/quota-geografica.ts`).** Função pura já
  implementada e testada isoladamente (até 2 lojas qualificadas por município, 5 em capital
  estadual) mas **nunca chamada** por nenhum script real — é um ponto de extensão para a futura
  descoberta nacional, que ainda não roda.
- **Rotina de atualização incremental por competência da Receita** (comparar CNPJ, classificar
  novos/alterados/inativos, preservar histórico) — ainda não implementada nem agendada.
- **Auditoria adversarial** (reabrir um prospect já `APROVADO` ou `PENDENTE_REVISAO_HUMANA` pra
  caçar marca inventada, loja inativa ou informação desatualizada) — os campos
  `revisaoAdversarialStatus/Em/Por` já existem no schema como ponto de extensão, mas o processo em
  si não existe.

## Dependente de autorização operacional futura

- **Orçamento Serpro.** `scripts/prospeccao/consultar-cnpj-serpro.ts` existe e é testado, mas
  consumir a API real tem custo por consulta — não deve ser chamado contra o serviço real sem
  orçamento aprovado. Nenhuma execução real foi feita como parte desta faxina.
- **Piloto operacional fora do RJ / expansão de UF.** Qualquer execução real de coleta, importação
  no Neon ou abordagem comercial continua condicionada a aprovação explícita do Rodrigo — este
  documento e o código correspondente não autorizam, por si só, nenhuma operação comercial real.
- **Expansão além das 17 UFs litorâneas.** Decisão de negócio pendente; não implementada nem
  planejada tecnicamente além do que já existe.

## Contatos e privacidade

- Telefone e e-mail só podem ser usados quando constarem como dados do estabelecimento na fonte
  pública; podem estar ausentes ou desatualizados.
- Não coletar dados pessoais de sócios/administradores para tratá-los como contato comercial da loja.
- Não inferir WhatsApp a partir de telefone.
- Não automatizar mensagens ou abordagens.
- Registrar origem e competência; respeitar finalidade, minimização, retenção e pedidos de
  oposição/supressão.
- Não contornar login, CAPTCHA, limites técnicos ou termos de uso de fontes complementares.

## Localização e identidade comercial

- A cidade deve ser o nome legível do município, não o código TOM da Receita; o código TOM fica em
  `codigoMunicipio` para rastreabilidade.
- Se a Receita não trouxer nome fantasia, mostrar "Nome comercial a pesquisar". Razão social nunca
  é promovida automaticamente a nome comercial.
- Instagram, site e nome comercial só são preenchidos quando houver evidência pública coerente com
  a loja/CNPJ/endereço.
- Não atribuir perfil pessoal de sócio/administrador à empresa por semelhança de nome.
