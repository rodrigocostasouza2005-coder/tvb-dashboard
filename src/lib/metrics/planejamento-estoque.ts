import { prisma } from "@/lib/prisma";
import {
  getComparacaoCompleta,
  diagnosticarVariante,
  type ComparacaoFiltro,
  type Diagnostico,
} from "./distribuicao-estoque";
import { getPedidosEmAbertoPorCod, getRecomendacoesBestSeller, getRecomendacoesDrop } from "./compras-inteligencia";
import { getDailySalesByProduto, type DailyProdutoPoint } from "./vendas";

// Fase 1 do Planejamento Inteligente de Estoque (pedido do Rodrigo, 2026-11-16). Visão por
// PRODUTO (nome), não por cod isolado — "não misturar cores de forma que distorça a curva de
// tamanhos" é respeitado mantendo cor como dimensão própria no detalhe (getProdutoPlanejamentoDetalhe),
// nunca blendada.
//
// Reaproveita getComparacaoCompleta() (distribuicao-estoque.ts) como base de estoque/posição —
// já testado, já em produção, já resolve CD+Atacado como 1 posição e filtra armazém-lixo. Não
// recalcula estoque do zero.

const MIN_DIAS_HISTORICO_CONFIAVEL = 14; // mesmo limiar de compras-inteligencia.ts

export type ClassificacaoAgregada = "BEST_SELLER" | "DROP" | "MISTO" | "NAO_CLASSIFICADO";

export type ProdutoPlanejamento = {
  produto: string;
  grupo: string;
  classificacao: ClassificacaoAgregada;
  cods: string[];
  estoqueTotal: number;
  estoqueCD: number;
  estoqueLojas: number;
  vendasDias30: number;
  vendasDias60: number;
  vendasDias90: number;
  velocidadeDiaria: number;
  coberturaDias: number | null;
  diasHistoricoDisponivel: number;
  confiavel: boolean;
  situacao: Diagnostico;
  quantidadeEmTransito: number;
  // Sempre false hoje: ProductionOrder não tem data de chegada confiável (ver RecebimentoPrevisto
  // em compras-inteligencia.ts) — exposto aqui pra UI nunca tratar trânsito como certeza.
  transitoConfiavel: boolean;
  necessidadeReposicao: boolean;
};

function agora() {
  return new Date();
}
function desde(dias: number) {
  return new Date(agora().getTime() - dias * 86_400_000);
}

export async function getProdutosPlanejamento(filtro: ComparacaoFiltro = {}): Promise<ProdutoPlanejamento[]> {
  const { variantes } = await getComparacaoCompleta(filtro);
  if (variantes.length === 0) return [];

  // Estoque por posição (estoqueAtual) nunca é corrigido por proxy — soma direta é segura.
  // Vendas NÃO vêm de porLoja[].vendasDias30: a posição CD/Site ali já embute a demanda das
  // lojas como proxy de giro real do CD (vendasEfetivasCdSite, distribuicao-estoque.ts:113-129)
  // — somar isso de novo com a venda própria da loja contaria a mesma demanda duas vezes. Vendas
  // da empresa inteira (o que interessa pra velocidade/cobertura por PRODUTO) vêm de uma query
  // direta e independente logo abaixo, sem essa correção.
  type Acc = {
    produto: string;
    grupo: string;
    cods: Set<string>;
    estoqueTotal: number;
    estoqueCD: number;
    estoqueLojas: number;
    tipos: Set<string>;
  };
  const porProduto = new Map<string, Acc>();
  for (const v of variantes) {
    let acc = porProduto.get(v.produto);
    if (!acc) {
      acc = { produto: v.produto, grupo: v.grupo, cods: new Set(), estoqueTotal: 0, estoqueCD: 0, estoqueLojas: 0, tipos: new Set() };
      porProduto.set(v.produto, acc);
    }
    acc.cods.add(v.cod);
    if (v.tipoCompra) acc.tipos.add(v.tipoCompra);
    for (const l of v.porLoja) {
      acc.estoqueTotal += l.estoqueAtual;
      if (l.tipoPosicao === "cd_site") acc.estoqueCD += l.estoqueAtual;
      else acc.estoqueLojas += l.estoqueAtual;
    }
  }

  const produtos = [...porProduto.keys()];
  const todosCods = [...new Set(variantes.map((v) => v.cod))];

  const [v30, v60, v90, historico, pedidosAberto] = await Promise.all([
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos }, saleDate: { gte: desde(30) } }, _sum: { quantidade: true } }),
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos }, saleDate: { gte: desde(60) } }, _sum: { quantidade: true } }),
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos }, saleDate: { gte: desde(90) } }, _sum: { quantidade: true } }),
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos } }, _min: { saleDate: true } }),
    getPedidosEmAbertoPorCod(todosCods),
  ]);

  const v30ByProduto = new Map(v30.map((r) => [r.produto, r._sum.quantidade ?? 0]));
  const v60ByProduto = new Map(v60.map((r) => [r.produto, r._sum.quantidade ?? 0]));
  const v90ByProduto = new Map(v90.map((r) => [r.produto, r._sum.quantidade ?? 0]));
  const primeiraVendaByProduto = new Map(historico.map((r) => [r.produto, r._min.saleDate]));

  const resultado: ProdutoPlanejamento[] = [];
  for (const acc of porProduto.values()) {
    const vendasDias30 = v30ByProduto.get(acc.produto) ?? 0;
    const vendasDias60 = v60ByProduto.get(acc.produto) ?? 0;
    const vendasDias90 = v90ByProduto.get(acc.produto) ?? 0;
    const primeira = primeiraVendaByProduto.get(acc.produto) ?? null;
    const diasHistoricoDisponivel = primeira ? Math.floor((agora().getTime() - primeira.getTime()) / 86_400_000) : 0;
    const confiavel = diasHistoricoDisponivel >= MIN_DIAS_HISTORICO_CONFIAVEL;
    const velocidadeDiaria = confiavel && vendasDias90 > 0 ? vendasDias90 / 90 : 0;
    const coberturaDias = velocidadeDiaria > 0 ? Math.round((acc.estoqueTotal / velocidadeDiaria) * 10) / 10 : null;
    // "loja" (não "cd_site") como referência de limiar de excesso no agregado por produto —
    // blenda CD+lojas num número só, e o limiar mais conservador (60d, não 90d) é a escolha mais
    // segura pra não mascarar excesso real só porque o CD tolera mais profundidade.
    const situacao = diagnosticarVariante(
      { estoqueAtual: acc.estoqueTotal, vendasDias30, vendasDias90, velocidadeDiaria, coberturaDias },
      "loja"
    );
    const classificacao: ClassificacaoAgregada =
      acc.tipos.size === 0 ? "NAO_CLASSIFICADO" : acc.tipos.size > 1 ? "MISTO" : (acc.tipos.values().next().value as ClassificacaoAgregada);
    const cods = [...acc.cods];
    const recebimentos = cods.flatMap((c) => pedidosAberto.get(c) ?? []);
    const quantidadeEmTransito = recebimentos.reduce((s, r) => s + r.quantidade, 0);
    const transitoConfiavel = recebimentos.length > 0 && recebimentos.every((r) => r.confiavel);

    resultado.push({
      produto: acc.produto,
      grupo: acc.grupo,
      classificacao,
      cods,
      estoqueTotal: acc.estoqueTotal,
      estoqueCD: acc.estoqueCD,
      estoqueLojas: acc.estoqueLojas,
      vendasDias30,
      vendasDias60,
      vendasDias90,
      velocidadeDiaria,
      coberturaDias,
      diasHistoricoDisponivel,
      confiavel,
      situacao,
      quantidadeEmTransito,
      transitoConfiavel,
      necessidadeReposicao: situacao === "ruptura" || situacao === "cobertura_critica",
    });
  }

  return resultado.sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
}

export type TamanhoDetalhe = {
  tamanho: string | null;
  estoqueTotal: number;
  estoqueCD: number;
  estoqueLojas: number;
};

export type CorDetalhe = {
  cor: string | null;
  porTamanho: TamanhoDetalhe[];
};

export type LojaDetalhe = {
  posicaoId: string;
  posicaoNome: string;
  tipoPosicao: "loja" | "cd_site";
  estoqueAtual: number;
  coberturaDias: number | null;
  diagnostico: Diagnostico;
};

export type ProdutoPlanejamentoDetalhe = {
  produto: string;
  grupo: string;
  cods: string[];
  porCor: CorDetalhe[];
  porLoja: LojaDetalhe[];
  evolucaoVendas: DailyProdutoPoint[];
  quantidadeEmTransito: number;
  transitoConfiavel: boolean;
  // Presente só quando pelo menos 1 cod do produto já foi classificado Best Seller/Drop — o
  // motor completo (compras-inteligencia.ts) roda por cod, aqui só filtra pro produto aberto,
  // sem reimplementar a conta.
  recomendacoesBestSeller: Awaited<ReturnType<typeof getRecomendacoesBestSeller>>;
  recomendacoesDrop: Awaited<ReturnType<typeof getRecomendacoesDrop>>;
};

export async function getProdutoPlanejamentoDetalhe(
  produto: string,
  filtro: ComparacaoFiltro = {}
): Promise<ProdutoPlanejamentoDetalhe | null> {
  const { variantes } = await getComparacaoCompleta(filtro);
  const doProduto = variantes.filter((v) => v.produto === produto);
  if (doProduto.length === 0) return null;

  const grupo = doProduto[0].grupo;
  const cods = [...new Set(doProduto.map((v) => v.cod))];

  // Curva de tamanho SEMPRE dentro da mesma cor — nunca blenda cores diferentes do mesmo
  // produto, exatamente o risco que getTamanhoBreakdown (estoque.ts) tem e que não deve se
  // repetir aqui (achado da Fase 0, docs/planejamento-inteligente-estoque.md §2.2).
  const porCorMap = new Map<string, Map<string, TamanhoDetalhe>>();
  for (const v of doProduto) {
    const corKey = v.cor ?? "";
    if (!porCorMap.has(corKey)) porCorMap.set(corKey, new Map());
    const porTamanho = porCorMap.get(corKey)!;
    const tamKey = v.tamanho ?? "";
    const atual = porTamanho.get(tamKey) ?? { tamanho: v.tamanho, estoqueTotal: 0, estoqueCD: 0, estoqueLojas: 0 };
    for (const l of v.porLoja) {
      atual.estoqueTotal += l.estoqueAtual;
      if (l.tipoPosicao === "cd_site") atual.estoqueCD += l.estoqueAtual;
      else atual.estoqueLojas += l.estoqueAtual;
    }
    porTamanho.set(tamKey, atual);
  }
  const porCor: CorDetalhe[] = [...porCorMap.entries()]
    .map(([corKey, porTamanho]) => ({ cor: corKey || null, porTamanho: [...porTamanho.values()] }))
    .sort((a, b) => (a.cor ?? "").localeCompare(b.cor ?? "", "pt-BR"));

  // Estoque por loja do produto inteiro (aqui pode somar entre cores/tamanhos sem problema — a
  // regra de "não misturar" é sobre a CURVA DE TAMANHO, não sobre o total por loja).
  const porLojaMap = new Map<string, LojaDetalhe>();
  for (const v of doProduto) {
    for (const l of v.porLoja) {
      const atual = porLojaMap.get(l.storeId);
      if (!atual) {
        porLojaMap.set(l.storeId, {
          posicaoId: l.storeId,
          posicaoNome: l.storeName,
          tipoPosicao: l.tipoPosicao,
          estoqueAtual: l.estoqueAtual,
          coberturaDias: l.coberturaDias,
          diagnostico: l.diagnostico,
        });
      } else {
        atual.estoqueAtual += l.estoqueAtual;
      }
    }
  }
  const porLoja = [...porLojaMap.values()].sort((a, b) => a.posicaoNome.localeCompare(b.posicaoNome, "pt-BR"));

  const to = new Date();
  const from = new Date(to.getTime() - 90 * 86_400_000);
  const [evolucaoVendas, pedidosAberto, recBS, recDrop] = await Promise.all([
    getDailySalesByProduto({ storeIds: filtro.storeIdsPermitidas, from, to }, produto),
    getPedidosEmAbertoPorCod(cods),
    getRecomendacoesBestSeller({ grupoIn: [grupo] }),
    getRecomendacoesDrop({ grupoIn: [grupo] }),
  ]);

  const recebimentos = cods.flatMap((c) => pedidosAberto.get(c) ?? []);
  const quantidadeEmTransito = recebimentos.reduce((s, r) => s + r.quantidade, 0);
  const transitoConfiavel = recebimentos.length > 0 && recebimentos.every((r) => r.confiavel);

  return {
    produto,
    grupo,
    cods,
    porCor,
    porLoja,
    evolucaoVendas,
    quantidadeEmTransito,
    transitoConfiavel,
    recomendacoesBestSeller: recBS.filter((r) => r.produto === produto),
    recomendacoesDrop: recDrop.filter((r) => r.produto === produto),
  };
}
