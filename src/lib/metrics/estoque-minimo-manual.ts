import { prisma } from "@/lib/prisma";
import { getComparacaoCompleta, type ComparacaoFiltro, type ComparacaoVariante } from "./distribuicao-estoque";
import { getVendaMediaDiariaPorCod, getClassificacaoPorCods } from "./compras-inteligencia";

// Estoque mínimo MANUAL por SKU (pedido do Rodrigo, 2026-11-18, docs/planejamento-inteligente-
// estoque.md §19 generalizado): "a soma de tudo que a empresa tem agora deste SKU está abaixo do
// piso que eu decidi manter?". Aplica a QUALQUER cod — classificado (Best Seller/Drop) ou não —
// nunca só a Best Seller. Valor é 100% manual (EstoqueMinimoManual), nunca estimado/calculado por
// este arquivo. Camada 100% aditiva: nunca altera construirOrigem/diagnosticarVariante/
// calcularSugestaoBestSeller/getExcessosEDistribuicao nem aplicarRetencoes — só LÊ dado já
// calculado por getComparacaoCompleta e a venda consolidada já segura de getVendaMediaDiariaPorCod
// (compras-inteligencia.ts), ambos intocados.

export type NivelAlertaMinimoManual = "CRITICO" | "ATENCAO" | "NORMAL" | "SEM_MINIMO_DEFINIDO";

export type ItemMinimoManual = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  // Classificação do PRÓPRIO cod (não agregada por produto) — só contexto/filtro na UI, nunca usada
  // pro cálculo do mínimo (que é independente de classificação, pedido explícito do Rodrigo).
  tipoCompra: string | null;
  minimoDefinido: number | null;
  estoqueConsolidado: number; // soma de estoqueAtual de TODAS as posições (lojas + CD/Site)
  diferenca: number | null; // estoqueConsolidado - minimoDefinido; null se minimoDefinido é null
  percentualCobertura: number | null; // estoqueConsolidado / minimoDefinido * 100; null se minimoDefinido é null ou 0
  velocidadeDiariaConsolidada: number;
  // Média de dias (dataFinalizacaoProducao - dataEntradaCelula), só ProductionOrder
  // status="Finalizado" com as duas datas preenchidas, por cod. null = sem dado suficiente.
  tempoMedioProducaoDias: number | null;
  // (estoqueConsolidado - minimoDefinido) / velocidadeDiariaConsolidada; null se minimoDefinido é
  // null OU velocidade é 0 (nunca divide por zero).
  diasAteCruzarMinimo: number | null;
  nivelAlerta: NivelAlertaMinimoManual;
  // Breakdown por posição (lojas + CD/Site) — SÓ pra seção de apoio "onde está esse SKU hoje" na
  // UI. O cálculo do nível de alerta NUNCA usa isto — é sempre o consolidado.
  porLoja: ComparacaoVariante["porLoja"];
};

// Função PURA (sem Prisma) — testável com dado sintético, mesmo padrão de
// diagnosticarVariante/vendasEfetivasCdSite (distribuicao-estoque.ts).
//
// Regra de negócio: Crítico é objetivo (o mínimo já foi violado). Atenção é "o mínimo seria
// violado antes que uma nova produção, no tempo médio histórico medido, consiga chegar" — nunca um
// percentual arbitrário, sempre ancorado em 2 dados medidos (venda real + produção real). Quando
// não há tempoMedioProducaoDias suficiente pra aquele cod, o nível NUNCA fica "ATENCAO" por
// adivinhação — cai em NORMAL (se já não for CRITICO); o próprio tempoMedioProducaoDias:null no
// item já comunica "sem dado suficiente" pra UI mostrar isso.
export function calcularNivelAlertaMinimoManual(input: {
  minimoDefinido: number | null;
  estoqueConsolidado: number;
  diasAteCruzarMinimo: number | null;
  tempoMedioProducaoDias: number | null;
}): NivelAlertaMinimoManual {
  if (input.minimoDefinido == null) return "SEM_MINIMO_DEFINIDO";
  if (input.estoqueConsolidado < input.minimoDefinido) return "CRITICO";
  if (
    input.diasAteCruzarMinimo != null &&
    input.tempoMedioProducaoDias != null &&
    input.diasAteCruzarMinimo <= input.tempoMedioProducaoDias
  ) {
    return "ATENCAO";
  }
  return "NORMAL";
}

const PESO_ORDENACAO_NIVEL: Record<NivelAlertaMinimoManual, number> = {
  CRITICO: 0,
  ATENCAO: 1,
  SEM_MINIMO_DEFINIDO: 2,
  NORMAL: 3,
};

function mediaDiasProducao(datas: { dataEntradaCelula: Date; dataFinalizacaoProducao: Date }[]): number | null {
  if (datas.length === 0) return null;
  const totalDias = datas.reduce(
    (soma, d) => soma + (d.dataFinalizacaoProducao.getTime() - d.dataEntradaCelula.getTime()) / 86_400_000,
    0
  );
  return totalDias / datas.length;
}

// Camada de DADO (Prisma) — pra QUALQUER cod presente em getComparacaoCompleta (todo o catálogo
// com estoque/venda, não só Best Seller), cruza com o mínimo manual (EstoqueMinimoManual, se
// existir) e com a classificação (ClassificacaoProduto, só como contexto). filtro aceita os mesmos
// campos de ComparacaoFiltro (grupoIn/tamanhoIn/busca/storeIdsPermitidas) já usados em outras
// telas — útil aqui porque o catálogo inteiro é grande.
export async function getEstoqueMinimoManual(filtro: ComparacaoFiltro = {}): Promise<ItemMinimoManual[]> {
  const comparacao = await getComparacaoCompleta(filtro);
  if (comparacao.variantes.length === 0) return [];

  const cods = comparacao.variantes.map((v) => v.cod);

  const [minimos, classificacoes, velocidadePorCod, ordensProducao] = await Promise.all([
    prisma.estoqueMinimoManual.findMany({ where: { cod: { in: cods } }, select: { cod: true, valor: true } }),
    // ClassificacaoProduto é por produto+cor desde 2026-11-19 — getClassificacaoPorCods resolve a
    // cor real de cada cod por fora (nunca armazenada em EstoqueMinimoManual nem aqui).
    getClassificacaoPorCods(cods),
    getVendaMediaDiariaPorCod(cods),
    prisma.productionOrder.findMany({
      where: {
        cod: { in: cods },
        status: "Finalizado",
        dataEntradaCelula: { not: null },
        dataFinalizacaoProducao: { not: null },
      },
      select: { cod: true, dataEntradaCelula: true, dataFinalizacaoProducao: true },
    }),
  ]);

  const minimoPorCod = new Map(minimos.map((m) => [m.cod, m.valor]));
  const tipoCompraPorCod = new Map([...classificacoes.entries()].map(([cod, c]) => [cod, c.tipoCompra as string]));

  const ordensPorCod = new Map<string, { dataEntradaCelula: Date; dataFinalizacaoProducao: Date }[]>();
  for (const o of ordensProducao) {
    // where já garante not null, mas o tipo do Prisma ainda é Date | null — guarda explícita.
    if (!o.dataEntradaCelula || !o.dataFinalizacaoProducao) continue;
    const lista = ordensPorCod.get(o.cod) ?? [];
    lista.push({ dataEntradaCelula: o.dataEntradaCelula, dataFinalizacaoProducao: o.dataFinalizacaoProducao });
    ordensPorCod.set(o.cod, lista);
  }

  const itens: ItemMinimoManual[] = comparacao.variantes.map((v) => {
    // Soma direta de estoqueAtual de TODAS as posições — seguro, estoqueAtual é saldo físico
    // direto (nunca sofre o problema de dupla contagem que vendasDias30/60/90 tem via
    // vendasEfetivasCdSite). NUNCA somar porLoja[].velocidadeDiaria/vendasDiasXX aqui.
    const estoqueConsolidado = v.porLoja.reduce((soma, l) => soma + l.estoqueAtual, 0);
    const minimoDefinido = minimoPorCod.get(v.cod) ?? null;
    const velocidadeDiariaConsolidada = velocidadePorCod.get(v.cod)?.mediaDiaria ?? 0;
    const tempoMedioProducaoDias = mediaDiasProducao(ordensPorCod.get(v.cod) ?? []);

    const diferenca = minimoDefinido != null ? estoqueConsolidado - minimoDefinido : null;
    const percentualCobertura =
      minimoDefinido != null && minimoDefinido > 0 ? (estoqueConsolidado / minimoDefinido) * 100 : null;
    const diasAteCruzarMinimo =
      minimoDefinido != null && velocidadeDiariaConsolidada > 0
        ? (estoqueConsolidado - minimoDefinido) / velocidadeDiariaConsolidada
        : null;

    const nivelAlerta = calcularNivelAlertaMinimoManual({
      minimoDefinido,
      estoqueConsolidado,
      diasAteCruzarMinimo,
      tempoMedioProducaoDias,
    });

    return {
      cod: v.cod,
      produto: v.produto,
      grupo: v.grupo,
      cor: v.cor,
      tamanho: v.tamanho,
      tipoCompra: tipoCompraPorCod.get(v.cod) ?? null,
      minimoDefinido,
      estoqueConsolidado,
      diferenca,
      percentualCobertura,
      velocidadeDiariaConsolidada,
      tempoMedioProducaoDias,
      diasAteCruzarMinimo,
      nivelAlerta,
      porLoja: v.porLoja,
    };
  });

  itens.sort((a, b) => {
    const peso = PESO_ORDENACAO_NIVEL[a.nivelAlerta] - PESO_ORDENACAO_NIVEL[b.nivelAlerta];
    if (peso !== 0) return peso;
    return a.produto.localeCompare(b.produto, "pt-BR") || (a.tamanho ?? "").localeCompare(b.tamanho ?? "", "pt-BR");
  });

  return itens;
}

// Ajuste do mínimo manual de 1 cod — grava histórico (de/para + quem/quando), nunca inventa valor.
// upsert porque um cod pode nunca ter tido mínimo definido antes (cria a linha na primeira vez).
// valor=null REMOVE o mínimo (volta a "sem mínimo definido") — a linha continua existindo (nunca
// deletada, `valor` é nullable de propósito) pra preservar o histórico de quem definiu/removeu.
export async function atualizarEstoqueMinimoManual(cod: string, valor: number | null, alteradoPor?: string) {
  const existente = await prisma.estoqueMinimoManual.findUnique({ where: { cod } });

  const salvo = await prisma.estoqueMinimoManual.upsert({
    where: { cod },
    create: { cod, valor, atualizadoPor: alteradoPor ?? null },
    update: { valor, atualizadoPor: alteradoPor ?? null },
  });

  if (!existente || existente.valor !== valor) {
    await prisma.estoqueMinimoManualHistorico.create({
      data: {
        estoqueMinimoManualId: salvo.id,
        valorAnterior: existente?.valor ?? null,
        valorNovo: valor,
        alteradoPor: alteradoPor ?? null,
      },
    });
  }

  return salvo;
}

export async function getHistoricoEstoqueMinimoManual(cod: string) {
  const m = await prisma.estoqueMinimoManual.findUnique({ where: { cod } });
  if (!m) return [];
  return prisma.estoqueMinimoManualHistorico.findMany({
    where: { estoqueMinimoManualId: m.id },
    orderBy: { alteradoEm: "desc" },
  });
}
