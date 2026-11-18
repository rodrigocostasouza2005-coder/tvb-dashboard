import { prisma } from "@/lib/prisma";
import { getComparacaoCompleta, type ComparacaoFiltro, type ComparacaoVariante } from "./distribuicao-estoque";
import { getVendaMediaDiariaPorCod } from "./compras-inteligencia";

// Camada 100% nova e aditiva (docs/planejamento-inteligente-estoque.md §19.4/§19.5) — "a soma de
// tudo que a empresa tem agora deste tamanho está abaixo do piso que a TVB decidiu manter?".
// Nunca altera construirOrigem/diagnosticarVariante/calcularSugestaoBestSeller/getExcessosEDistribuicao
// nem aplicarRetencoes — só LÊ dado já calculado por getComparacaoCompleta e a venda consolidada já
// segura de getVendaMediaDiariaPorCod (compras-inteligencia.ts), ambos intocados.

export type NivelAlertaMinimoEmpresarial = "CRITICO" | "ATENCAO" | "NORMAL" | "SEM_MINIMO_DEFINIDO";

export type ItemMinimoEmpresarial = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
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
  nivelAlerta: NivelAlertaMinimoEmpresarial;
  // Breakdown por posição (lojas + CD/Site) — SÓ pra seção de apoio "onde está esse tamanho hoje"
  // na UI. O cálculo do nível de alerta NUNCA usa isto — é sempre o consolidado.
  porLoja: ComparacaoVariante["porLoja"];
};

// Função PURA (sem Prisma) — testável com dado sintético, mesmo padrão de
// diagnosticarVariante/vendasEfetivasCdSite (distribuicao-estoque.ts).
//
// Regra de negócio (já aprovada, §19.5): Crítico é objetivo (o mínimo já foi violado). Atenção é
// "o mínimo seria violado antes que uma nova produção, no tempo médio histórico medido, consiga
// chegar" — nunca um percentual arbitrário, sempre ancorado em 2 dados medidos (venda real +
// produção real). Quando não há tempoMedioProducaoDias suficiente pra aquele cod, o nível NUNCA
// fica "ATENCAO" por adivinhação — cai em NORMAL (se já não for CRITICO); o próprio
// tempoMedioProducaoDias:null no item já comunica "sem dado suficiente" pra UI mostrar isso.
export function calcularNivelAlertaMinimoEmpresarial(input: {
  minimoDefinido: number | null;
  estoqueConsolidado: number;
  diasAteCruzarMinimo: number | null;
  tempoMedioProducaoDias: number | null;
}): NivelAlertaMinimoEmpresarial {
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

const PESO_ORDENACAO_NIVEL: Record<NivelAlertaMinimoEmpresarial, number> = {
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

// Camada de DADO (Prisma) — busca os 3 insumos (classificação Best Seller, posição consolidada via
// getComparacaoCompleta, velocidade segura via getVendaMediaDiariaPorCod) e monta 1 item por cod.
export async function getEstoqueMinimoEmpresarial(filtro: ComparacaoFiltro = {}): Promise<ItemMinimoEmpresarial[]> {
  const [classificacoesBestSeller, comparacao] = await Promise.all([
    prisma.classificacaoProduto.findMany({
      where: { tipoCompra: "BEST_SELLER" },
      select: { cod: true, estoqueMinimoEmpresarial: true },
    }),
    getComparacaoCompleta(filtro),
  ]);

  const minimoPorCod = new Map(classificacoesBestSeller.map((c) => [c.cod, c.estoqueMinimoEmpresarial]));
  const codsBestSeller = new Set(classificacoesBestSeller.map((c) => c.cod));

  const variantesBestSeller = comparacao.variantes.filter((v) => codsBestSeller.has(v.cod));
  if (variantesBestSeller.length === 0) return [];

  const cods = variantesBestSeller.map((v) => v.cod);

  const [velocidadePorCod, ordensProducao] = await Promise.all([
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

  const ordensPorCod = new Map<string, { dataEntradaCelula: Date; dataFinalizacaoProducao: Date }[]>();
  for (const o of ordensProducao) {
    // where já garante not null, mas o tipo do Prisma ainda é Date | null — guarda explícita.
    if (!o.dataEntradaCelula || !o.dataFinalizacaoProducao) continue;
    const lista = ordensPorCod.get(o.cod) ?? [];
    lista.push({ dataEntradaCelula: o.dataEntradaCelula, dataFinalizacaoProducao: o.dataFinalizacaoProducao });
    ordensPorCod.set(o.cod, lista);
  }

  const itens: ItemMinimoEmpresarial[] = variantesBestSeller.map((v) => {
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

    const nivelAlerta = calcularNivelAlertaMinimoEmpresarial({
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
