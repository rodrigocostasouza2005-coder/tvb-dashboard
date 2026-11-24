import { prisma } from "@/lib/prisma";
import type { TipoCompraProduto } from "@prisma/client";
import {
  getComparacaoCompleta,
  diagnosticarVariante,
  calcularRecemLancado,
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

// Extraída pra reuso em planejamento-distribuicao.ts (Fase 2B, ajuste de regra Rodrigo
// 2026-11-16) — mesma fórmula de agregação por produto, sem duplicar.
export function classificarAgregado(tipos: Set<TipoCompraProduto>): ClassificacaoAgregada {
  return tipos.size === 0 ? "NAO_CLASSIFICADO" : tipos.size > 1 ? "MISTO" : (tipos.values().next().value as ClassificacaoAgregada);
}

// "crescimento"/"desaceleracao" comparam vendasDias30 contra a janela ANTERIOR de 30 dias
// (vendasDias60 - vendasDias30) — nunca ano-contra-ano (Fase 0 confirmou: só ~14 meses de
// histórico real, sem baseline confiável antes de set/2025). 20% de margem antes de marcar
// tendência, pra não reagir a ruído normal de venda. "sem_dado" quando não confiável (<14 dias de
// histórico) ou quando as duas janelas são zero (nenhum sinal em nenhum sentido).
export type Tendencia = "crescimento" | "estavel" | "desaceleracao" | "sem_dado";

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
  tendencia: Tendencia;
  // true quando situacao é ruptura/cobertura_critica — não é um número calculado de "quanto
  // venderia sem a ruptura" (isso exigiria saber QUANDO o estoque zerou, dado que não existe:
  // StockSnapshot não guarda série histórica, Fase 0 §2.1). É só um aviso honesto: a venda
  // observada pode estar subestimando a demanda real porque faltou produto pra vender, não
  // porque faltou interesse — nunca inventa o número que os dados não sustentam.
  demandaPossivelmenteMascarada: boolean;
  quantidadeEmTransito: number;
  // Sempre false hoje: ProductionOrder não tem data de chegada confiável (ver RecebimentoPrevisto
  // em compras-inteligencia.ts) — exposto aqui pra UI nunca tratar trânsito como certeza.
  transitoConfiavel: boolean;
  necessidadeReposicao: boolean;
};

function calcularTendencia(vendasDias30: number, vendasDias60: number, confiavel: boolean): Tendencia {
  if (!confiavel) return "sem_dado";
  const anterior = vendasDias60 - vendasDias30;
  if (anterior === 0 && vendasDias30 === 0) return "sem_dado";
  if (anterior === 0) return "crescimento"; // tinha 0 antes, passou a vender — sinal real, não ruído
  if (vendasDias30 > anterior * 1.2) return "crescimento";
  if (vendasDias30 < anterior * 0.8) return "desaceleracao";
  return "estavel";
}

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
    tipos: Set<TipoCompraProduto>;
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

  const [v30, v60, v90, historico, pedidosAberto, producoesPorProduto] = await Promise.all([
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos }, saleDate: { gte: desde(30) } }, _sum: { quantidade: true } }),
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos }, saleDate: { gte: desde(60) } }, _sum: { quantidade: true } }),
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos }, saleDate: { gte: desde(90) } }, _sum: { quantidade: true } }),
    prisma.sale.groupBy({ by: ["produto"], where: { status: { not: "Cancelada" }, produto: { in: produtos } }, _min: { saleDate: true } }),
    getPedidosEmAbertoPorCod(todosCods),
    // Correção "estoque_parado" vs. "lancamento_recente" (ver diagnosticarVariante/
    // calcularRecemLancado, distribuicao-estoque.ts): primeira produção finalizada por PRODUTO
    // (não por cod aqui — este é o grão agregado da tabela principal), mesma fonte confiável
    // (ProductionOrder, 0 lacuna de data quando Finalizado) usada no motor de distribuição.
    prisma.productionOrder.groupBy({
      by: ["produto"],
      where: { produto: { in: produtos }, status: "Finalizado", dataFinalizacaoProducao: { not: null } },
      _min: { dataFinalizacaoProducao: true },
    }),
  ]);

  const v30ByProduto = new Map(v30.map((r) => [r.produto, r._sum.quantidade ?? 0]));
  const v60ByProduto = new Map(v60.map((r) => [r.produto, r._sum.quantidade ?? 0]));
  const v90ByProduto = new Map(v90.map((r) => [r.produto, r._sum.quantidade ?? 0]));
  const primeiraVendaByProduto = new Map(historico.map((r) => [r.produto, r._min.saleDate]));
  const primeiraProducaoByProduto = new Map(producoesPorProduto.map((r) => [r.produto, r._min.dataFinalizacaoProducao]));

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
    // Correção "estoque_parado" vs. "lancamento_recente" (achado da auditoria de Fase 1, §3.1):
    // só é "recém-lançado" quando o produto NUNCA vendeu (primeira===null) E a produção mais
    // antiga conhecida é recente — nunca pra um produto que já vendeu antes e parou.
    const recemLancado = calcularRecemLancado({
      primeiraVenda: primeira,
      primeiraProducaoFinalizada: primeiraProducaoByProduto.get(acc.produto) ?? null,
      agora: agora(),
    });
    // "loja" (não "cd_site") como referência de limiar de excesso no agregado por produto —
    // blenda CD+lojas num número só, e o limiar mais conservador (60d, não 90d) é a escolha mais
    // segura pra não mascarar excesso real só porque o CD tolera mais profundidade.
    const situacao = diagnosticarVariante(
      { estoqueAtual: acc.estoqueTotal, vendasDias30, vendasDias90, velocidadeDiaria, coberturaDias },
      "loja",
      { recemLancado }
    );
    const classificacao: ClassificacaoAgregada = classificarAgregado(acc.tipos);
    const cods = [...acc.cods];
    const recebimentos = cods.flatMap((c) => pedidosAberto.get(c) ?? []);
    const quantidadeEmTransito = recebimentos.reduce((s, r) => s + r.quantidade, 0);
    const transitoConfiavel = recebimentos.length > 0 && recebimentos.every((r) => r.confiavel);
    const tendencia = calcularTendencia(vendasDias30, vendasDias60, confiavel);
    const necessidadeReposicao = situacao === "ruptura" || situacao === "cobertura_critica";

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
      tendencia,
      demandaPossivelmenteMascarada: necessidadeReposicao,
      quantidadeEmTransito,
      transitoConfiavel,
      necessidadeReposicao,
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
  // Venda própria dessa posição (30d/90d) — pra CD/Site esse número já inclui a demanda das
  // lojas que ele abastece (vendasEfetivasCdSite, distribuicao-estoque.ts), é o giro aparente
  // DAQUELA posição, não "venda da empresa". Por isso nunca é somado entre posições em lugar
  // nenhum deste módulo (ver comentário em getProdutosPlanejamento) — só exibido aqui pra
  // comparar demanda relativa ENTRE lojas, seguro mesmo com a correção do CD embutida.
  vendasDias30: number;
  vendasDias90: number;
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
  // Inconsistência real encontrada e corrigida aqui (Fase 2, 2026-11-16): a primeira versão
  // (Fase 1) mantinha coberturaDias/diagnostico do PRIMEIRO cod visto por loja e só somava
  // estoqueAtual dos demais — pra produto com várias cores/tamanhos, a cobertura/diagnóstico
  // exibidos vinham de 1 SKU arbitrário, não do agregado real daquela loja. Agora acumula
  // estoqueAtual + vendasDias30/90 de TODOS os cods do produto por loja, e só então recalcula
  // coberturaDias/diagnostico com diagnosticarVariante (mesma função pura usada no total do
  // produto) — consistente com o resto do módulo, nunca um valor "sobrevivente" de 1 SKU só.
  type AccLoja = { posicaoId: string; posicaoNome: string; tipoPosicao: "loja" | "cd_site"; estoqueAtual: number; vendasDias30: number; vendasDias90: number };
  const porLojaMap = new Map<string, AccLoja>();
  for (const v of doProduto) {
    for (const l of v.porLoja) {
      const atual = porLojaMap.get(l.storeId) ?? { posicaoId: l.storeId, posicaoNome: l.storeName, tipoPosicao: l.tipoPosicao, estoqueAtual: 0, vendasDias30: 0, vendasDias90: 0 };
      atual.estoqueAtual += l.estoqueAtual;
      atual.vendasDias30 += l.vendasDias30;
      atual.vendasDias90 += l.vendasDias90;
      porLojaMap.set(l.storeId, atual);
    }
  }
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 86_400_000);
  const [evolucaoVendas, pedidosAberto, recBS, recDrop, primeiraVendaProduto, primeiraProducaoProduto] = await Promise.all([
    getDailySalesByProduto({ storeIds: filtro.storeIdsPermitidas, from, to }, produto),
    getPedidosEmAbertoPorCod(cods),
    getRecomendacoesBestSeller({ grupoIn: [grupo] }),
    getRecomendacoesDrop({ grupoIn: [grupo] }),
    // Correção "estoque_parado" vs. "lancamento_recente" (mesma fonte/régua do agregado em
    // getProdutosPlanejamento, aqui num único aggregate — é 1 produto só, groupBy seria overkill).
    prisma.sale.aggregate({ where: { status: { not: "Cancelada" }, produto }, _min: { saleDate: true } }),
    prisma.productionOrder.aggregate({
      where: { produto, status: "Finalizado", dataFinalizacaoProducao: { not: null } },
      _min: { dataFinalizacaoProducao: true },
    }),
  ]);

  const recemLancado = calcularRecemLancado({
    primeiraVenda: primeiraVendaProduto._min.saleDate,
    primeiraProducaoFinalizada: primeiraProducaoProduto._min.dataFinalizacaoProducao,
    agora: to,
  });

  const porLoja: LojaDetalhe[] = [...porLojaMap.values()]
    .map((l) => {
      const velocidadeDiaria = l.vendasDias90 > 0 ? l.vendasDias90 / 90 : 0;
      const coberturaDias = velocidadeDiaria > 0 ? Math.round((l.estoqueAtual / velocidadeDiaria) * 10) / 10 : null;
      const diagnostico = diagnosticarVariante(
        { estoqueAtual: l.estoqueAtual, vendasDias30: l.vendasDias30, vendasDias90: l.vendasDias90, velocidadeDiaria, coberturaDias },
        l.tipoPosicao,
        { recemLancado }
      );
      return { posicaoId: l.posicaoId, posicaoNome: l.posicaoNome, tipoPosicao: l.tipoPosicao, estoqueAtual: l.estoqueAtual, vendasDias30: l.vendasDias30, vendasDias90: l.vendasDias90, coberturaDias, diagnostico };
    })
    .sort((a, b) => a.posicaoNome.localeCompare(b.posicaoNome, "pt-BR"));

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
