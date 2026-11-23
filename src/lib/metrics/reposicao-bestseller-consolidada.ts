import { prisma } from "@/lib/prisma";

// Reposição Best Seller CONSOLIDADA na empresa (pedido do Rodrigo, 2026-11-23) — painel novo
// dentro de Planejamento de Estoque (ver planejamento-estoque/reposicao-bestseller.tsx). 1 card
// por SKU (cod = produto+cor+tamanho) somando TODA a rede (lojas + CD/Site), nunca por loja
// individual — isso já existe na tela de Reposição de lojas (reposicao/page.tsx, getReplenishment),
// que não é tocada por este arquivo.
//
// === Fonte de "Best Seller": colecao, NÃO ClassificacaoProduto ===
// Pedido original pedia filtrar por ClassificacaoProduto.tipoCompra = BEST_SELLER. Revisado pelo
// Rodrigo em 2026-11-23: esse processo de classificação manual nunca foi operacionalizado de
// verdade (dado não confiável pra decidir o que entra num painel). Em vez disso, usa o campo
// `colecao` já sincronizado do DAPIC em StockSnapshot: a coleção literal "BESTSELLER" é o Best
// Seller real da empresa (demais coleções são Drops sazonais — V26.1, Drop 2 Inverno 26, Verão
// 27, Drop1 Inverno.26, AV 27). Confirmado contra o Neon dev antes de implementar
// (prisma.stockSnapshot.groupBy(["colecao"])) — sem variação de maiúscula/espaço no valor.
export const COLECAO_BEST_SELLER = "BESTSELLER";

export type ItemReposicaoBestSellerConsolidada = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  // Soma de quantidadeDisponivel em TODAS as posições (lojas + CD/Site) que o usuário pode ver —
  // nunca uma loja isolada.
  quantidadeDisponivel: number;
  // EstoqueMinimoManual.valor pro cod. IMPORTANTE: este valor já É único por cod pra EMPRESA TODA
  // (ver comentário do model EstoqueMinimoManual em prisma/schema.prisma: "a quantidade que a
  // EMPRESA decidiu manter... somando TODAS as posições"). Não existe "mínimo por loja" aqui pra
  // agregar — o único trabalho de consolidação real deste painel é do lado do ESTOQUE
  // (quantidadeDisponivel), não do mínimo, que já chega pronto.
  estoqueMinimo: number;
  // estoqueMinimo - quantidadeDisponivel. Sempre > 0 nos itens retornados (o filtro abaixo só
  // deixa passar falta real).
  falta: number;
};

type StockRow = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  quantidadeDisponivel: number;
};

// Função PURA (sem Prisma) — recebe linhas de estoque já carregadas (qualquer posição: loja ou
// CD/Site) e o mapa de mínimos já definidos, devolve só os SKUs Best Seller com falta real
// agregada. Testável com dado sintético, mesmo padrão de reposicao-sinais.ts/distribuicao-estoque.ts.
//
// Achado real no Neon dev (2026-11-23): ~9% dos cods (242 de 2.681) têm `colecao` DIVERGENTE entre
// posições — provável ruído de timing de sync por loja contra o DAPIC, não uma mudança real de
// coleção do produto. Por isso a pertença a Best Seller é decidida por cod (qualquer posição com
// colecao="BESTSELLER" já qualifica o cod inteiro) e a SOMA do disponível usa TODAS as posições
// daquele cod, mesmo as que vieram com `colecao` diferente nessa sync específica — nunca
// sub-contar o estoque real só por causa de um rótulo de coleção inconsistente numa posição.
export function agregarReposicaoBestSellerConsolidada(
  stockRows: StockRow[],
  minimosPorCod: Map<string, number> // só cods com EstoqueMinimoManual.valor != null
): ItemReposicaoBestSellerConsolidada[] {
  const codsBestSeller = new Set(
    stockRows.filter((r) => r.colecao === COLECAO_BEST_SELLER).map((r) => r.cod)
  );
  if (codsBestSeller.size === 0) return [];

  const disponivelPorCod = new Map<string, number>();
  const metaPorCod = new Map<string, { produto: string; grupo: string; cor: string | null; tamanho: string | null }>();
  for (const r of stockRows) {
    if (!codsBestSeller.has(r.cod)) continue;
    disponivelPorCod.set(r.cod, (disponivelPorCod.get(r.cod) ?? 0) + r.quantidadeDisponivel);
    if (!metaPorCod.has(r.cod)) {
      metaPorCod.set(r.cod, { produto: r.produto, grupo: r.grupo, cor: r.cor, tamanho: r.tamanho });
    }
  }

  const itens: ItemReposicaoBestSellerConsolidada[] = [];
  for (const cod of codsBestSeller) {
    const estoqueMinimo = minimosPorCod.get(cod);
    // Sem mínimo cadastrado: nunca aparece como "falta" sem régua definida (mesma regra de
    // getEstoqueMinimoManual — SEM_MINIMO_DEFINIDO nunca é tratado como crítico por adivinhação).
    if (estoqueMinimo == null) continue;
    const quantidadeDisponivel = disponivelPorCod.get(cod) ?? 0;
    if (quantidadeDisponivel >= estoqueMinimo) continue; // sem falta real
    const meta = metaPorCod.get(cod)!;
    itens.push({ cod, ...meta, quantidadeDisponivel, estoqueMinimo, falta: estoqueMinimo - quantidadeDisponivel });
  }

  // Maior falta primeiro (prioridade de reposição), depois produto em ordem alfabética.
  itens.sort((a, b) => b.falta - a.falta || a.produto.localeCompare(b.produto, "pt-BR"));
  return itens;
}

// Camada de DADO (Prisma) — carrega TODAS as posições de estoque (sem filtrar por colecao na
// query, pelo motivo documentado acima) restritas só pela permissão do usuário, e os mínimos já
// cadastrados, e delega o cálculo real à função pura acima.
export async function getReposicaoBestSellerConsolidada(filtro: {
  storeIdsPermitidas?: string[];
  grupoIn?: string[];
} = {}): Promise<ItemReposicaoBestSellerConsolidada[]> {
  const stockRows = await prisma.stockSnapshot.findMany({
    where: {
      ...(filtro.storeIdsPermitidas ? { storeId: { in: filtro.storeIdsPermitidas } } : {}),
      ...(filtro.grupoIn ? { grupo: { in: filtro.grupoIn } } : {}),
    },
    select: { cod: true, produto: true, grupo: true, cor: true, tamanho: true, colecao: true, quantidadeDisponivel: true },
  });
  if (stockRows.length === 0) return [];

  const cods = [...new Set(stockRows.filter((r) => r.colecao === COLECAO_BEST_SELLER).map((r) => r.cod))];
  if (cods.length === 0) return [];

  const minimos = await prisma.estoqueMinimoManual.findMany({
    where: { cod: { in: cods }, valor: { not: null } },
    select: { cod: true, valor: true },
  });
  const minimosPorCod = new Map(minimos.map((m) => [m.cod, m.valor as number]));

  return agregarReposicaoBestSellerConsolidada(stockRows, minimosPorCod);
}
