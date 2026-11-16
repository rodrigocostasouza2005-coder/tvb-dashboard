import { prisma } from "@/lib/prisma";
import { TipoCompraProduto, StatusComercialProduto } from "@prisma/client";
import {
  getComparacaoCompleta,
  getMovimentacoesRecomendadas,
  getHistoricoMovimentacoes,
  construirOrigem,
  type ComparacaoFiltro,
  type MovimentacaoRecomendada,
  type HistoricoMovimentacoes,
  type StatusMovimentacaoRegistro,
} from "./distribuicao-estoque";

// Fase 2B do Planejamento Inteligente de Estoque (pedido do Rodrigo, 2026-11-16) — "gestão
// inteligente de excesso e distribuição". Pendente anotado no §10.6 de
// docs/planejamento-inteligente-estoque.md: "surfacing de distribuicao-estoque/
// DecisaoMovimentacaoEstoque no painel de detalhe (motor já maduro, só falta integrar
// visualmente)". Este arquivo NÃO é um motor novo — é uma camada de agregação por PRODUTO (mesmo
// grão de planejamento-estoque.ts/planejamento-grade.ts) sobre o motor que já existe e está em
// produção (distribuicao-estoque.ts): getComparacaoCompleta (posições/variantes já diagnosticadas)
// e getMovimentacoesRecomendadas (sugestões de transferência já calculadas, já respeitando mínimo
// + margem de segurança via prepararOrigens/construirOrigem). Nenhuma fórmula de diagnóstico,
// alocação ou confiança é recalculada aqui.
//
// Regra de dupla contagem (ver docs/planejamento-inteligente-estoque.md §9.2 e §10.2): este
// arquivo nunca soma VariantePorLoja.vendasDias30/60/90 entre posições — a posição CD/Site já
// embute a demanda das lojas (vendasEfetivasCdSite). Tudo aqui trabalha com `estoqueAtual` (soma
// direta, segura) e com as sugestões de MovimentacaoRecomendada já prontas (que também respeitam
// essa regra internamente) — nunca com uma soma de venda nova feita por este arquivo.

// ---------------------------------------------------------------------------
// REGRA DE NEGÓCIO NOVA DESTA FASE — Drop em ciclo ativo nunca é esvaziado por "excesso"
// ---------------------------------------------------------------------------
// Pedido explícito do briefing: "mesma régua deve valer pra não sugerir transferência que esvazie
// um Drop que ainda está em ciclo ativo". O motor de distribuição (distribuicao-estoque.ts) já
// trata isso para RECOLHIMENTO (loja→CD/Site: nunca recolhe de um Best Seller em reposição
// recorrente — ver calcularMovimentacoes, bloco `tipoCompra === BEST_SELLER`), mas não tinha
// nenhuma proteção equivalente para DROP nas outras 2 direções (loja→loja, CD/Site→loja): um Drop
// com cobertura "excessiva" nos primeiros dias de um ciclo de 2 meses pode, na verdade, estar
// vendendo normalmente — "excesso" ali é ainda não ter girado o suficiente, não sobra real.
//
// Em vez de alterar distribuicao-estoque.ts (fora do regime de escrita desta entrega, e o motor
// seria usado por mais consumidores que não pedem essa régua), a proteção é aplicada AQUI, como um
// FILTRO sobre a saída já calculada: uma oportunidade de transferência cujo SKU de origem é DROP,
// ainda dentro do ciclo (dataEncerramentoPrevista no futuro ou não preenchida, status comercial não
// encerrado/descontinuado) E que teve venda real nos últimos 90 dias (vendasOrigem90 > 0 — ou seja,
// "cobertura_excessiva" por estoque alto relativo à própria venda, não "estoque_parado" morto) é
// suprimida da lista de oportunidades exposta por este módulo (nunca da tabela de Distribuição de
// Estoque, que continua mostrando tudo — essa supressão é só desta visão por produto). Documentado
// explicitamente como decisão de produto desta fase — precisa de validação do Rodrigo se a régua
// deveria valer também pra Best Seller em excesso (hoje Best Seller nunca aparece como origem de
// excesso vindo do motor porque reposição recorrente mantém a cobertura normal na prática, mas não
// há garantia formal disso).
function dropEmCicloAtivo(meta: { statusComercial: StatusComercialProduto; dataEncerramentoPrevista: Date | null }): boolean {
  if (meta.statusComercial === "DESCONTINUADO" || meta.statusComercial === "EM_ENCERRAMENTO") return false;
  if (meta.dataEncerramentoPrevista && meta.dataEncerramentoPrevista.getTime() < Date.now()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// VISÃO POR PRODUTO — excesso, ruptura e oportunidades de transferência
// ---------------------------------------------------------------------------

export type ProdutoExcessoDistribuicao = {
  produto: string;
  grupo: string;
  cods: string[];
  // Soma, pelas posições CD/Site de todos os cods do produto, do que está disponível pra
  // transferir (estoqueAtual - mínimo - margem de segurança) SÓ nas posições diagnosticadas como
  // cobertura_excessiva/estoque_parado — mesma régua de prepararOrigens, via construirOrigem.
  excessoCD: number;
  // O que deve PERMANECER no CD (mínimo + margem de segurança), somado por todos os cods/posições
  // CD/Site do produto — sempre, não só nas posições em excesso. Responde "quanto do estoque do CD
  // é reserva, não sobra" (pedido do briefing).
  estoqueCDPermanece: number;
  // Mesmo cálculo que excessoCD, mas para as posições de loja.
  excessoLojas: number;
  // Quantas linhas (cod × posição de loja) estão em ruptura/cobertura_critica.
  rupturaLojas: number;
  // Sinal-chave pedido no briefing: há loja com risco de ruptura enquanto outra posição (CD ou
  // outra loja) do MESMO produto tem excesso disponível.
  rupturaComExcessoDisponivel: boolean;
  // Sugestões de transferência já calculadas pelo motor (distribuicao-estoque.ts), filtradas pra
  // este produto — nunca recalculadas aqui. Cada item já traz justificativa/avisos próprios.
  oportunidades: MovimentacaoRecomendada[];
  // Quantas oportunidades do motor foram suprimidas desta lista pela régua "Drop em ciclo ativo"
  // acima — exposto pra nunca esconder silenciosamente que algo foi filtrado.
  dropsCicloAtivoProtegidos: number;
};

export async function getExcessosEDistribuicao(filtro: ComparacaoFiltro = {}): Promise<ProdutoExcessoDistribuicao[]> {
  const [{ variantes }, mov] = await Promise.all([getComparacaoCompleta(filtro), getMovimentacoesRecomendadas(filtro)]);
  if (variantes.length === 0) return [];

  const cods = [...new Set(variantes.map((v) => v.cod))];
  // Só busca metadado de ciclo pros cods classificados como DROP — é o único caso em que a régua
  // desta fase se aplica (ver dropEmCicloAtivo).
  const metaDrops = await prisma.classificacaoProduto.findMany({
    where: { cod: { in: cods }, tipoCompra: TipoCompraProduto.DROP },
    select: { cod: true, statusComercial: true, dataEncerramentoPrevista: true },
  });
  const dropAtivoPorCod = new Map(metaDrops.map((d) => [d.cod, dropEmCicloAtivo(d)]));

  type Acc = {
    produto: string;
    grupo: string;
    cods: Set<string>;
    excessoCD: number;
    estoqueCDPermanece: number;
    excessoLojas: number;
    rupturaLojas: number;
    oportunidades: MovimentacaoRecomendada[];
    dropsProtegidos: number;
  };
  const porProduto = new Map<string, Acc>();
  function acc(produto: string, grupo: string): Acc {
    let a = porProduto.get(produto);
    if (!a) {
      a = { produto, grupo, cods: new Set(), excessoCD: 0, estoqueCDPermanece: 0, excessoLojas: 0, rupturaLojas: 0, oportunidades: [], dropsProtegidos: 0 };
      porProduto.set(produto, a);
    }
    return a;
  }

  // Passo 1: excesso/reserva por posição, direto de VariantePorLoja — reaproveita construirOrigem
  // (a MESMA fórmula de mínimo+margem usada pelo motor pra decidir quem pode doar), nunca uma
  // fórmula nova. estoqueAtual é soma direta (sem o proxy de vendasEfetivasCdSite), então somar
  // entre posições aqui é seguro — é exatamente o que planejamento-estoque.ts já faz.
  for (const v of variantes) {
    const a = acc(v.produto, v.grupo);
    a.cods.add(v.cod);
    for (const l of v.porLoja) {
      const origem = construirOrigem(l);
      const permanece = l.estoqueAtual - origem.disponivel;
      if (l.tipoPosicao === "cd_site") {
        a.estoqueCDPermanece += permanece;
        if (l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado") a.excessoCD += origem.disponivel;
      } else {
        if (l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado") a.excessoLojas += origem.disponivel;
        if (l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica") a.rupturaLojas += 1;
      }
    }
  }

  // Passo 2: oportunidades de transferência — do motor já calculado (getMovimentacoesRecomendadas),
  // só agrupadas por produto e com a régua de Drop em ciclo ativo aplicada (ver cabeçalho).
  for (const m of mov.movimentacoes) {
    const a = acc(m.produto, m.grupo);
    const bloqueiaPorDropAtivo = dropAtivoPorCod.get(m.cod) === true && m.vendasOrigem90 > 0;
    if (bloqueiaPorDropAtivo) {
      a.dropsProtegidos += 1;
      continue;
    }
    a.oportunidades.push(m);
  }

  return [...porProduto.values()]
    .map((a) => ({
      produto: a.produto,
      grupo: a.grupo,
      cods: [...a.cods],
      excessoCD: a.excessoCD,
      estoqueCDPermanece: a.estoqueCDPermanece,
      excessoLojas: a.excessoLojas,
      rupturaLojas: a.rupturaLojas,
      rupturaComExcessoDisponivel: a.rupturaLojas > 0 && (a.excessoCD > 0 || a.excessoLojas > 0),
      oportunidades: a.oportunidades,
      dropsCicloAtivoProtegidos: a.dropsProtegidos,
    }))
    // Só produtos com algum sinal real de excesso/ruptura/oportunidade/proteção — um catálogo de
    // 360 produtos "equilibrados" sem nada a decidir não é "gestão de excesso e distribuição".
    .filter(
      (p) => p.excessoCD > 0 || p.excessoLojas > 0 || p.rupturaLojas > 0 || p.oportunidades.length > 0 || p.dropsCicloAtivoProtegidos > 0
    )
    .sort((a, b) => b.excessoCD + b.excessoLojas - (a.excessoCD + a.excessoLojas) || a.produto.localeCompare(b.produto, "pt-BR"));
}

// Atalho pro painel de detalhe de UM produto (mesmo padrão de getProdutoPlanejamentoDetalhe em
// planejamento-estoque.ts: reaproveita a mesma passada cacheada — montarComparacao/
// getMovimentacoesRecomendadas já são cacheadas por filtro, cacheAsync — e filtra o resultado, em
// vez de uma query dedicada por produto). null quando o produto não tem nenhum sinal (não é erro,
// é "nada a decidir aqui").
export async function getProdutoExcessoDistribuicao(
  produto: string,
  filtro: ComparacaoFiltro = {}
): Promise<ProdutoExcessoDistribuicao | null> {
  const todos = await getExcessosEDistribuicao(filtro);
  return todos.find((p) => p.produto === produto) ?? null;
}

// ---------------------------------------------------------------------------
// DECISÕES DE MOVIMENTAÇÃO POR STATUS — extensão mínima de getHistoricoMovimentacoes
// ---------------------------------------------------------------------------
// getHistoricoMovimentacoes (distribuicao-estoque.ts) já faz exatamente a leitura que esta fase
// precisava ("listar decisões por status") — já suporta filtrar por 1 status + cod + limite, e já
// trata a migration pendente (P2021/P2022) sem estourar a tela. Não existia, porém, um jeito de
// pedir as 4 categorias de uma vez (pra um resumo "pendente/aprovada/executada/recusada" lado a
// lado) nem de filtrar por PRODUTO inteiro (vários cods) em vez de 1 cod — por isso a extensão
// mínima abaixo, nunca tocando na tabela/no fluxo de escrita (registrarDecisaoMovimentacao/
// atualizarStatusMovimentacao continuam intocados, só leitura).
export type DecisoesMovimentacaoPorStatus = {
  migrationPendente: boolean;
  pendente: HistoricoMovimentacoes["itens"];
  aprovada: HistoricoMovimentacoes["itens"];
  executada: HistoricoMovimentacoes["itens"];
  recusada: HistoricoMovimentacoes["itens"];
};

const STATUS_TODOS: StatusMovimentacaoRegistro[] = ["PENDENTE", "APROVADA", "EXECUTADA", "RECUSADA"];

export async function getDecisoesMovimentacaoPorStatus(
  filtro: { cod?: string; produto?: string; limitePorStatus?: number } = {}
): Promise<DecisoesMovimentacaoPorStatus> {
  const limite = filtro.limitePorStatus ?? 50;
  const [pendente, aprovada, executada, recusada] = await Promise.all(
    STATUS_TODOS.map((status) => getHistoricoMovimentacoes({ status, cod: filtro.cod, limite }))
  );

  // Filtro por produto é feito aqui (pós-leitura), não em getHistoricoMovimentacoes: a tabela não
  // tem índice por produto hoje e esta fase não deve mudar a função existente só pra isso — o
  // volume (limite×4, no máximo 200 linhas por padrão) torna o filtro em memória seguro.
  const porProduto = (h: HistoricoMovimentacoes) => (filtro.produto ? h.itens.filter((i) => i.produto === filtro.produto) : h.itens);

  return {
    migrationPendente: pendente.migrationPendente,
    pendente: porProduto(pendente),
    aprovada: porProduto(aprovada),
    executada: porProduto(executada),
    recusada: porProduto(recusada),
  };
}
