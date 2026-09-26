import { prisma } from "@/lib/prisma";
import { getVarejoPriceMap, resolveSellThrough } from "./estoque";
import { stockWhere, type DashboardFilters } from "./core";
import { getDescontoRecomendado } from "@/lib/promotion-rules";

// "(sem grupo)" é sempre matéria-prima/insumo (etiqueta, zíper, tecido em rolo), nunca produto de
// verdade à venda — Rodrigo já tinha pedido pra tirar do dashboard inteiro (ver stockWhere em
// core.ts). Bug real achado em 2026-09-26: essa função usava where solto em vez de stockWhere,
// então matéria-prima vazava pra dentro da análise de promoção junto com produto de venda.
const SEM_MATERIA_PRIMA = { grupo: { not: "(sem grupo)" } } as const;

export { promotionRules, getDescontoRecomendado, type DescontoRecomendado } from "@/lib/promotion-rules";

export type PromotionRow = {
  grupo: string;
  produto: string;
  colecao: string;
  precoCheio: number | null;
  estoque: number;
  sellThroughRate: number | null;
  desconto: number;
  motivoDesconto: string;
  precoPromocional: number | null;
  valorEstoqueCheio: number;
  valorEstoquePromo: number;
};

// Chave composta via JSON — grupo/produto/coleção reais têm espaço no nome, então juntar com
// separador simples e quebrar de volta seria ambíguo. A tripla original é guardada à parte
// (triplasPorChave) em vez de reconstruída a partir da string.
function key3(grupo: string, produto: string, colecao: string) {
  return JSON.stringify([grupo, produto, colecao]);
}

// Linha por Grupo+Produto+Coleção (mesma granularidade da aba "analise" da planilha) — dado
// sempre ao vivo do Radar, não um snapshot estático. Sell-through e produção são SEMPRE da
// empresa inteira (mesma convenção já usada em getStockVsSales — não é uma métrica por loja),
// só o "Estoque" exibido respeita o filtro de loja passado em filters.storeIds.
export async function getPromotionRows(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">): Promise<PromotionRow[]> {
  const grupoWhere = filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {};

  const [stockRows, varejoPrices] = await Promise.all([
    prisma.stockSnapshot.findMany({
      where: stockWhere(filters),
      select: { grupo: true, produto: true, colecao: true, cod: true, quantidadeDisponivel: true },
    }),
    getVarejoPriceMap(),
  ]);

  // Estoque empresa toda (ignora filtro de loja) — denominador do sell-through, mesma regra de
  // getStockVsSales.
  const stockEmpresaRows = filters.storeIds === undefined
    ? stockRows
    : await prisma.stockSnapshot.findMany({ where: stockWhere({ grupoIn: filters.grupoIn }), select: { grupo: true, produto: true, colecao: true, quantidadeDisponivel: true } });

  const [vendasEmpresa, producaoEmpresa] = await Promise.all([
    prisma.sale.groupBy({ by: ["grupo", "produto", "colecao"], where: { ...grupoWhere, ...SEM_MATERIA_PRIMA, colecao: { not: null } }, _sum: { quantidade: true } }),
    prisma.productionOrder.groupBy({ by: ["grupo", "produto", "colecao"], where: { ...grupoWhere, ...SEM_MATERIA_PRIMA, colecao: { not: null } }, _sum: { quantidade: true } }),
  ]);

  const triplasPorChave = new Map<string, { grupo: string; produto: string; colecao: string }>();
  const estoqueMap = new Map<string, number>();
  const codPorGrupo = new Map<string, Map<string, number>>(); // key3 -> (cod -> contagem), pra achar o cod mais comum
  for (const r of stockRows) {
    const colecao = r.colecao ?? "(sem coleção)";
    const k = key3(r.grupo, r.produto, colecao);
    triplasPorChave.set(k, { grupo: r.grupo, produto: r.produto, colecao });
    estoqueMap.set(k, (estoqueMap.get(k) ?? 0) + r.quantidadeDisponivel);
    const codCounts = codPorGrupo.get(k) ?? new Map<string, number>();
    codCounts.set(r.cod, (codCounts.get(r.cod) ?? 0) + 1);
    codPorGrupo.set(k, codCounts);
  }

  const estoqueEmpresaMap = new Map<string, number>();
  for (const r of stockEmpresaRows) {
    const colecao = r.colecao ?? "(sem coleção)";
    const k = key3(r.grupo, r.produto, colecao);
    estoqueEmpresaMap.set(k, (estoqueEmpresaMap.get(k) ?? 0) + r.quantidadeDisponivel);
  }

  const vendasMap = new Map<string, number>();
  for (const v of vendasEmpresa) {
    const k = key3(v.grupo, v.produto, v.colecao as string);
    vendasMap.set(k, (vendasMap.get(k) ?? 0) + (v._sum.quantidade ?? 0));
  }

  const producaoMap = new Map<string, number>();
  for (const p of producaoEmpresa) {
    const k = key3(p.grupo, p.produto, p.colecao as string);
    producaoMap.set(k, (producaoMap.get(k) ?? 0) + (p._sum.quantidade ?? 0));
  }

  const rows: PromotionRow[] = [];
  for (const [k, estoque] of estoqueMap) {
    const tripla = triplasPorChave.get(k)!;
    const { grupo, produto, colecao } = tripla;

    const codCounts = codPorGrupo.get(k);
    let precoCheio: number | null = null;
    if (codCounts) {
      let melhorCod: string | null = null;
      let melhorContagem = 0;
      for (const [cod, contagem] of codCounts) {
        if (contagem > melhorContagem) { melhorContagem = contagem; melhorCod = cod; }
      }
      if (melhorCod) precoCheio = varejoPrices.get(melhorCod) ?? null;
    }

    const sellThroughRate = resolveSellThrough(
      vendasMap.get(k) ?? 0,
      estoqueEmpresaMap.get(k) ?? 0,
      producaoMap.get(k) ?? 0
    );

    const { desconto, motivo } = getDescontoRecomendado(colecao, sellThroughRate);
    const precoPromocional = precoCheio !== null ? precoCheio * (1 - desconto) : null;
    const valorEstoqueCheio = precoCheio !== null ? estoque * precoCheio : 0;
    const valorEstoquePromo = precoPromocional !== null ? estoque * precoPromocional : 0;

    rows.push({
      grupo, produto, colecao,
      precoCheio, estoque, sellThroughRate,
      desconto, motivoDesconto: motivo,
      precoPromocional, valorEstoqueCheio, valorEstoquePromo,
    });
  }

  return rows.sort((a, b) => b.valorEstoquePromo - a.valorEstoquePromo);
}
