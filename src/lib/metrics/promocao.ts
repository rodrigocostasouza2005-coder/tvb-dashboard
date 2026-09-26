import { prisma } from "@/lib/prisma";
import { getVarejoPriceMap, resolveSellThrough } from "./estoque";
import type { DashboardFilters } from "./core";

// Regra de desconto extraída da planilha real do Rodrigo (ANALISE_BLACK_FRIDAY - 2026.xlsx,
// abas "sellthrough"/"analise"/"valor possível", auditada em 2026-09-25). A planilha calcula,
// por PRODUTO: desconto = BESTSELLER ? 10% fixo : lookup numa matriz Coleção × faixa de
// sell-through (INDEX/MATCH com MATCH tipo -1, que acha a MENOR faixa que ainda é >= ao
// sell-through real — equivale a "arredonda pra cima" pra faixa mais próxima). Sem entrada na
// matriz (coleção não mapeada) cai no fallback de 10% (IFERROR da planilha).
//
// Isso é curadoria manual do Rodrigo por campanha/coleção — centralizado aqui (promotionRules)
// pra não espalhar número mágico pelos componentes, e fácil de editar quando uma campanha nova
// tiver coleções diferentes. Faixas em ORDEM DECRESCENTE (100/75/50/25), mesma ordem da planilha
// original.
export const promotionRules = {
  faixasSellThrough: [100, 75, 50, 25] as const,
  descontoBestseller: 0.10,
  descontoPadrao: 0.10, // fallback quando a coleção não tem linha na matriz (= IFERROR da planilha)
  matrizPorColecao: {
    "V26.1": [0.30, 0.30, 0.35, 0.40],
    "Drop1 Inverno.26": [0.20, 0.20, 0.25, 0.30],
    "Drop 2 Inverno 26": [0.15, 0.15, 0.20, 0.20],
  } as Record<string, number[]>,
};

export type DescontoRecomendado = { desconto: number; motivo: string };

export function getDescontoRecomendado(colecao: string, sellThroughRate: number | null): DescontoRecomendado {
  if (colecao === "BESTSELLER") {
    return { desconto: promotionRules.descontoBestseller, motivo: "Bestseller — desconto simbólico fixo, não depende do sell-through" };
  }
  const linha = promotionRules.matrizPorColecao[colecao];
  if (!linha || sellThroughRate === null) {
    return { desconto: promotionRules.descontoPadrao, motivo: "Coleção sem regra de desconto definida — usando padrão" };
  }
  const faixas = promotionRules.faixasSellThrough;
  let idx = faixas.length - 1;
  for (let i = 0; i < faixas.length; i++) {
    if (faixas[i] >= sellThroughRate) { idx = i; break; }
  }
  const desconto = linha[idx];
  const faixaLabel = idx === 0 ? "acima de 75%" : idx === faixas.length - 1 ? `até ${faixas[idx]}%` : `${faixas[idx]}%–${faixas[idx - 1]}%`;
  const motivo =
    sellThroughRate <= 25
      ? `Sell-through baixo (faixa ${faixaLabel}) — estoque parado, desconto maior pra girar`
      : sellThroughRate >= 75
        ? `Sell-through alto (faixa ${faixaLabel}) — já vende bem, desconto mínimo`
        : `Sell-through moderado (faixa ${faixaLabel})`;
  return { desconto, motivo };
}

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
      where: { ...grupoWhere, ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}) },
      select: { grupo: true, produto: true, colecao: true, cod: true, quantidadeDisponivel: true },
    }),
    getVarejoPriceMap(),
  ]);

  // Estoque empresa toda (ignora filtro de loja) — denominador do sell-through, mesma regra de
  // getStockVsSales.
  const stockEmpresaRows = filters.storeIds === undefined
    ? stockRows
    : await prisma.stockSnapshot.findMany({ where: grupoWhere, select: { grupo: true, produto: true, colecao: true, quantidadeDisponivel: true } });

  const [vendasEmpresa, producaoEmpresa] = await Promise.all([
    prisma.sale.groupBy({ by: ["grupo", "produto", "colecao"], where: { ...grupoWhere, colecao: { not: null } }, _sum: { quantidade: true } }),
    prisma.productionOrder.groupBy({ by: ["grupo", "produto", "colecao"], where: { ...grupoWhere, colecao: { not: null } }, _sum: { quantidade: true } }),
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
