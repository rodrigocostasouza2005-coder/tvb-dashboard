import { prisma } from "@/lib/prisma";
import { TAMANHOS_NUCLEO, ehTamanhoNucleo } from "./distribuicao-estoque";
import { getRecomendacoesBestSeller, getRecomendacoesDrop, type ComprasFiltro } from "./compras-inteligencia";

// Fase 2A do Planejamento Inteligente de Estoque (2026-11-16) — "quanto comprar" já existe
// (getRecomendacoesBestSeller/Drop, por cod), aqui é só "de qual cor e tamanho".
//
// DIVERGÊNCIA DELIBERADA da worktree órfã (tvb-dashboard-planejamento-estoque,
// feat/planejamento-estoque-20261113, NUNCA mergeada): aquela versão decompunha usando
// getTamanhoBreakdown (estoque.ts), que agrega por NOME do produto SEM cor — Sale/StockSnapshot
// de cores diferentes do mesmo produto cairiam na mesma curva de tamanho, exatamente o risco já
// documentado em docs/planejamento-inteligente-estoque.md §2.2 e que a Fase 1 deste módulo evitou
// de propósito (porCor nunca blenda). Não reaproveitei esse pedaço da worktree — decomponho em
// DUAS passadas (produto→cor, depois cor→tamanho), cada uma usando peso de venda real daquela
// cor/tamanho especificamente, nunca misturado. Documentado aqui em vez de silenciosamente
// "corrigir" getTamanhoBreakdown (que continua como estava, usado em outro lugar do Radar).

export type PesoDecomposicao = { chave: string; vendido: number };

export type ItemDecomposto = {
  chave: string;
  quantidadeSugerida: number;
  participacaoPct: number;
  baseadoEmHistoricoReal: boolean;
};

// Pura, sem Prisma — mesmo algoritmo da worktree órfã (largest remainder method: a soma das
// partes bate EXATAMENTE com quantidadeTotal, nunca diverge por arredondamento), generalizado pra
// qualquer dimensão (cor OU tamanho, chamada 2x em getDecomposicaoGradeProduto) em vez de só
// tamanho. Sem venda em NENHUM item, cai no peso de fallback (núcleo 38/40/42/44 pesa mais que os
// demais SE a dimensão for tamanho — ver pesoFallback) — nunca exclui item, só pesa diferente.
export function decomporProporcional(
  quantidadeTotal: number,
  pesos: PesoDecomposicao[],
  pesoFallback: (chave: string) => number = () => 1
): ItemDecomposto[] {
  const validos = pesos.filter((p) => p.chave);
  if (validos.length === 0 || quantidadeTotal <= 0) return [];

  const totalVendido = validos.reduce((s, p) => s + Math.max(p.vendido, 0), 0);
  const baseadoEmHistoricoReal = totalVendido > 0;

  const pesosEfetivos = validos.map((p) => (baseadoEmHistoricoReal ? Math.max(p.vendido, 0) : pesoFallback(p.chave)));
  const pesoTotal = pesosEfetivos.reduce((s, p) => s + p, 0);

  const brutos = pesosEfetivos.map((p) => (pesoTotal > 0 ? (p / pesoTotal) * quantidadeTotal : 0));
  const base = brutos.map((b) => Math.floor(b));
  const somaBase = base.reduce((s, b) => s + b, 0);
  const resto = Math.round(quantidadeTotal - somaBase);
  const ordemResto = brutos
    .map((b, i) => ({ i, frac: b - base[i] }))
    .sort((a, b) => b.frac - a.frac);
  const quantidades = [...base];
  for (let k = 0; k < resto && k < ordemResto.length; k++) quantidades[ordemResto[k].i] += 1;

  return validos.map((p, i) => ({
    chave: p.chave,
    quantidadeSugerida: quantidades[i],
    participacaoPct: pesoTotal > 0 ? (pesosEfetivos[i] / pesoTotal) * 100 : 0,
    baseadoEmHistoricoReal,
  }));
}

// Peso de fallback do núcleo (38/40/42/44) só entra quando a dimensão é TAMANHO e nenhum tamanho
// vendeu — "destacar, nunca excluir" (mesmo princípio de TAMANHOS_NUCLEO em distribuicao-estoque.ts).
function pesoFallbackTamanho(tamanho: string): number {
  return ehTamanhoNucleo(tamanho) ? 2 : 1;
}

export type GradePorCor = {
  cor: string | null;
  quantidadeSugerida: number;
  participacaoPct: number;
  porTamanho: ItemDecomposto[];
};

export type RecomendacaoGradeProduto = {
  produto: string;
  grupo: string;
  cods: string[];
  quantidadeSugeridaTotal: number;
  valorEstimadoTotal: number | null;
  confiavel: boolean;
  porCor: GradePorCor[];
};

const JANELA_PESO_DIAS = 56; // mesma janela de velocidade usada em getRecomendacoesBestSeller/Drop

// Peso de venda por (cor, tamanho) direto de Sale, SEM passar por porLoja/VariantePorLoja — essa
// é a mesma cautela de dupla contagem documentada em planejamento-estoque.ts (a posição CD/Site
// embute demanda das lojas); pra um peso de PROPORÇÃO entre tamanhos/cores isso não zeraria a
// conta, mas distorceria a proporção real (CD apareceria inflado) sem necessidade — mais simples
// e seguro usar Sale bruta agregada direto.
//
// `cods` restringe a venda aos cods efetivamente CLASSIFICADOS (Best Seller/Drop) desse produto —
// achado real (docs/planejamento-inteligente-estoque.md §16.2 item 2): a maioria dos produtos tem
// só 1-2 de ~10 cods classificados; sem esse filtro, a venda de um cod irmão não classificado
// contaminava o peso usado pra repartir quantidadeSugeridaTotal entre cor/tamanho, podendo alocar
// parte da compra sugerida pra uma cor/tamanho que não é, de fato, Best Seller/Drop.
async function getPesosCorTamanho(produto: string, cods: string[], janela: { from: Date; to: Date }) {
  const rows = await prisma.sale.groupBy({
    by: ["cor", "tamanho"],
    where: { status: { not: "Cancelada" }, produto, cod: { in: cods }, saleDate: { gte: janela.from, lte: janela.to } },
    _sum: { quantidade: true },
  });
  return rows;
}

async function decomporGradeProduto(
  produto: string,
  cods: string[],
  quantidadeSugeridaTotal: number,
  janela: { from: Date; to: Date }
): Promise<GradePorCor[]> {
  if (quantidadeSugeridaTotal <= 0) return [];
  const pesos = await getPesosCorTamanho(produto, cods, janela);

  const porCorMap = new Map<string, { chave: string; vendido: number; porTamanho: PesoDecomposicao[] }>();
  for (const r of pesos) {
    const corKey = r.cor ?? "";
    const entry = porCorMap.get(corKey) ?? { chave: corKey, vendido: 0, porTamanho: [] };
    const vendido = r._sum.quantidade ?? 0;
    entry.vendido += vendido;
    entry.porTamanho.push({ chave: r.tamanho ?? "", vendido });
    porCorMap.set(corKey, entry);
  }
  if (porCorMap.size === 0) return [];

  const decomposicaoCores = decomporProporcional(
    quantidadeSugeridaTotal,
    [...porCorMap.values()].map((c) => ({ chave: c.chave, vendido: c.vendido }))
  );

  return decomposicaoCores.map((dc) => {
    const corInfo = porCorMap.get(dc.chave)!;
    return {
      cor: dc.chave || null,
      quantidadeSugerida: dc.quantidadeSugerida,
      participacaoPct: dc.participacaoPct,
      porTamanho: decomporProporcional(dc.quantidadeSugerida, corInfo.porTamanho, pesoFallbackTamanho).map((t) => ({
        ...t,
        chave: t.chave || "—",
      })),
    };
  });
}

// Agrega getRecomendacoesBestSeller/Drop (por cod, já existentes) pro nível de PRODUTO e decompõe
// em grade (cor→tamanho). Não recalcula "quanto comprar" — só reaproveita a quantidade sugerida
// que o motor de compras já decidiu por cod e redistribui.
export async function getRecomendacaoGradeProduto(
  produto: string,
  filtro: ComprasFiltro = {}
): Promise<RecomendacaoGradeProduto | null> {
  const [bestSellers, drops] = await Promise.all([getRecomendacoesBestSeller(filtro), getRecomendacoesDrop(filtro)]);

  const doBestSeller = bestSellers.filter((r) => r.produto === produto);
  const doDrop = drops.filter((r) => r.produto === produto && r.quantidadeSugerida != null);
  if (doBestSeller.length === 0 && doDrop.length === 0) return null;

  const grupo = (doBestSeller[0] ?? doDrop[0]).grupo;
  const cods = [...new Set([...doBestSeller.map((r) => r.cod), ...doDrop.map((r) => r.cod)])];
  const quantidadeSugeridaTotal =
    doBestSeller.reduce((s, r) => s + r.quantidadeSugerida, 0) + doDrop.reduce((s, r) => s + (r.quantidadeSugerida ?? 0), 0);
  const valorEstimadoTotal =
    [...doBestSeller.map((r) => r.valorEstimado), ...doDrop.map((r) => r.valorEstimado)].every((v) => v == null)
      ? null
      : [...doBestSeller, ...doDrop].reduce((s, r) => s + (r.valorEstimado ?? 0), 0);
  const confiavel = doBestSeller.every((r) => r.confiavel) && doDrop.length === 0; // Drop não tem campo "confiavel" (ver SugestaoDrop) — conservador, só marca confiável se for só Best Seller confiável

  // Best Seller usa a mesma janela de velocidade do motor (56 dias); Drop usa histórico desde
  // sempre (mesmo motivo documentado em getRecomendacoesDropPorProdutoComTamanho da worktree —
  // um Drop lançado há mais de 56 dias ainda pode estar na janela comercial).
  const janela =
    doDrop.length > 0
      ? { from: new Date(0), to: new Date() }
      : { from: new Date(Date.now() - JANELA_PESO_DIAS * 86_400_000), to: new Date() };

  const porCor = await decomporGradeProduto(produto, cods, quantidadeSugeridaTotal, janela);

  return { produto, grupo, cods, quantidadeSugeridaTotal, valorEstimadoTotal, confiavel, porCor };
}

export { TAMANHOS_NUCLEO, ehTamanhoNucleo };
