import { prisma } from "@/lib/prisma";
import { getVendaMediaDiariaPorCod } from "./compras-inteligencia";

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
  // null = SEM mínimo cadastrado ainda (achado real em 2026-11-24: os 141 SKUs Best Seller do
  // Neon dev estavam TODOS sem mínimo — o painel aparecia vazio pra sempre, sem nenhum ponto de
  // partida pra cadastrar o primeiro valor). Esses itens agora aparecem aqui também, como chamada
  // pra ação, não só quem já tem mínimo e está com falta.
  estoqueMinimo: number | null;
  // estoqueMinimo - quantidadeDisponivel. null quando não há mínimo definido ainda (nunca inventa
  // uma falta sem régua — mesma regra de getEstoqueMinimoManual/SEM_MINIMO_DEFINIDO).
  falta: number | null;
  // Venda média diária consolidada (rede toda) — só pra alimentar a sugestão informativa de
  // MinimoManualForm (mesmo componente de edição inline reaproveitado de
  // estoque-minimo-manual/forms.tsx, pedido do Rodrigo em 2026-11-24: editar o mínimo direto no
  // card, sem trocar de aba). Nunca usado pra decidir falta/alerta aqui, só pro texto de ajuda.
  velocidadeDiariaConsolidada: number;
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
// CD/Site) e o mapa de mínimos já definidos, devolve os SKUs Best Seller que precisam de alguma
// ação: falta real (já tem mínimo, estoque abaixo dele) OU sem mínimo cadastrado ainda (falta=null,
// chamada pra ação de cadastrar — ver achado de 2026-11-24 no comentário do tipo acima). Só fica de
// fora quem já tem mínimo e está OK. Testável com dado sintético, mesmo padrão de
// reposicao-sinais.ts/distribuicao-estoque.ts.
//
// Achado real no Neon dev (2026-11-23): ~9% dos cods (242 de 2.681) têm `colecao` DIVERGENTE entre
// posições — provável ruído de timing de sync por loja contra o DAPIC, não uma mudança real de
// coleção do produto. Por isso a pertença a Best Seller é decidida por cod (qualquer posição com
// colecao="BESTSELLER" já qualifica o cod inteiro) e a SOMA do disponível usa TODAS as posições
// daquele cod, mesmo as que vieram com `colecao` diferente nessa sync específica — nunca
// sub-contar o estoque real só por causa de um rótulo de coleção inconsistente numa posição.
export function agregarReposicaoBestSellerConsolidada(
  stockRows: StockRow[],
  minimosPorCod: Map<string, number>, // só cods com EstoqueMinimoManual.valor != null
  velocidadePorCod: Map<string, number> = new Map() // mediaDiaria por cod, default 0 (testes antigos não precisam passar)
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
    const estoqueMinimoDefinido = minimosPorCod.get(cod) ?? null;
    const quantidadeDisponivel = disponivelPorCod.get(cod) ?? 0;
    // Com mínimo definido e sem falta real: já está OK, não precisa de ação — único caso que
    // fica de fora. Sem mínimo (precisa cadastrar) ou com falta real (precisa repor) — os dois
    // aparecem, porque os dois pedem uma ação do Rodrigo.
    if (estoqueMinimoDefinido != null && quantidadeDisponivel >= estoqueMinimoDefinido) continue;
    const meta = metaPorCod.get(cod)!;
    itens.push({
      cod,
      ...meta,
      quantidadeDisponivel,
      estoqueMinimo: estoqueMinimoDefinido,
      falta: estoqueMinimoDefinido != null ? estoqueMinimoDefinido - quantidadeDisponivel : null,
      velocidadeDiariaConsolidada: velocidadePorCod.get(cod) ?? 0,
    });
  }

  // Maior falta primeiro (prioridade de reposição); "sem mínimo definido" (falta=null) vai por
  // último, depois de toda falta real — é uma ação pendente, mas menos urgente que repor algo que
  // já sabemos que está em falta. Produto em ordem alfabética desempata nos dois grupos.
  itens.sort((a, b) => {
    if (a.falta == null && b.falta == null) return a.produto.localeCompare(b.produto, "pt-BR");
    if (a.falta == null) return 1;
    if (b.falta == null) return -1;
    return b.falta - a.falta || a.produto.localeCompare(b.produto, "pt-BR");
  });
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

  const [minimos, velocidades] = await Promise.all([
    prisma.estoqueMinimoManual.findMany({
      where: { cod: { in: cods }, valor: { not: null } },
      select: { cod: true, valor: true },
    }),
    getVendaMediaDiariaPorCod(cods),
  ]);
  const minimosPorCod = new Map(minimos.map((m) => [m.cod, m.valor as number]));
  const velocidadePorCod = new Map([...velocidades].map(([cod, v]) => [cod, v.mediaDiaria]));

  return agregarReposicaoBestSellerConsolidada(stockRows, minimosPorCod, velocidadePorCod);
}
