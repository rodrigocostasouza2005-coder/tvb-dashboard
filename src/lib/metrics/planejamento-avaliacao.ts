import { prisma } from "@/lib/prisma";
import { TipoCompraProduto } from "@prisma/client";
import { diagnosticarVariante, type Diagnostico } from "./distribuicao-estoque";
import { getHistoricoDecisoesCompra } from "./compras-inteligencia";

// Fase 2B do Planejamento Inteligente de Estoque (pedido do Rodrigo, 2026-11-16) — "avaliação
// retrospectiva de decisão de compra": comparar o que foi recomendado/aprovado (DecisaoCompra)
// contra o que realmente aconteceu depois (venda, estoque, ruptura, excesso).
//
// Decisão de arquitetura (docs/planejamento-inteligente-estoque.md §4.2, opção "b", já
// recomendada na Fase 0): CÁLCULO ON-DEMAND, zero schema novo, zero tabela/job novo. Este
// módulo só LÊ DecisaoCompra (via getHistoricoDecisoesCompra, reaproveitado — nunca duplicamos o
// acesso Prisma a essa tabela aqui) e cruza com Sale/StockSnapshot por cod (quando disponível)
// ou por grupo (fallback). Nunca escreve nada em nenhuma tabela.
//
// LIMITAÇÃO REAL, documentada ao invés de escondida: DecisaoCompra não tem FK pra Sale/
// StockSnapshot/ProductionOrder — o cruzamento é sempre um JOIN IMPLÍCITO por `cod` (quando a
// decisão tem cod) ou por `grupo` (quando não tem — ex: decisão de Drop agregada, registrada só
// no nível de grupo). Quando o join é só por grupo, os números abaixo são de TODO o grupo, não
// do SKU específico da decisão — podem incluir vendas/estoque de outros produtos do mesmo grupo.
// Por isso decisão só-grupo NUNCA é classificada COMPLETA aqui (ver avaliarDecisaoCompra).
//
// OUTRA LIMITAÇÃO REAL: não existe série histórica de estoque (StockSnapshot é upsert, só o
// estado atual — Fase 0 §2.1/§4.4). `estoqueAtual` abaixo é sempre o snapshot de HOJE, nunca "o
// estoque no fim da janela de avaliação" — é o melhor proxy disponível de "sobra remanescente até
// agora", não uma foto exata do dia X após a decisão.
//
// HONESTIDADE SOBRE DADO REAL EM PRODUÇÃO (checar antes de assumir qualquer coisa): o formulário
// que grava DecisaoCompra (ConfirmarDecisaoForm, mapa-compras/inteligencia/forms.tsx) está
// conectado desde o commit 7bbb596 (~2026-10-27), mas não há evidência, no código/histórico de
// commits, de que alguém de fato clicou nele em produção — nenhum script de validação anterior
// (Fase 0/1/2A) consultou DecisaoCompra contra produção. É bem possível que a tabela esteja vazia
// ou quase vazia hoje. Por isso a maioria (ou todas) as linhas reais podem cair em SEM_DADOS
// simplesmente por não existir decisão nenhuma pra avaliar ainda — isso não é um bug desta
// entrega, é o estado real esperado. Confirmar contra produção fica para a validação pós-merge
// (mesmo padrão de script temporário somente-leitura das fases anteriores).

// Mesmo limiar de "histórico confiável" usado em todo o módulo de planejamento (ver
// MIN_DIAS_HISTORICO_CONFIAVEL em planejamento-estoque.ts e compras-inteligencia.ts) — não é
// usado diretamente aqui pra cortar SEM_DADOS/PARCIAL (ver JANELA_COMPLETA_DIAS abaixo), mas fica
// documentado como a mesma régua de "histórico curto demais pra confiar" usada no resto do Radar.
const JANELA_MINIMA_CONFIAVEL_DIAS = 14;

// Janela "completa" de avaliação pós-decisão = 90 dias, mesma convenção de vendasDias90 usada em
// getProdutosPlanejamento/getComparacaoCompleta. Só quando os 90 dias cheios já decorreram desde
// decididoEm é que arriscamos um diagnóstico de ruptura/excesso — antes disso, qualquer número
// seria uma amostra parcial demais pra ser tratada como veredito.
const JANELA_COMPLETA_DIAS = 90;

export type Avaliabilidade = "SEM_DADOS" | "PARCIAL" | "COMPLETA";

export type AvaliacaoDecisaoCompra = {
  decisaoId: string;
  cod: string | null;
  grupo: string;
  tipoCompra: TipoCompraProduto;
  decididoEm: Date;
  decididoPor: string | null;
  // Sempre conhecidos — vêm da própria DecisaoCompra, nunca calculados/fabricados.
  quantidadeRecomendada: number;
  quantidadeComprada: number;
  diferenca: number;
  diasDecorridos: number;

  avaliabilidade: Avaliabilidade;
  // null só quando avaliabilidade é SEM_DADOS (nada pôde ser cruzado, nem por cod nem por grupo).
  baseCalculo: "cod" | "grupo" | null;

  // Vendas desde decididoEm até agora, SEM exigir que uma janela fixa tenha decorrido inteira —
  // é o único número de venda que podemos sempre reportar quando há algum dado cruzável (mesmo
  // que o período pós-decisão ainda seja curto).
  vendasPosDecisaoAteAgora: number | null;
  // Cada um só é preenchido (não-null) quando a janela de N dias após decididoEm JÁ DECORREU
  // INTEIRA até hoje — nunca uma soma parcial travestida de janela completa.
  vendasPosDecisao30: number | null;
  vendasPosDecisao60: number | null;
  vendasPosDecisao90: number | null;

  // Snapshot de HOJE (não existe série histórica de estoque — ver nota de limitação no topo do
  // arquivo). null só quando SEM_DADOS.
  estoqueAtual: number | null;

  // Só calculado quando avaliabilidade === "COMPLETA" (cod presente + janela de 90 dias cheia +
  // dado real disponível) — nunca estimado a partir de janela parcial.
  diagnosticoPosDecisao: Diagnostico | null;
  indicioRupturaPosDecisao: boolean | null;
  indicioExcessoRemanescente: boolean | null;

  // Avisos legíveis explicando por que a avaliação é SEM_DADOS/PARCIAL, ou qualquer ressalva
  // relevante mesmo em COMPLETA (ex: base de cálculo).
  avisos: string[];
};

export type DecisaoParaAvaliar = {
  id: string;
  cod: string | null;
  grupo: string;
  tipoCompra: TipoCompraProduto;
  quantidadeSugerida: number;
  quantidadeAprovada: number;
  decididoEm: Date;
  decididoPor: string | null;
};

export type DadosCruzadosDecisao = {
  // Quantas linhas de StockSnapshot existem pro cod (ou grupo, no fallback) — existência de
  // QUALQUER linha já conta como "estoque cruzável", já que StockSnapshot nunca tem histórico,
  // só o estado atual (não dá pra exigir "estoque cruzável NO PERÍODO" pra um dado que não tem
  // data de referência além de "agora").
  stockRowCount: number;
  estoqueAtual: number;
  // Quantas vendas (linhas de Sale) existem no período [decididoEm, agora] — usado só pra decidir
  // SEM_DADOS (existe ALGUMA venda cruzável no período?), independente de qual janela (30/60/90)
  // já decorreu.
  vendasNoPeriodoCount: number;
  vendasPosDecisaoAteAgora: number;
  vendasPosDecisao30: number | null;
  vendasPosDecisao60: number | null;
  vendasPosDecisao90: number | null;
};

// ---------------------------------------------------------------------------
// NÚCLEO PURO — classifica avaliabilidade e monta o resultado, sem Prisma. Testável direto com
// `DadosCruzadosDecisao` sintético, mesma convenção de diagnosticarVariante/vendasEfetivasCdSite
// (distribuicao-estoque.ts): funções puras do módulo nunca têm teste que precise mockar banco.
// ---------------------------------------------------------------------------
export function avaliarDecisaoCompra(
  decisao: DecisaoParaAvaliar,
  dados: DadosCruzadosDecisao,
  agora: Date = new Date()
): AvaliacaoDecisaoCompra {
  const diasDecorridos = Math.floor((agora.getTime() - decisao.decididoEm.getTime()) / 86_400_000);
  const diferenca = decisao.quantidadeAprovada - decisao.quantidadeSugerida;
  const avisos: string[] = [];

  const base = {
    decisaoId: decisao.id,
    cod: decisao.cod,
    grupo: decisao.grupo,
    tipoCompra: decisao.tipoCompra,
    decididoEm: decisao.decididoEm,
    decididoPor: decisao.decididoPor,
    quantidadeRecomendada: decisao.quantidadeSugerida,
    quantidadeComprada: decisao.quantidadeAprovada,
    diferenca,
    diasDecorridos,
  };

  const hasCrossableData = dados.stockRowCount > 0 || dados.vendasNoPeriodoCount > 0;

  // SEM_DADOS: nem estoque nem venda cruzável — independe de ter cod ou não. Com cod, significa
  // SKU sem nenhum StockSnapshot/Sale no período (novo demais, descontinuado, ou cod incorreto).
  // Sem cod, significa que nem o grupo inteiro teve sinal cruzável no período.
  if (!hasCrossableData) {
    avisos.push(
      decisao.cod
        ? "Nenhum registro de estoque (StockSnapshot) ou venda (Sale) encontrado para este cod no período pós-decisão — SKU pode ser novo, descontinuado, ou o cod pode estar incorreto. Nenhum número foi calculado."
        : "Decisão registrada só por grupo (sem cod) e nenhuma venda/estoque cruzável encontrado para o grupo inteiro no período pós-decisão. Nenhum número foi calculado."
    );
    return {
      ...base,
      avaliabilidade: "SEM_DADOS",
      baseCalculo: null,
      vendasPosDecisaoAteAgora: null,
      vendasPosDecisao30: null,
      vendasPosDecisao60: null,
      vendasPosDecisao90: null,
      estoqueAtual: null,
      diagnosticoPosDecisao: null,
      indicioRupturaPosDecisao: null,
      indicioExcessoRemanescente: null,
      avisos,
    };
  }

  // Decisão só por grupo (sem cod): há ALGUM dado cruzável, mas nunca no grão do SKU decidido —
  // nunca COMPLETA aqui, por mais tempo que tenha passado, porque a imprecisão do join por grupo
  // não desaparece com o tempo.
  if (!decisao.cod) {
    avisos.push(
      "Decisão registrada só por grupo (sem cod) — os números abaixo são agregados de TODO o grupo, não do SKU específico da decisão (podem incluir vendas/estoque de outros produtos do mesmo grupo). Por essa imprecisão de join, decisão só-grupo nunca é classificada COMPLETA nesta avaliação, só PARCIAL."
    );
    return {
      ...base,
      avaliabilidade: "PARCIAL",
      baseCalculo: "grupo",
      vendasPosDecisaoAteAgora: dados.vendasPosDecisaoAteAgora,
      vendasPosDecisao30: dados.vendasPosDecisao30,
      vendasPosDecisao60: dados.vendasPosDecisao60,
      vendasPosDecisao90: dados.vendasPosDecisao90,
      estoqueAtual: dados.estoqueAtual,
      diagnosticoPosDecisao: null,
      indicioRupturaPosDecisao: null,
      indicioExcessoRemanescente: null,
      avisos,
    };
  }

  // Cod presente e há dado cruzável — mas a janela de 90 dias pós-decisão ainda não decorreu
  // inteira (vendasPosDecisao30/60/90 vêm null do cruzamento quando isso acontece — nunca uma
  // soma parcial maquiada de janela cheia). PARCIAL: reporta o que já pôde ser calculado
  // honestamente (vendasPosDecisaoAteAgora, estoqueAtual), nunca completa o que falta.
  const janelaCompleta = dados.vendasPosDecisao30 != null && dados.vendasPosDecisao60 != null && dados.vendasPosDecisao90 != null;
  if (!janelaCompleta) {
    const diasFaltantes = Math.max(0, JANELA_COMPLETA_DIAS - diasDecorridos);
    avisos.push(
      `Período pós-decisão ainda não completou ${JANELA_COMPLETA_DIAS} dias (${diasDecorridos} decorrido(s), faltam ${diasFaltantes}) — diagnóstico de ruptura/excesso não calculado para não arriscar conclusão prematura. Os números abaixo refletem só o que já decorreu.`
    );
    if (diasDecorridos < JANELA_MINIMA_CONFIAVEL_DIAS) {
      avisos.push(
        `Período decorrido (${diasDecorridos} dia(s)) é menor que o limiar de histórico confiável usado no resto do módulo (${JANELA_MINIMA_CONFIAVEL_DIAS} dias) — qualquer número aqui é só um indício inicial, não uma tendência.`
      );
    }
    return {
      ...base,
      avaliabilidade: "PARCIAL",
      baseCalculo: "cod",
      vendasPosDecisaoAteAgora: dados.vendasPosDecisaoAteAgora,
      vendasPosDecisao30: dados.vendasPosDecisao30,
      vendasPosDecisao60: dados.vendasPosDecisao60,
      vendasPosDecisao90: dados.vendasPosDecisao90,
      estoqueAtual: dados.estoqueAtual,
      diagnosticoPosDecisao: null,
      indicioRupturaPosDecisao: null,
      indicioExcessoRemanescente: null,
      avisos,
    };
  }

  // COMPLETA: cod presente, janela de 90 dias cheia, dado real disponível — único caso em que
  // calculamos diagnóstico de ruptura/excesso, reaproveitando a MESMA régua do resto do módulo
  // (diagnosticarVariante, distribuicao-estoque.ts), nunca uma régua nova. tipoPosicao="loja" de
  // propósito: o cruzamento por cod aqui soma estoque/venda de TODAS as posições (lojas + CD/Site
  // juntos, sem distinguir), exatamente como getProdutosPlanejamento faz pro agregado por
  // produto — "loja" é o limiar mais conservador (60d vs. 90d do CD/Site), a escolha mais segura
  // pra não mascarar excesso real só porque o CD tolera mais profundidade (mesmo comentário de
  // planejamento-estoque.ts:139-141).
  // Correção "estoque_parado" vs. "lancamento_recente" (distribuicao-estoque.ts, Reformulação do
  // Planejamento de Estoque 2026-11-23): o 3º parâmetro de diagnosticarVariante é deliberadamente
  // OMITIDO aqui (preserva o comportamento de antes, sem nenhuma mudança neste call site/nos
  // testes de planejamentoAvaliacao.test.ts). Justificativa: "COMPLETA" só existe depois que
  // JANELA_COMPLETA_DIAS (90 dias cheios) já passou desde a DECISÃO — nessa altura, se o produto
  // realmente nunca vendeu nesses 90 dias pós-decisão, a ambiguidade "ainda não teve chance de
  // vender" é muito mais fraca que no caso geral (achado do §3.1 da auditoria): houve decisão,
  // então presumivelmente já havia expectativa de venda construída, e passaram-se 90 dias cheios
  // — "estoque_parado" continua a leitura mais honesta aqui.
  const vendasPosDecisao90 = dados.vendasPosDecisao90!;
  const velocidadeDiaria = vendasPosDecisao90 > 0 ? vendasPosDecisao90 / JANELA_COMPLETA_DIAS : 0;
  const coberturaDias = velocidadeDiaria > 0 ? Math.round((dados.estoqueAtual / velocidadeDiaria) * 10) / 10 : null;
  const diagnosticoPosDecisao = diagnosticarVariante(
    {
      estoqueAtual: dados.estoqueAtual,
      vendasDias30: dados.vendasPosDecisao30!,
      vendasDias90: vendasPosDecisao90,
      velocidadeDiaria,
      coberturaDias,
    },
    "loja"
  );

  return {
    ...base,
    avaliabilidade: "COMPLETA",
    baseCalculo: "cod",
    vendasPosDecisaoAteAgora: dados.vendasPosDecisaoAteAgora,
    vendasPosDecisao30: dados.vendasPosDecisao30,
    vendasPosDecisao60: dados.vendasPosDecisao60,
    vendasPosDecisao90: dados.vendasPosDecisao90,
    estoqueAtual: dados.estoqueAtual,
    diagnosticoPosDecisao,
    indicioRupturaPosDecisao: diagnosticoPosDecisao === "ruptura" || diagnosticoPosDecisao === "cobertura_critica",
    indicioExcessoRemanescente: diagnosticoPosDecisao === "cobertura_excessiva" || diagnosticoPosDecisao === "estoque_parado",
    avisos,
  };
}

// ---------------------------------------------------------------------------
// CAMADA DE DADO — só esta parte toca Prisma. Sale/StockSnapshot nunca ganham histórico aqui,
// são lidos exatamente como existem hoje (venda bruta por linha, estoque = estado atual).
// ---------------------------------------------------------------------------

async function somarVendasJanela(
  where: { cod: string } | { grupo: string },
  decididoEm: Date,
  dias: number,
  agora: Date
): Promise<number | null> {
  const fim = new Date(decididoEm.getTime() + dias * 86_400_000);
  // Janela ainda não decorreu inteira — nunca soma um pedaço e chama de "dias X" inteiro.
  if (fim > agora) return null;
  const agg = await prisma.sale.aggregate({
    where: { ...where, status: { not: "Cancelada" }, saleDate: { gte: decididoEm, lt: fim } },
    _sum: { quantidade: true },
  });
  return agg._sum.quantidade ?? 0;
}

async function buscarDadosCruzados(decisao: DecisaoParaAvaliar, agora: Date): Promise<DadosCruzadosDecisao> {
  const where = decisao.cod ? { cod: decisao.cod } : { grupo: decisao.grupo };

  const [stockAgg, vendasAteAgoraAgg, vendasNoPeriodoCount, vendasPosDecisao30, vendasPosDecisao60, vendasPosDecisao90] =
    await Promise.all([
      prisma.stockSnapshot.aggregate({ where, _sum: { quantidadeDisponivel: true }, _count: true }),
      prisma.sale.aggregate({
        where: { ...where, status: { not: "Cancelada" }, saleDate: { gte: decisao.decididoEm, lte: agora } },
        _sum: { quantidade: true },
      }),
      prisma.sale.count({ where: { ...where, status: { not: "Cancelada" }, saleDate: { gte: decisao.decididoEm, lte: agora } } }),
      somarVendasJanela(where, decisao.decididoEm, 30, agora),
      somarVendasJanela(where, decisao.decididoEm, 60, agora),
      somarVendasJanela(where, decisao.decididoEm, 90, agora),
    ]);

  return {
    stockRowCount: stockAgg._count,
    estoqueAtual: stockAgg._sum.quantidadeDisponivel ?? 0,
    vendasNoPeriodoCount,
    vendasPosDecisaoAteAgora: vendasAteAgoraAgg._sum.quantidade ?? 0,
    vendasPosDecisao30,
    vendasPosDecisao60,
    vendasPosDecisao90,
  };
}

// Avalia UMA decisão específica. Reaproveita getHistoricoDecisoesCompra (compras-inteligencia.ts)
// como ÚNICA leitura de DecisaoCompra — não duplica o acesso Prisma a essa tabela. Essa função
// não tem filtro por id hoje (só grupo/cod); como o volume real de decisões é hoje mínimo (ver
// nota de "honestidade sobre dado real em produção" no topo do arquivo), buscar todas e filtrar em
// memória é aceitável — se o volume crescer muito no futuro, vale adicionar um filtro por id
// dedicado em getHistoricoDecisoesCompra (não fiz isso agora pra não tocar na lógica existente de
// compras-inteligencia.ts sem necessidade comprovada).
export async function getAvaliacaoDecisaoCompra(decisaoId: string): Promise<AvaliacaoDecisaoCompra | null> {
  const todas = await getHistoricoDecisoesCompra({});
  const decisao = todas.find((d) => d.id === decisaoId);
  if (!decisao) return null;

  const agora = new Date();
  const dados = await buscarDadosCruzados(decisao, agora);
  return avaliarDecisaoCompra(decisao, dados, agora);
}

export type AvaliacaoDecisoesFiltro = {
  grupo?: string;
  cod?: string;
  decididoDesde?: Date;
  decididoAte?: Date;
};

// Agregação por produto/grupo/período pra alimentar a tela de listagem — reaproveita
// getHistoricoDecisoesCompra pro filtro grupo/cod (suportado nativamente) e filtra decididoDesde/
// decididoAte em memória (getHistoricoDecisoesCompra não tem filtro de data hoje; volume baixo
// torna isso aceitável, mesma nota de getAvaliacaoDecisaoCompra acima).
export async function getAvaliacaoDecisoesPorProdutoGrupoPeriodo(
  filtro: AvaliacaoDecisoesFiltro = {}
): Promise<AvaliacaoDecisaoCompra[]> {
  const decisoes = await getHistoricoDecisoesCompra({ grupo: filtro.grupo, cod: filtro.cod });
  const noPeriodo = decisoes.filter((d) => {
    if (filtro.decididoDesde && d.decididoEm < filtro.decididoDesde) return false;
    if (filtro.decididoAte && d.decididoEm > filtro.decididoAte) return false;
    return true;
  });

  const agora = new Date();
  return Promise.all(
    noPeriodo.map(async (decisao) => {
      const dados = await buscarDadosCruzados(decisao, agora);
      return avaliarDecisaoCompra(decisao, dados, agora);
    })
  );
}
