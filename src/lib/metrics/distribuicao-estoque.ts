import { prisma } from "@/lib/prisma";
import { Prisma, TipoCompraProduto, type TipoMovimentacaoEstoque } from "@prisma/client";
import {
  latestStockSnapshots,
  getPosicoesEstoque,
  cacheAsync,
  HEAVY_QUERY_CACHE_MS,
  type PosicaoEstoque,
  type PosicoesEstoque,
} from "./core";
import { matchMinimumRule } from "./estoque";

// ---------------------------------------------------------------------------
// AGENTE DE INTELIGÊNCIA DE DISTRIBUIÇÃO DE ESTOQUE
// ---------------------------------------------------------------------------
// Pedido do Rodrigo em 2026-10-30 ("CORREÇÃO DO MAPA DE COMPRAS E SEPARAÇÃO DO AGENTE DE
// DISTRIBUIÇÃO"): responder "o estoque de cada produto está bem distribuído entre as unidades, ou
// vale transferir?" — pergunta DIFERENTE de "quanto comprar" (isso é compras-inteligencia.ts).
//
// Regras de arquitetura, pedidas explicitamente:
// - NUNCA sugere quantidade de compra, nem importa nada de compras-inteligencia.ts (a única coisa
//   que vem de lá é a CLASSIFICAÇÃO Best Seller/Drop já cadastrada — sinal comercial existente,
//   não cálculo de compra).
// - NUNCA executa transferência — só recomenda; a equipe decide e executa fora do Radar. O que o
//   Radar passou a guardar (2026-11-11) é a DECISÃO humana sobre a recomendação, nunca a execução
//   física (ver DecisaoMovimentacaoEstoque / registrarDecisaoMovimentacao).
//
// EVOLUÇÃO 2026-11-11 (decisão de produto do Rodrigo, por escrito): a comparação deixou de ser só
// varejo-com-varejo. Agora são TRÊS direções, com o CD/Site como posição de primeira classe:
//   1. Loja → Loja        (redistribuição entre varejo, o que já existia)
//   2. CD/Site → Loja     (abastecimento: o CD existe pra isso)
//   3. Loja → CD/Site     (recolhimento: a peça vende melhor no ecommerce que naquela loja)
// CD e Site NÃO são duplicados: são uma posição de estoque única via Store.displayGroup =
// "TVB Site e Atacado" (ver getPosicoesEstoque em core.ts). As lojas de varejo também deixaram de
// ser uma allowlist hardcoded ("Leblon"/"Barra"/"Rio Sul") — ver getPosicoesEstoque, que decide
// por DADO (tem venda real) em vez de por nome/sellsProducts.
//
// Mesma separação de camadas de compras-inteligencia.ts: funções PURAS (testáveis sem banco) +
// camada de DADOS (monta o input real a partir de Sale/StockSnapshot/StockMinimumRule/
// ClassificacaoProduto).
//
// GAP DE DADO CONHECIDO, NÃO INVENTADO: não existe campo de estoque RESERVADO/COMPROMETIDO em
// StockSnapshot (só `quantidadeDisponivel`, que é a posição bruta do DAPIC). Toda recomendação que
// dependeria de saber "essas peças já estão separadas pra um pedido?" é marcada com
// confianca="baixa" + aviso explícito, nunca calculada como se o dado existisse. Ver avaliarConfianca.

export type TipoPosicao = "loja" | "cd_site";

export type Diagnostico =
  | "sem_dado"
  | "ruptura"
  | "cobertura_critica"
  | "equilibrado"
  | "cobertura_excessiva"
  | "estoque_parado";

export type VariantePorLoja = {
  // Id da POSIÇÃO (pro CD/Site são os 2 storeIds juntos, "id1|id2" — ver PosicaoEstoque.posicaoId).
  storeId: string;
  storeCode: string;
  storeName: string;
  tipoPosicao: TipoPosicao;
  estoqueAtual: number;
  vendasDias30: number;
  vendasDias60: number;
  vendasDias90: number;
  // Velocidade diária de referência: usa a janela de 30 dias (mesma convenção de
  // getStockCoverage) quando há venda nela; cai pra 90 dias quando a loja ficou sem estoque
  // ANTES dos últimos 30 dias (senão a ruptura "esconderia" a própria demanda que a causou).
  velocidadeDiaria: number;
  coberturaDias: number | null;
  estoqueMinimo: number | null;
  diagnostico: Diagnostico;
};

// Mesmas faixas de dia de getStockCoverage (estoque.ts: crítico<7, atenção 7-30, ok 30-60,
// excesso>60) — aqui simplificadas pra 3 faixas (crítica / equilibrado / excessiva) porque a
// distinção fina atenção-vs-ok não importa pra decisão de transferência, só os extremos importam.
const COBERTURA_CRITICA_DIAS = 7;
const COBERTURA_EXCESSIVA_DIAS = 60;

// O CD/Site tem um limiar de excesso MAIOR (não é "mais tolerante" por capricho): ele é a posição
// que abastece as 3 lojas E atende a demanda nacional do ecommerce, então profundidade de estoque
// lá é a função dele, não um sintoma. 60 dias numa loja de 40m² é excesso; 60 dias no CD é normal.
// 90 dias é o número explícito escolhido (3x a cobertura-alvo padrão de 30 dias) — parâmetro
// visível aqui, não escondido num score.
const COBERTURA_EXCESSIVA_CD_SITE_DIAS = 90;

export function limiarExcessivo(tipoPosicao: TipoPosicao): number {
  return tipoPosicao === "cd_site" ? COBERTURA_EXCESSIVA_CD_SITE_DIAS : COBERTURA_EXCESSIVA_DIAS;
}

export function diagnosticarVariante(
  v: {
    estoqueAtual: number;
    vendasDias30: number;
    vendasDias90: number;
    velocidadeDiaria: number;
    coberturaDias: number | null;
  },
  tipoPosicao: TipoPosicao = "loja"
): Diagnostico {
  if (v.estoqueAtual === 0 && v.vendasDias90 === 0) return "sem_dado";
  if (v.estoqueAtual === 0 && v.vendasDias90 > 0) return "ruptura";
  if (v.estoqueAtual > 0 && v.vendasDias90 === 0) return "estoque_parado";
  if (v.coberturaDias == null) return "sem_dado";
  if (v.coberturaDias < COBERTURA_CRITICA_DIAS) return "cobertura_critica";
  if (v.coberturaDias > limiarExcessivo(tipoPosicao)) return "cobertura_excessiva";
  return "equilibrado";
}

// ---------------------------------------------------------------------------
// ALOCAÇÃO (pura) — núcleo compartilhado pelas 3 direções
// ---------------------------------------------------------------------------
// Extraído de calcularOportunidadeTransferencia (a função original de 2026-10-30, que só sabia
// Loja→Loja) pra que as 3 direções usem UM motor só, em passes encadeados, em vez de um segundo
// motor paralelo: o que a direção Loja→Loja não conseguiu alocar continua disponível pro passo
// CD/Site→Loja, e a sobra que ninguém quis é o que alimenta o recolhimento Loja→CD/Site. As
// regras de elegibilidade de origem/destino e a fórmula de quantidade são as MESMAS de antes —
// só deixaram de estar presas a um único sentido de transferência.

const MARGEM_SEMANAS = 0.5;

type OrigemAlocavel = { v: VariantePorLoja; disponivel: number; margemSeguranca: number };
type DestinoAlocavel = { v: VariantePorLoja; necessidade: number };

// ORIGEM elegível: cobertura excessiva ou estoque parado, com sobra REAL depois de reservar o
// próprio mínimo (StockMinimumRule, quando existir) + uma margem de segurança (meia semana da
// própria venda) — nunca esvazia uma posição abaixo do que ela mesma precisa.
export function prepararOrigens(variantes: VariantePorLoja[]): OrigemAlocavel[] {
  return variantes
    .filter((v) => v.diagnostico === "cobertura_excessiva" || v.diagnostico === "estoque_parado")
    .map((v) => construirOrigem(v))
    .filter((o) => o.disponivel > 0)
    .sort((a, b) => b.disponivel - a.disponivel);
}

function construirOrigem(v: VariantePorLoja): OrigemAlocavel {
  const margemSeguranca = Math.round(v.velocidadeDiaria * 7 * MARGEM_SEMANAS);
  const disponivel = Math.max(0, v.estoqueAtual - (v.estoqueMinimo ?? 0) - margemSeguranca);
  return { v, disponivel, margemSeguranca };
}

// DESTINO elegível: ruptura ou cobertura crítica (ambos já implicam demanda comprovada — ver
// diagnosticarVariante: só entram nesses estados quem teve venda real nos últimos 90 dias).
export function prepararDestinos(variantes: VariantePorLoja[], coberturaAlvoDias: number): DestinoAlocavel[] {
  return variantes
    .filter((v) => v.diagnostico === "ruptura" || v.diagnostico === "cobertura_critica")
    .map((v) => {
      // Velocidade de 30d pode estar artificialmente baixa/zero se a ruptura começou DENTRO da
      // janela de 30 dias (a loja só vendeu enquanto tinha estoque) — cai pra 90d nesse caso pra
      // não subestimar a necessidade real.
      const velocidadeParaNecessidade = v.vendasDias30 > 0 ? v.vendasDias30 / 30 : v.vendasDias90 / 90;
      const necessidade = Math.max(0, Math.round(velocidadeParaNecessidade * coberturaAlvoDias) - v.estoqueAtual);
      return { v, necessidade };
    })
    .filter((d) => d.necessidade > 0)
    .sort((a, b) => b.necessidade - a.necessidade);
}

export type ParAlocado = {
  origem: OrigemAlocavel;
  destino: DestinoAlocavel;
  quantidade: number;
  // Quanto a origem ainda tinha disponível ANTES deste par (uma origem grande pode doar pra vários
  // destinos) — é esse número que entra na justificativa, não o saldo final.
  disponivelOrigemAntes: number;
};

// Alocação gulosa: destino com maior necessidade primeiro, origem com maior sobra primeiro — uma
// origem grande pode abastecer mais de um destino; nunca origem == destino. MUTA `disponivel` e
// `necessidade` de propósito: é isso que permite encadear os passos das 3 direções sem
// double-booking da mesma peça.
export function alocar(origens: OrigemAlocavel[], destinos: DestinoAlocavel[]): ParAlocado[] {
  const pares: ParAlocado[] = [];
  for (const destino of destinos) {
    for (const origem of origens) {
      if (destino.necessidade <= 0) break;
      if (origem.v.storeId === destino.v.storeId) continue;
      if (origem.disponivel <= 0) continue;
      const quantidade = Math.min(destino.necessidade, origem.disponivel);
      if (quantidade <= 0) continue;
      pares.push({ origem, destino, quantidade, disponivelOrigemAntes: origem.disponivel });
      origem.disponivel -= quantidade;
      destino.necessidade -= quantidade;
    }
  }
  return pares;
}

// ---------------------------------------------------------------------------
// CONTEXTO E JUSTIFICATIVAS COMPARTILHADAS
// ---------------------------------------------------------------------------

export type ContextoVariante = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  // Cobertura (em dias) que a sugestão tenta alcançar no destino — parâmetro explícito, não
  // escondido, pra quem for ler o resultado entender o alvo usado.
  coberturaAlvoDias: number;
};

function coberturaDepois(v: VariantePorLoja, estoqueDepois: number): number | null {
  return v.velocidadeDiaria > 0 ? Math.round((estoqueDepois / v.velocidadeDiaria) * 10) / 10 : null;
}

function justificativaDestino(d: VariantePorLoja): string {
  return `${d.storeName}: ${
    d.diagnostico === "ruptura"
      ? "sem estoque e com venda real nos últimos 90 dias"
      : `cobertura de ${d.coberturaDias} dia(s), abaixo do limite crítico`
  }.`;
}

function justificativaOrigem(o: OrigemAlocavel, disponivelOriginal: number): string {
  return `${o.v.storeName}: ${
    o.v.diagnostico === "estoque_parado"
      ? "estoque sem nenhuma venda nos últimos 90 dias"
      : `cobertura de ${o.v.coberturaDias} dia(s), bem acima do normal`
  }, com ${disponivelOriginal} un. disponível acima do próprio mínimo${
    o.margemSeguranca > 0 ? ` + margem de segurança (${o.margemSeguranca} un.)` : ""
  }.`;
}

// ---------------------------------------------------------------------------
// AS 3 DIREÇÕES + CLASSIFICAÇÃO (puro)
// ---------------------------------------------------------------------------

export type TipoMovimentacao = "loja_loja" | "cd_site_loja" | "loja_cd_site";
export type ClassificacaoMovimentacao = "REDISTRIBUIR" | "RECOLHER_PARA_CD_SITE" | "MANTER";
export type Confianca = "alta" | "media" | "baixa";
export type Prioridade = "alta" | "media" | "baixa";

export type GradePosicao = {
  // Quantos tamanhos DESSE produto/cor a posição ainda tem com estoque > 0.
  tamanhosComEstoque: number;
  // Quantos tamanhos DESSE produto/cor a posição realmente vendeu nos últimos 90 dias. É a base
  // histórica da "grade esperada" — de propósito NÃO existe grade ideal fixa (38/40/42/44
  // hardcoded) aqui: a referência é o que aquela unidade comprovadamente vende.
  tamanhosComVenda: number;
  // Tamanhos que o produto tem no catálogo (universo observado no estoque de todas as posições).
  totalTamanhos: number;
};

export type ContextoMovimentacao = ContextoVariante & {
  // Vem de ClassificacaoProduto (cadastro já existente, ver compras-inteligencia.ts). null =
  // produto NÃO classificado — tratado como "desconhecido", nunca como Best Seller nem como Drop
  // (mesma regra do Mapa de Compras: produto sem linha cai na fila de revisão, não herda tipo).
  tipoCompra: TipoCompraProduto | null;
  // Venda real do SKU no SITE (ecommerce) nos últimos 90 dias — só a store "CD", sem atacado
  // (ver PosicaoEstoque.storeIdEcommerce). É o "potencial de venda online" do recolhimento, medido
  // por venda que de fato aconteceu, não estimado.
  vendasSite90: number;
  // Grade real por posição (chave = VariantePorLoja.storeId).
  gradePorPosicao: Record<string, GradePosicao>;
};

export type MovimentacaoRecomendada = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  tipoMovimentacao: TipoMovimentacao;
  classificacao: Exclude<ClassificacaoMovimentacao, "MANTER">;
  prioridade: Prioridade;
  confianca: Confianca;
  origemPosicaoId: string;
  origemNome: string;
  destinoPosicaoId: string;
  destinoNome: string;
  quantidadeSugerida: number;
  estoqueOrigemAntes: number;
  estoqueOrigemDepois: number;
  estoqueDestinoAntes: number;
  estoqueDestinoDepois: number;
  disponivelOrigem: number;
  coberturaOrigemAntes: number | null;
  coberturaOrigemDepois: number | null;
  coberturaDestinoAntes: number | null;
  coberturaDestinoDepois: number | null;
  vendasOrigem30: number;
  vendasOrigem90: number;
  vendasDestino30: number;
  vendasDestino90: number;
  giroOrigemDia: number;
  giroDestinoDia: number;
  justificativa: string[];
  impactoEsperado: string;
  // Limitações de dado que afetam ESTA linha (hoje: inexistência de estoque reservado, ausência
  // de classificação Best Seller/Drop). Nunca vazio quando confianca !== "alta".
  avisos: string[];
  // Preenchido só pela camada de DADOS (getMovimentacoesRecomendadas), nunca pela função pura:
  // a grade por tamanho do mesmo produto/cor nas duas pontas, pra linha expandida da tela mostrar
  // "a 40 tá faltando onde a 42 tá sobrando" sem o usuário ter que ir pra outra aba.
  gradeTamanhos?: {
    tamanho: string;
    nucleo: boolean;
    estoqueOrigem: number;
    estoqueDestino: number;
    vendas90Origem: number;
    vendas90Destino: number;
  }[];
};

export type RecomendacaoManter = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  posicaoId: string;
  posicaoNome: string;
  estoqueAtual: number;
  diagnostico: Diagnostico;
  confianca: Confianca;
  motivo: string[];
};

export type ResultadoMovimentacoes = {
  movimentacoes: MovimentacaoRecomendada[];
  manter: RecomendacaoManter[];
};

// Demanda local considerada "baixa" pra efeito de recolhimento: até 1 unidade vendida em 90 dias
// naquela loja. Não é zero de propósito — "vendeu 1 peça em 3 meses" é, pra decisão de alocação,
// o mesmo que não vender, e exigir zero absoluto deixaria de fora justamente o caso mais comum de
// peça encalhada que ainda teve uma venda isolada.
const DEMANDA_LOCAL_BAIXA_90D = 1;

export function prioridadeDoDestino(diagnosticoDestino: Diagnostico): Prioridade {
  if (diagnosticoDestino === "ruptura") return "alta";
  if (diagnosticoDestino === "cobertura_critica") return "media";
  return "baixa";
}

// Confiança da recomendação. Regra explícita e, principalmente, HONESTA sobre o gap de dado:
// StockSnapshot não tem estoque reservado/comprometido, então qualquer recomendação que depende de
// saber se as peças da origem já estão separadas pra um pedido NÃO pode ser "alta".
export function avaliarConfianca(args: {
  tipoMovimentacao: TipoMovimentacao;
  estoqueOrigemDepois: number;
  quantidadeSugerida: number;
  estoqueOrigemAntes: number;
  tipoCompra: TipoCompraProduto | null;
  vendasSite90: number;
}): { confianca: Confianca; avisos: string[] } {
  const avisos: string[] = [];
  let confianca: Confianca = "alta";

  const esvaziaOrigem = args.estoqueOrigemDepois === 0;
  const levaQuaseTudo = args.estoqueOrigemAntes > 0 && args.quantidadeSugerida / args.estoqueOrigemAntes >= 0.8;

  if (esvaziaOrigem || levaQuaseTudo) {
    confianca = "baixa";
    avisos.push(
      "Depende de validação: a base não tem campo de estoque reservado/comprometido (StockSnapshot só traz a quantidade disponível bruta do DAPIC), e esta sugestão leva praticamente todo o estoque da origem — confirme com a loja se alguma dessas peças já está separada pra um pedido antes de mover."
    );
  }

  if (args.tipoMovimentacao === "loja_cd_site") {
    if (args.vendasSite90 === 0) {
      confianca = "baixa";
      avisos.push(
        "Baixa confiança: o SKU não registrou nenhuma venda no site nos últimos 90 dias, então não há evidência de que o ecommerce aproveite melhor a peça que a loja atual — recolher aqui é uma hipótese comercial, não um fato medido."
      );
    }
    if (args.tipoCompra === null) {
      confianca = confianca === "baixa" ? "baixa" : "media";
      avisos.push(
        "Produto sem classificação Best Seller/Drop cadastrada (ClassificacaoProduto) — não foi possível confirmar se ele está em reposição recorrente, que é o caso em que recolher seria errado."
      );
    }
  }

  return { confianca, avisos };
}

type AcumuladorManter = Map<string, RecomendacaoManter>;

function registrarManter(acc: AcumuladorManter, item: RecomendacaoManter) {
  const atual = acc.get(item.posicaoId);
  if (atual) {
    for (const m of item.motivo) if (!atual.motivo.includes(m)) atual.motivo.push(m);
    return;
  }
  acc.set(item.posicaoId, item);
}

function baseManter(v: VariantePorLoja, contexto: ContextoMovimentacao, motivo: string[], confianca: Confianca): RecomendacaoManter {
  return {
    cod: contexto.cod,
    produto: contexto.produto,
    grupo: contexto.grupo,
    cor: contexto.cor,
    tamanho: contexto.tamanho,
    posicaoId: v.storeId,
    posicaoNome: v.storeName,
    estoqueAtual: v.estoqueAtual,
    diagnostico: v.diagnostico,
    confianca,
    motivo,
  };
}

function montarMovimentacao(args: {
  contexto: ContextoMovimentacao;
  origem: VariantePorLoja;
  destino: VariantePorLoja;
  quantidade: number;
  disponivelOrigem: number;
  tipoMovimentacao: TipoMovimentacao;
  classificacao: Exclude<ClassificacaoMovimentacao, "MANTER">;
  prioridade: Prioridade;
  justificativa: string[];
  impactoEsperado: string;
}): MovimentacaoRecomendada {
  const { contexto, origem, destino, quantidade } = args;
  const origemDepois = origem.estoqueAtual - quantidade;
  const destinoDepois = destino.estoqueAtual + quantidade;
  const { confianca, avisos } = avaliarConfianca({
    tipoMovimentacao: args.tipoMovimentacao,
    estoqueOrigemDepois: origemDepois,
    quantidadeSugerida: quantidade,
    estoqueOrigemAntes: origem.estoqueAtual,
    tipoCompra: contexto.tipoCompra,
    vendasSite90: contexto.vendasSite90,
  });

  return {
    cod: contexto.cod,
    produto: contexto.produto,
    grupo: contexto.grupo,
    cor: contexto.cor,
    tamanho: contexto.tamanho,
    tipoMovimentacao: args.tipoMovimentacao,
    classificacao: args.classificacao,
    prioridade: args.prioridade,
    confianca,
    origemPosicaoId: origem.storeId,
    origemNome: origem.storeName,
    destinoPosicaoId: destino.storeId,
    destinoNome: destino.storeName,
    quantidadeSugerida: quantidade,
    estoqueOrigemAntes: origem.estoqueAtual,
    estoqueOrigemDepois: origemDepois,
    estoqueDestinoAntes: destino.estoqueAtual,
    estoqueDestinoDepois: destinoDepois,
    disponivelOrigem: args.disponivelOrigem,
    coberturaOrigemAntes: origem.coberturaDias,
    coberturaOrigemDepois: coberturaDepois(origem, origemDepois),
    coberturaDestinoAntes: destino.coberturaDias,
    coberturaDestinoDepois: coberturaDepois(destino, destinoDepois),
    vendasOrigem30: origem.vendasDias30,
    vendasOrigem90: origem.vendasDias90,
    vendasDestino30: destino.vendasDias30,
    vendasDestino90: destino.vendasDias90,
    giroOrigemDia: Math.round(origem.velocidadeDiaria * 100) / 100,
    giroDestinoDia: Math.round(destino.velocidadeDiaria * 100) / 100,
    justificativa: args.justificativa,
    impactoEsperado: args.impactoEsperado,
    avisos,
  };
}

// MOTOR ÚNICO das 3 direções. Puro: recebe TODAS as posições (lojas + CD/Site) do MESMO cod.
// Ordem dos passos é deliberada e não é detalhe de implementação:
//   1. Loja → Loja primeiro: a peça já está no varejo, transferir entre lojas é o movimento mais
//      barato e não consome estoque do CD, que atende demanda nacional.
//   2. CD/Site → Loja depois: cobre o que o varejo não conseguiu cobrir sozinho.
//   3. Loja → CD/Site por último: só a sobra que NENHUMA loja quis é candidata a recolhimento —
//      recolher uma peça que outra loja precisava seria o pior dos mundos.
export function calcularMovimentacoes(
  variantes: VariantePorLoja[],
  contexto: ContextoMovimentacao
): ResultadoMovimentacoes {
  const lojas = variantes.filter((v) => v.tipoPosicao === "loja");
  const cdSite = variantes.find((v) => v.tipoPosicao === "cd_site") ?? null;

  const movimentacoes: MovimentacaoRecomendada[] = [];
  const manter: AcumuladorManter = new Map();

  // ---- Passo 1: Loja → Loja -------------------------------------------------
  const origensLoja = prepararOrigens(lojas);
  const destinosLoja = prepararDestinos(lojas, contexto.coberturaAlvoDias);

  for (const { origem, destino, quantidade, disponivelOrigemAntes } of alocar(origensLoja, destinosLoja)) {
    movimentacoes.push(
      montarMovimentacao({
        contexto,
        origem: origem.v,
        destino: destino.v,
        quantidade,
        disponivelOrigem: disponivelOrigemAntes,
        tipoMovimentacao: "loja_loja",
        classificacao: "REDISTRIBUIR",
        prioridade: prioridadeDoDestino(destino.v.diagnostico),
        justificativa: [
          justificativaDestino(destino.v),
          justificativaOrigem(origem, disponivelOrigemAntes),
          `Quantidade = menor valor entre o que ${destino.v.storeName} precisa pra chegar a ${contexto.coberturaAlvoDias} dias de cobertura e o que ${origem.v.storeName} pode doar sem comprometer o próprio estoque.`,
        ],
        impactoEsperado: `${destino.v.storeName} sai de ${destino.v.estoqueAtual} para ${
          destino.v.estoqueAtual + quantidade
        } un. sem nenhuma compra nova; ${origem.v.storeName} segue acima do próprio mínimo.`,
      })
    );
  }

  // ---- Passo 2: CD/Site → Loja (abastecimento) ------------------------------
  // O CD/Site NÃO precisa estar em "cobertura_excessiva" pra abastecer — abastecer é a função
  // dele. O que trava o passo é o contrário: se o próprio CD/Site está em ruptura/cobertura
  // crítica, ele não tem o que doar. O piso continua sendo o mesmo StockMinimumRule + margem de
  // meia semana (construirOrigem), nunca uma segunda forma de calcular mínimo.
  if (cdSite && cdSite.diagnostico !== "ruptura" && cdSite.diagnostico !== "cobertura_critica") {
    const origemCd = construirOrigem(cdSite);
    const disponivelOriginalCd = origemCd.disponivel;
    if (origemCd.disponivel > 0) {
      // destinosLoja já foi mutado pelo passo 1 — o que sobrou aqui é a necessidade REAL que o
      // varejo não conseguiu cobrir sozinho.
      for (const { destino, quantidade } of alocar([origemCd], destinosLoja)) {
        movimentacoes.push(
          montarMovimentacao({
            contexto,
            origem: cdSite,
            destino: destino.v,
            quantidade,
            disponivelOrigem: disponivelOriginalCd,
            tipoMovimentacao: "cd_site_loja",
            classificacao: "REDISTRIBUIR",
            prioridade: prioridadeDoDestino(destino.v.diagnostico),
            justificativa: [
              justificativaDestino(destino.v),
              `${destino.v.storeName} vendeu ${destino.v.vendasDias30} un. em 30 dias e ${destino.v.vendasDias90} un. em 90 dias — demanda comercial comprovada nessa unidade, não estimada.`,
              `${cdSite.storeName}: ${cdSite.estoqueAtual} un. em estoque, ${disponivelOriginalCd} un. acima do próprio mínimo${
                origemCd.margemSeguranca > 0 ? ` + margem de segurança (${origemCd.margemSeguranca} un.)` : ""
              } — nenhuma loja de varejo tinha sobra pra cobrir essa necessidade.`,
              `Abastecimento do CD/Site é a última etapa depois de esgotar a redistribuição entre lojas, pra não consumir estoque que atende a demanda nacional do ecommerce sem necessidade.`,
            ],
            impactoEsperado: `${destino.v.storeName} sai de ${destino.v.estoqueAtual} para ${
              destino.v.estoqueAtual + quantidade
            } un. (cobertura-alvo ${contexto.coberturaAlvoDias} dias) consumindo estoque que já é da empresa, sem compra nova.`,
          })
        );
      }
    }
  }

  // ---- Passo 3: Loja → CD/Site (recolhimento) -------------------------------
  // Nunca é um corte binário "peça isolada → recolhe" nem "grade quebrada → recolhe" (pedido
  // explícito do Rodrigo: uma peça pode ter baixa relevância numa loja e bom potencial no
  // ecommerce — e também o contrário). Ponderação com 3 sinais, exige PELO MENOS DOIS:
  //   A) demanda local baixa (<= 1 un. em 90 dias naquela loja);
  //   B) grade quebrada na loja (ela já não tem estoque em todos os tamanhos que ela mesma vendeu
  //      nos últimos 90 dias — base histórica real, não grade ideal fixa);
  //   C) potencial online comprovado (o SKU vendeu no site nos últimos 90 dias).
  // Um sinal só não move nada — vira MANTER com o motivo escrito.
  {
    for (const origem of origensLoja) {
      const v = origem.v;
      if (origem.disponivel <= 0) continue; // já doado pro varejo no passo 1

      const grade = contexto.gradePorPosicao[v.storeId];
      const demandaLocalBaixa = v.vendasDias90 <= DEMANDA_LOCAL_BAIXA_90D;
      const gradeQuebrada = grade ? grade.tamanhosComEstoque < grade.tamanhosComVenda : false;
      const potencialOnline = contexto.vendasSite90 > 0;

      // Best Seller em reposição recorrente não é excesso só por ter estoque alto / reposição
      // recente — reaproveita a classificação que JÁ existe (ClassificacaoProduto), em vez de uma
      // heurística paralela inventada aqui.
      if (contexto.tipoCompra === TipoCompraProduto.BEST_SELLER) {
        registrarManter(
          manter,
          baseManter(
            v,
            contexto,
            [
              `Produto classificado como BEST SELLER (ClassificacaoProduto) — tem reposição recorrente, então estoque alto em ${v.storeName} é o comportamento esperado, não excesso.`,
            ],
            "alta"
          )
        );
        continue;
      }

      const sinais = [demandaLocalBaixa, gradeQuebrada, potencialOnline].filter(Boolean).length;
      if (sinais < 2) {
        const motivo: string[] = [];
        if (!demandaLocalBaixa) {
          motivo.push(
            `${v.storeName} ainda vende o SKU (${v.vendasDias90} un. em 90 dias) — recolher tiraria a peça de uma unidade onde ela tem saída.`
          );
        }
        if (demandaLocalBaixa && !potencialOnline && !gradeQuebrada) {
          motivo.push(
            `Peça com pouca saída em ${v.storeName}, mas sem venda no site nos últimos 90 dias e com a grade local ainda íntegra — recolher não aumentaria a chance de venda, só mudaria a peça de lugar.`
          );
        }
        if (motivo.length === 0) {
          motivo.push(
            `Apenas 1 dos 3 sinais de recolhimento presente (demanda local baixa / grade quebrada / potencial online) — a regra exige 2 pra recomendar movimentação.`
          );
        }
        registrarManter(manter, baseManter(v, contexto, motivo, contexto.tipoCompra === null ? "media" : "alta"));
        continue;
      }

      // O CD/Site também pode estar afogado NESSE SKU. Achado rodando contra o dado real do dev em
      // 2026-11-11: sem esta checagem, o motor recomendava recolher 13 bonés de uma loja parada pro
      // CD/Site que já tinha 106 un. e 3.180 dias de cobertura do MESMO SKU — "mudar a peça de
      // lugar" sem aumentar nenhuma chance de venda, exatamente o que a regra de MANTER existe pra
      // evitar na direção oposta. Recolher só faz sentido quando o ecommerce tem espaço de demanda
      // pra aquela peça, não só quando a loja não tem.
      if (cdSite && (cdSite.diagnostico === "cobertura_excessiva" || cdSite.diagnostico === "estoque_parado")) {
        registrarManter(
          manter,
          baseManter(
            v,
            contexto,
            [
              `Sinais de recolhimento presentes em ${v.storeName}, mas o CD/Site já está com ${cdSite.estoqueAtual} un. do mesmo SKU e ${
                cdSite.diagnostico === "estoque_parado"
                  ? "nenhuma venda em 90 dias"
                  : `cobertura de ${cdSite.coberturaDias} dia(s)`
              } — recolher pra lá só muda a peça de lugar, não aumenta a chance de venda.`,
            ],
            "alta"
          )
        );
        continue;
      }

      // Sinais presentes, mas sem posição CD/Site visível (ex: usuário com allowedStores só de
      // lojas) não existe destino pra recolher — vira MANTER declarado, não silêncio.
      if (!cdSite) {
        registrarManter(
          manter,
          baseManter(
            v,
            contexto,
            [
              `Sinais de recolhimento presentes em ${v.storeName}, mas o CD/Site não está entre as unidades visíveis neste contexto — sem destino, não há movimentação a recomendar.`,
            ],
            "media"
          )
        );
        continue;
      }

      // Quantidade: o excedente acima da própria cobertura-alvo da loja, limitado ao que ela pode
      // doar sem furar o mínimo. Loja com estoque parado (velocidade 0) pode doar tudo o que está
      // disponível; loja que ainda vende guarda a cobertura-alvo.
      const guardarParaCobertura = Math.round(v.velocidadeDiaria * contexto.coberturaAlvoDias);
      const quantidade = Math.max(0, Math.min(origem.disponivel, v.estoqueAtual - guardarParaCobertura));
      if (quantidade <= 0) {
        registrarManter(
          manter,
          baseManter(
            v,
            contexto,
            [
              `Sinais de recolhimento presentes, mas ${v.storeName} precisa do estoque atual pra manter ${contexto.coberturaAlvoDias} dias de cobertura — nada sobra pra recolher.`,
            ],
            "alta"
          )
        );
        continue;
      }

      const justificativa: string[] = [];
      if (demandaLocalBaixa) {
        justificativa.push(
          `${v.storeName}: ${v.vendasDias90} un. vendidas em 90 dias (${
            v.diagnostico === "estoque_parado" ? "estoque parado" : `cobertura de ${v.coberturaDias} dia(s)`
          }) — demanda local baixa pra ${v.estoqueAtual} un. paradas ali.`
        );
      }
      if (gradeQuebrada && grade) {
        justificativa.push(
          `Grade quebrada em ${v.storeName}: estoque em ${grade.tamanhosComEstoque} tamanho(s), mas a própria loja vendeu ${grade.tamanhosComVenda} tamanho(s) diferentes nos últimos 90 dias — ela já não consegue atender a grade que ela mesma comprova vender.`
        );
      }
      if (potencialOnline) {
        justificativa.push(
          `Potencial online comprovado: ${contexto.vendasSite90} un. desse SKU vendidas pelo site nos últimos 90 dias (venda real, não estimativa) — no CD/Site a peça fica exposta à demanda nacional em vez de uma vitrine só.`
        );
      }
      justificativa.push(
        `Quantidade = sobra acima do mínimo da loja (${origem.disponivel} un.) limitada ao que ela precisa guardar pra manter ${contexto.coberturaAlvoDias} dias de cobertura (${guardarParaCobertura} un.).`
      );
      justificativa.push(
        `Recolhimento é a última direção avaliada: nenhuma outra loja de varejo precisava dessas peças neste ciclo.`
      );

      movimentacoes.push(
        montarMovimentacao({
          contexto,
          origem: v,
          destino: cdSite,
          quantidade,
          disponivelOrigem: origem.disponivel,
          tipoMovimentacao: "loja_cd_site",
          classificacao: "RECOLHER_PARA_CD_SITE",
          // Recolhimento nunca é urgente: é otimização de alocação, não atendimento de demanda
          // não-atendida. Prioridade alta fica reservada pra ruptura com venda real.
          prioridade: "baixa",
          justificativa,
          impactoEsperado: potencialOnline
            ? `${quantidade} un. saem de uma vitrine com pouca saída e passam a atender a demanda nacional do site, que já vendeu ${contexto.vendasSite90} un. do SKU em 90 dias.`
            : `${quantidade} un. deixam de ocupar espaço em ${v.storeName}; o ganho no ecommerce é hipótese a validar (sem venda do SKU no site em 90 dias).`,
        })
      );
      origem.disponivel -= quantidade;
    }
  }

  // ---- MANTER pelas sobras que nenhuma direção consumiu ---------------------
  // Posição diagnosticada com excesso/parado que terminou os 3 passos com sobra e sem nenhuma
  // movimentação: é informação útil ("vi, considerei, e a recomendação é não mover"), não silêncio.
  const posicoesComMovimento = new Set(movimentacoes.map((m) => m.origemPosicaoId));
  for (const origem of origensLoja) {
    if (posicoesComMovimento.has(origem.v.storeId)) continue;
    if (manter.has(origem.v.storeId)) continue;
    registrarManter(
      manter,
      baseManter(
        origem.v,
        contexto,
        [
          `${origem.v.storeName} tem ${origem.disponivel} un. acima do próprio mínimo, mas nenhuma outra unidade registrou falta desse SKU neste ciclo e os sinais não justificam recolher.`,
        ],
        "alta"
      )
    );
  }
  if (cdSite && cdSite.diagnostico === "estoque_parado" && !posicoesComMovimento.has(cdSite.storeId)) {
    registrarManter(
      manter,
      baseManter(
        cdSite,
        contexto,
        [
          `${cdSite.storeName} tem ${cdSite.estoqueAtual} un. sem venda em 90 dias, mas nenhuma loja de varejo registrou demanda desse SKU — mover pra uma vitrine sem demanda comprovada não é recomendação, é aposta.`,
        ],
        "media"
      )
    );
  }

  return { movimentacoes, manter: [...manter.values()] };
}

// ---------------------------------------------------------------------------
// AGRUPAMENTO POR PAR ORIGEM→DESTINO (puro)
// ---------------------------------------------------------------------------

export type GrupoPorPar<T> = {
  lojaOrigem: string;
  lojaDestino: string;
  itens: T[];
  totalQuantidade: number;
};

// Pedido do Rodrigo (2026-11-10): tanto a tela quanto o Excel exportado pra equipe das lojas
// precisam mostrar as sugestões agrupadas por par origem→destino (ex: tudo de "Leblon → Barra"
// junto, depois "Barra → Leblon", etc.) — cada unidade só separa o que é dela, então o agrupamento
// por par é o que faz sentido pra quem vai executar, em vez da lista corrida só ordenada por
// quantidade. Preserva a ordem relativa dos itens dentro de cada grupo (já vêm ordenados antes);
// só os GRUPOS em si são ordenados, alfabeticamente por origem e depois por destino
// (determinístico, não depende de qual grupo "pesa" mais).
function agruparPorPar<T>(
  itens: T[],
  origemDe: (i: T) => string,
  destinoDe: (i: T) => string,
  quantidadeDe: (i: T) => number
): GrupoPorPar<T>[] {
  const grupos = new Map<string, GrupoPorPar<T>>();
  for (const item of itens) {
    const lojaOrigem = origemDe(item);
    const lojaDestino = destinoDe(item);
    const chave = `${lojaOrigem}::${lojaDestino}`;
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = { lojaOrigem, lojaDestino, itens: [], totalQuantidade: 0 };
      grupos.set(chave, grupo);
    }
    grupo.itens.push(item);
    grupo.totalQuantidade += quantidadeDe(item);
  }
  return [...grupos.values()].sort(
    (a, b) => a.lojaOrigem.localeCompare(b.lojaOrigem, "pt-BR") || a.lojaDestino.localeCompare(b.lojaDestino, "pt-BR")
  );
}

export type GrupoMovimentacaoPorPar = GrupoPorPar<MovimentacaoRecomendada>;

export function agruparMovimentacoesPorPar(movimentacoes: MovimentacaoRecomendada[]): GrupoMovimentacaoPorPar[] {
  return agruparPorPar(
    movimentacoes,
    (m) => m.origemNome,
    (m) => m.destinoNome,
    (m) => m.quantidadeSugerida
  );
}

// ---------------------------------------------------------------------------
// ANÁLISE DE GRADE (puro)
// ---------------------------------------------------------------------------

// Tamanhos "núcleo" do negócio (pedido do Rodrigo: considerar a importância de 38/40/42/44 SEM
// ignorar os demais). Usados só pra DESTACAR a linha na matriz e pra priorizar o alerta de grade
// incompleta — nunca pra filtrar tamanho fora da análise, e nunca como "grade ideal fixa" (a grade
// esperada de cada unidade vem do histórico real de venda dela, ver GradePosicao.tamanhosComVenda).
export const TAMANHOS_NUCLEO = ["38", "40", "42", "44"];

export function ehTamanhoNucleo(tamanho: string | null): boolean {
  return tamanho != null && TAMANHOS_NUCLEO.includes(tamanho.trim());
}

export type CelulaGrade = {
  posicaoId: string;
  posicaoNome: string;
  tipoPosicao: TipoPosicao;
  estoque: number;
  vendas90: number;
};

export type LinhaGrade = {
  tamanho: string;
  nucleo: boolean;
  celulas: CelulaGrade[];
  total: number;
  totalVendas90: number;
  // Tamanho que a unidade comprovadamente vende (venda em 90d) mas está com estoque 0 nela.
  faltandoEm: string[];
};

export type MatrizGradeProduto = {
  produto: string;
  grupo: string;
  cor: string | null;
  linhas: LinhaGrade[];
  totalPorPosicao: { posicaoId: string; posicaoNome: string; estoque: number }[];
  totalGeral: number;
  // Quantos buracos de grade (tamanho com venda comprovada e estoque 0) existem no produto.
  buracosGrade: number;
  buracosGradeNucleo: number;
};

// Pura: monta a matriz Tamanho × Posição de UM produto a partir das linhas de variante já
// diagnosticadas. "Buraco de grade" = a unidade vendeu aquele tamanho nos últimos 90 dias e hoje
// está com 0 — definição baseada no histórico real daquela unidade, não numa grade ideal fixa.
export function montarMatrizGrade(
  variantes: { tamanho: string | null; produto: string; grupo: string; cor: string | null; porLoja: VariantePorLoja[] }[],
  posicoes: { posicaoId: string; posicaoNome: string; tipoPosicao: TipoPosicao }[]
): MatrizGradeProduto | null {
  if (variantes.length === 0) return null;

  const porTamanho = new Map<string, typeof variantes>();
  for (const v of variantes) {
    const t = v.tamanho ?? "—";
    const arr = porTamanho.get(t) ?? [];
    arr.push(v);
    porTamanho.set(t, arr);
  }

  const linhas: LinhaGrade[] = [];
  for (const [tamanho, vs] of porTamanho) {
    const celulas: CelulaGrade[] = posicoes.map((p) => {
      let estoque = 0;
      let vendas90 = 0;
      for (const v of vs) {
        const l = v.porLoja.find((x) => x.storeId === p.posicaoId);
        if (!l) continue;
        estoque += l.estoqueAtual;
        vendas90 += l.vendasDias90;
      }
      return { posicaoId: p.posicaoId, posicaoNome: p.posicaoNome, tipoPosicao: p.tipoPosicao, estoque, vendas90 };
    });
    linhas.push({
      tamanho,
      nucleo: ehTamanhoNucleo(tamanho),
      celulas,
      total: celulas.reduce((s, c) => s + c.estoque, 0),
      totalVendas90: celulas.reduce((s, c) => s + c.vendas90, 0),
      faltandoEm: celulas.filter((c) => c.estoque === 0 && c.vendas90 > 0).map((c) => c.posicaoNome),
    });
  }

  linhas.sort((a, b) => {
    const na = Number(a.tamanho);
    const nb = Number(b.tamanho);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.tamanho.localeCompare(b.tamanho, "pt-BR");
  });

  const totalPorPosicao = posicoes.map((p) => ({
    posicaoId: p.posicaoId,
    posicaoNome: p.posicaoNome,
    estoque: linhas.reduce((s, l) => s + (l.celulas.find((c) => c.posicaoId === p.posicaoId)?.estoque ?? 0), 0),
  }));

  return {
    produto: variantes[0].produto,
    grupo: variantes[0].grupo,
    cor: variantes[0].cor,
    linhas,
    totalPorPosicao,
    totalGeral: totalPorPosicao.reduce((s, p) => s + p.estoque, 0),
    buracosGrade: linhas.reduce((s, l) => s + l.faltandoEm.length, 0),
    buracosGradeNucleo: linhas.filter((l) => l.nucleo).reduce((s, l) => s + l.faltandoEm.length, 0),
  };
}

export type ResumoGrupoGrade = {
  grupo: string;
  quantidadeTotal: number;
  porPosicao: { posicaoId: string; posicaoNome: string; estoque: number }[];
  porTamanho: { tamanho: string; nucleo: boolean; estoque: number; vendas90: number }[];
  demanda90: number;
  // Excesso estimado = soma, por posição, do estoque acima da cobertura-alvo daquela posição
  // (velocidade real × alvo). Necessidade estimada = soma do que falta pra chegar no alvo onde há
  // demanda comprovada. Os dois derivam de venda REAL, nunca de sell-through isolado.
  excessoEstimado: number;
  necessidadeEstimada: number;
  oportunidades: number;
  produtos: number;
};

export function resumirGrupoGrade(
  grupo: string,
  variantes: { grupo: string; produto: string; tamanho: string | null; porLoja: VariantePorLoja[] }[],
  posicoes: { posicaoId: string; posicaoNome: string }[],
  coberturaAlvoDias: number,
  oportunidades: number
): ResumoGrupoGrade {
  const porPosicao = posicoes.map((p) => ({ posicaoId: p.posicaoId, posicaoNome: p.posicaoNome, estoque: 0 }));
  const porPosicaoIdx = new Map(porPosicao.map((p, i) => [p.posicaoId, i]));
  const tamanhoMap = new Map<string, { estoque: number; vendas90: number }>();
  let quantidadeTotal = 0;
  let demanda90 = 0;
  let excessoEstimado = 0;
  let necessidadeEstimada = 0;

  for (const v of variantes) {
    const t = v.tamanho ?? "—";
    const acc = tamanhoMap.get(t) ?? { estoque: 0, vendas90: 0 };
    for (const l of v.porLoja) {
      acc.estoque += l.estoqueAtual;
      acc.vendas90 += l.vendasDias90;
      quantidadeTotal += l.estoqueAtual;
      demanda90 += l.vendasDias90;
      const idx = porPosicaoIdx.get(l.storeId);
      if (idx !== undefined) porPosicao[idx].estoque += l.estoqueAtual;

      const alvo = Math.round(l.velocidadeDiaria * coberturaAlvoDias);
      if (l.estoqueAtual > alvo) excessoEstimado += l.estoqueAtual - alvo;
      else if (l.vendasDias90 > 0) necessidadeEstimada += alvo - l.estoqueAtual;
    }
    tamanhoMap.set(t, acc);
  }

  const porTamanho = [...tamanhoMap.entries()]
    .map(([tamanho, v]) => ({ tamanho, nucleo: ehTamanhoNucleo(tamanho), ...v }))
    .sort((a, b) => {
      const na = Number(a.tamanho);
      const nb = Number(b.tamanho);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.tamanho.localeCompare(b.tamanho, "pt-BR");
    });

  return {
    grupo,
    quantidadeTotal,
    porPosicao,
    porTamanho,
    demanda90,
    excessoEstimado,
    necessidadeEstimada,
    oportunidades,
    produtos: new Set(variantes.map((v) => v.produto)).size,
  };
}

// ---------------------------------------------------------------------------
// CAMADA DE DADOS
// ---------------------------------------------------------------------------

export type ComparacaoFiltro = {
  grupoIn?: string[];
  colecaoIn?: string[];
  busca?: string;
  storeIdsPermitidas?: string[]; // restrição por usuário (allowedStores) — ver página
  tamanhoIn?: string[];
};

export type ComparacaoVariante = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  porLoja: VariantePorLoja[];
  tipoCompra: TipoCompraProduto | null;
  vendasSite90: number;
};

export type ComparacaoCompleta = {
  variantes: ComparacaoVariante[];
  posicoes: PosicoesEstoque;
  // Lista de posições na ordem de exibição (lojas por nome, CD/Site no fim).
  colunas: { posicaoId: string; posicaoNome: string; tipoPosicao: TipoPosicao }[];
  gradePorProdutoPosicao: Record<string, GradePosicao>;
};

const JANELA_DIAS = { d30: 30, d60: 60, d90: 90 } as const;

function chaveGrade(produto: string, cor: string | null, posicaoId: string) {
  return `${produto}::${cor ?? ""}::${posicaoId}`;
}

// Monta TODO o input da inteligência de distribuição numa passada: posições reais (lojas de
// varejo + CD/Site como posição única), estoque, venda por janela, mínimo vigente, classificação
// Best Seller/Drop e grade real por produto×posição.
//
// Cacheado por filtro (mesmo padrão/TTL de cacheAsync+HEAVY_QUERY_CACHE_MS já usado nas outras
// métricas pesadas do Radar): medido em 2026-11-11 contra o dev, uma passada custa ~4-6s (2.6k
// SKUs × 4 posições, 3 groupBy sobre Sale). As 4 abas da tela derivam TODAS do mesmo resultado —
// sem o cache, abrir Visão Geral + Movimentações + Grade refazia a mesma consulta 5 vezes. O dado
// por trás só muda quando o sync roda (~5x/dia), nunca durante a navegação.
async function montarComparacao(filters: ComparacaoFiltro): Promise<ComparacaoCompleta> {
  return cacheAsync(`distribuicao-comparacao:${JSON.stringify(filters)}`, HEAVY_QUERY_CACHE_MS, () =>
    montarComparacaoSemCache(filters)
  );
}

async function montarComparacaoSemCache(filters: ComparacaoFiltro): Promise<ComparacaoCompleta> {
  const posicoes = await getPosicoesEstoque(filters.storeIdsPermitidas);
  const colunas = [
    ...posicoes.lojas.map((l) => ({ posicaoId: l.posicaoId, posicaoNome: l.nome, tipoPosicao: l.tipo })),
    ...(posicoes.cdSite
      ? [{ posicaoId: posicoes.cdSite.posicaoId, posicaoNome: posicoes.cdSite.nome, tipoPosicao: posicoes.cdSite.tipo }]
      : []),
  ];
  const vazio: ComparacaoCompleta = { variantes: [], posicoes, colunas, gradePorProdutoPosicao: {} };
  // Com menos de 2 posições visíveis não existe comparação possível (nem loja↔loja, nem
  // loja↔CD/Site) — a restrição por allowedStores do usuário pode chegar nesse caso.
  if (colunas.length < 2) return vazio;

  const todasPosicoes: PosicaoEstoque[] = [...posicoes.lojas, ...(posicoes.cdSite ? [posicoes.cdSite] : [])];
  const storeIds = todasPosicoes.flatMap((p) => p.storeIds);
  const posicaoDeStore = new Map<string, PosicaoEstoque>();
  for (const p of todasPosicoes) for (const sid of p.storeIds) posicaoDeStore.set(sid, p);

  const stockRows = await latestStockSnapshots({
    storeIds,
    grupoIn: filters.grupoIn,
    colecaoIn: filters.colecaoIn,
    tamanhoIn: filters.tamanhoIn,
  });
  const buscaLower = filters.busca?.trim().toLowerCase();
  const codsVistos = new Set<string>();
  const metaPorCod = new Map<
    string,
    { produto: string; grupo: string; cor: string | null; tamanho: string | null; colecao: string | null }
  >();
  for (const s of stockRows) {
    if (buscaLower && !s.produto.toLowerCase().includes(buscaLower) && !s.cod.toLowerCase().includes(buscaLower)) continue;
    codsVistos.add(s.cod);
    if (!metaPorCod.has(s.cod)) {
      metaPorCod.set(s.cod, { produto: s.produto, grupo: s.grupo, cor: null, tamanho: s.tamanho, colecao: s.colecao });
    }
  }
  const cods = [...codsVistos];
  if (cods.length === 0) return vazio;

  // cor não vem em latestStockSnapshots (select fixo em core.ts) — busca à parte, só pros cods
  // que sobreviveram ao filtro, pra não pedir uma coluna extra numa função genérica usada em
  // vários outros lugares.
  const corRows = await prisma.stockSnapshot.findMany({
    where: { cod: { in: cods } },
    distinct: ["cod"],
    select: { cod: true, cor: true },
  });
  for (const r of corRows) {
    const meta = metaPorCod.get(r.cod);
    if (meta) meta.cor = r.cor;
  }

  const agora = new Date();
  const desde = (dias: number) => new Date(agora.getTime() - dias * 86_400_000);

  const [vendas30, vendas60, vendas90, minimumRules, classificacoes] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { status: { not: "Cancelada" }, storeId: { in: storeIds }, cod: { in: cods }, saleDate: { gte: desde(JANELA_DIAS.d30) } },
      _sum: { quantidade: true },
    }),
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { status: { not: "Cancelada" }, storeId: { in: storeIds }, cod: { in: cods }, saleDate: { gte: desde(JANELA_DIAS.d60) } },
      _sum: { quantidade: true },
    }),
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { status: { not: "Cancelada" }, storeId: { in: storeIds }, cod: { in: cods }, saleDate: { gte: desde(JANELA_DIAS.d90) } },
      _sum: { quantidade: true },
    }),
    prisma.stockMinimumRule.findMany(),
    // Só a classificação já cadastrada — nunca inferida aqui (ver ClassificacaoProduto no schema:
    // produto sem linha fica "desconhecido", não herda BEST_SELLER por vender muito).
    prisma.classificacaoProduto.findMany({ where: { cod: { in: cods } }, select: { cod: true, tipoCompra: true } }),
  ]);

  const tipoCompraPorCod = new Map(classificacoes.map((c) => [c.cod, c.tipoCompra]));

  // Agrega estoque/venda por POSIÇÃO (soma os storeIds de uma mesma posição — é assim que CD e
  // ATACADO viram uma posição única sem duplicar nem sobrescrever a quantidade).
  const key = (posicaoId: string, cod: string) => `${posicaoId}::${cod}`;
  const estoquePorPosicao = new Map<string, number>();
  const minimoDapicPorPosicao = new Map<string, number | null>();
  for (const s of stockRows) {
    const p = posicaoDeStore.get(s.storeId);
    if (!p) continue;
    const k = key(p.posicaoId, s.cod);
    estoquePorPosicao.set(k, (estoquePorPosicao.get(k) ?? 0) + s.quantidadeDisponivel);
    if (s.estoqueMinimo != null) minimoDapicPorPosicao.set(k, Math.max(minimoDapicPorPosicao.get(k) ?? 0, s.estoqueMinimo));
  }

  function agregarVendas(rows: { storeId: string; cod: string; _sum: { quantidade: number | null } }[]) {
    const m = new Map<string, number>();
    for (const r of rows) {
      const p = posicaoDeStore.get(r.storeId);
      if (!p) continue;
      const k = key(p.posicaoId, r.cod);
      m.set(k, (m.get(k) ?? 0) + (r._sum.quantidade ?? 0));
    }
    return m;
  }
  const v30 = agregarVendas(vendas30);
  const v60 = agregarVendas(vendas60);
  const v90 = agregarVendas(vendas90);

  // Venda do SITE (ecommerce) por cod — só a store "CD", sem atacado (ver storeIdEcommerce).
  const siteStoreId = posicoes.cdSite?.storeIdEcommerce;
  const vendasSite90PorCod = new Map<string, number>();
  if (siteStoreId) {
    for (const r of vendas90) {
      if (r.storeId !== siteStoreId) continue;
      vendasSite90PorCod.set(r.cod, (vendasSite90PorCod.get(r.cod) ?? 0) + (r._sum.quantidade ?? 0));
    }
  }

  const variantes: ComparacaoVariante[] = [];
  for (const cod of cods) {
    const meta = metaPorCod.get(cod)!;
    const porLoja: VariantePorLoja[] = todasPosicoes.map((p) => {
      const k = key(p.posicaoId, cod);
      const estoqueAtual = estoquePorPosicao.get(k) ?? 0;
      const vendasDias30 = v30.get(k) ?? 0;
      const vendasDias60 = v60.get(k) ?? 0;
      const vendasDias90 = v90.get(k) ?? 0;
      const velocidadeDiaria = vendasDias30 > 0 ? vendasDias30 / 30 : vendasDias90 / 90;
      const coberturaDias = velocidadeDiaria > 0 ? Math.round((estoqueAtual / velocidadeDiaria) * 10) / 10 : null;
      // Mínimo vigente: StockMinimumRule (regra manual do Rodrigo, mais específica ganha —
      // matchMinimumRule) com fallback no mínimo que vem do DAPIC. Pro CD/Site, a regra pode estar
      // cadastrada em qualquer um dos 2 armazenadores da posição: pega o maior (mais conservador,
      // nunca esvazia a posição abaixo do que QUALQUER regra cadastrada pede).
      const minimoRegra = p.storeIds
        .map((sid) => matchMinimumRule(minimumRules, { storeId: sid, grupo: meta.grupo, tamanho: meta.tamanho, colecao: meta.colecao }))
        .filter((x): x is number => x != null);
      const estoqueMinimo = minimoRegra.length > 0 ? Math.max(...minimoRegra) : minimoDapicPorPosicao.get(k) ?? null;
      const diagnostico = diagnosticarVariante(
        { estoqueAtual, vendasDias30, vendasDias90, velocidadeDiaria, coberturaDias },
        p.tipo
      );
      return {
        storeId: p.posicaoId,
        storeCode: p.storeIds.join("|"),
        storeName: p.nome,
        tipoPosicao: p.tipo,
        estoqueAtual,
        vendasDias30,
        vendasDias60,
        vendasDias90,
        velocidadeDiaria,
        coberturaDias,
        estoqueMinimo,
        diagnostico,
      };
    });

    variantes.push({
      cod,
      produto: meta.produto,
      grupo: meta.grupo,
      cor: meta.cor,
      tamanho: meta.tamanho,
      colecao: meta.colecao,
      porLoja,
      tipoCompra: tipoCompraPorCod.get(cod) ?? null,
      vendasSite90: vendasSite90PorCod.get(cod) ?? 0,
    });
  }

  variantes.sort(
    (a, b) => a.produto.localeCompare(b.produto, "pt-BR") || (a.tamanho ?? "").localeCompare(b.tamanho ?? "", "pt-BR")
  );

  // Grade real por produto(+cor)×posição: quantos tamanhos a unidade tem com estoque e quantos ela
  // de fato vendeu em 90 dias. Base histórica do sinal "grade quebrada" do recolhimento.
  const gradeAcc = new Map<string, { comEstoque: Set<string>; comVenda: Set<string>; todos: Set<string> }>();
  for (const v of variantes) {
    const t = v.tamanho ?? "—";
    for (const l of v.porLoja) {
      const k = chaveGrade(v.produto, v.cor, l.storeId);
      let acc = gradeAcc.get(k);
      if (!acc) {
        acc = { comEstoque: new Set(), comVenda: new Set(), todos: new Set() };
        gradeAcc.set(k, acc);
      }
      acc.todos.add(t);
      if (l.estoqueAtual > 0) acc.comEstoque.add(t);
      if (l.vendasDias90 > 0) acc.comVenda.add(t);
    }
  }
  const gradePorProdutoPosicao: Record<string, GradePosicao> = {};
  for (const [k, acc] of gradeAcc) {
    gradePorProdutoPosicao[k] = {
      tamanhosComEstoque: acc.comEstoque.size,
      tamanhosComVenda: acc.comVenda.size,
      totalTamanhos: acc.todos.size,
    };
  }

  return { variantes, posicoes, colunas, gradePorProdutoPosicao };
}

// Mantida (nome e saída originais) pra tabela comparativa produto × unidade — agora as colunas
// incluem o CD/Site e as demais lojas de varejo reais, não só as 3 hardcoded de antes.
export async function getComparacaoEntreLojas(filters: ComparacaoFiltro = {}): Promise<ComparacaoVariante[]> {
  return (await montarComparacao(filters)).variantes;
}

export async function getComparacaoCompleta(filters: ComparacaoFiltro = {}): Promise<ComparacaoCompleta> {
  return montarComparacao(filters);
}

// Só a lista de unidades (pros dropdowns de Origem/Destino do filtro) — sem tocar em
// StockSnapshot/Sale por SKU, que é o custo real de montarComparacao.
export async function getUnidadesDistribuicao(
  storeIdsPermitidas?: string[]
): Promise<{ posicaoId: string; posicaoNome: string; tipoPosicao: TipoPosicao }[]> {
  const posicoes = await getPosicoesEstoque(storeIdsPermitidas);
  return [
    ...posicoes.lojas.map((l) => ({ posicaoId: l.posicaoId, posicaoNome: l.nome, tipoPosicao: l.tipo })),
    ...(posicoes.cdSite
      ? [{ posicaoId: posicoes.cdSite.posicaoId, posicaoNome: posicoes.cdSite.nome, tipoPosicao: posicoes.cdSite.tipo }]
      : []),
  ];
}

const COBERTURA_ALVO_PADRAO_DIAS = 30;

const PESO_PRIORIDADE: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

export type MovimentacoesFiltro = ComparacaoFiltro & {
  tipoIn?: TipoMovimentacao[];
  prioridadeIn?: Prioridade[];
  origemIn?: string[];
  destinoIn?: string[];
};

export type MovimentacoesResultado = ResultadoMovimentacoes & {
  colunas: ComparacaoCompleta["colunas"];
  totalAntesDoFiltro: number;
};

// Ponto de entrada da aba Movimentações. Nunca executa nada — só recomenda (ver cabeçalho).
export async function getMovimentacoesRecomendadas(
  filters: MovimentacoesFiltro = {},
  coberturaAlvoDias = COBERTURA_ALVO_PADRAO_DIAS
): Promise<MovimentacoesResultado> {
  const { variantes, colunas, gradePorProdutoPosicao } = await montarComparacao(filters);

  const movimentacoes: MovimentacaoRecomendada[] = [];
  const manter: RecomendacaoManter[] = [];
  for (const c of variantes) {
    const gradePorPosicao: Record<string, GradePosicao> = {};
    for (const l of c.porLoja) {
      const g = gradePorProdutoPosicao[chaveGrade(c.produto, c.cor, l.storeId)];
      if (g) gradePorPosicao[l.storeId] = g;
    }
    const r = calcularMovimentacoes(c.porLoja, {
      cod: c.cod,
      produto: c.produto,
      grupo: c.grupo,
      cor: c.cor,
      tamanho: c.tamanho,
      coberturaAlvoDias,
      tipoCompra: c.tipoCompra,
      vendasSite90: c.vendasSite90,
      gradePorPosicao,
    });
    movimentacoes.push(...r.movimentacoes);
    manter.push(...r.manter);
  }

  // Grade por tamanho das duas pontas, pra linha expandida (só camada de dados — ver
  // MovimentacaoRecomendada.gradeTamanhos).
  const variantesPorProduto = new Map<string, ComparacaoVariante[]>();
  for (const v of variantes) {
    const k = `${v.produto}::${v.cor ?? ""}`;
    const arr = variantesPorProduto.get(k) ?? [];
    arr.push(v);
    variantesPorProduto.set(k, arr);
  }
  for (const m of movimentacoes) {
    const irmas = variantesPorProduto.get(`${m.produto}::${m.cor ?? ""}`) ?? [];
    const porTamanho = new Map<string, { estoqueOrigem: number; estoqueDestino: number; vendas90Origem: number; vendas90Destino: number }>();
    for (const v of irmas) {
      const t = v.tamanho ?? "—";
      const acc = porTamanho.get(t) ?? { estoqueOrigem: 0, estoqueDestino: 0, vendas90Origem: 0, vendas90Destino: 0 };
      const o = v.porLoja.find((l) => l.storeId === m.origemPosicaoId);
      const d = v.porLoja.find((l) => l.storeId === m.destinoPosicaoId);
      acc.estoqueOrigem += o?.estoqueAtual ?? 0;
      acc.vendas90Origem += o?.vendasDias90 ?? 0;
      acc.estoqueDestino += d?.estoqueAtual ?? 0;
      acc.vendas90Destino += d?.vendasDias90 ?? 0;
      porTamanho.set(t, acc);
    }
    m.gradeTamanhos = [...porTamanho.entries()]
      .map(([tamanho, v]) => ({ tamanho, nucleo: ehTamanhoNucleo(tamanho), ...v }))
      .sort((a, b) => {
        const na = Number(a.tamanho);
        const nb = Number(b.tamanho);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.tamanho.localeCompare(b.tamanho, "pt-BR");
      });
  }

  movimentacoes.sort(
    (a, b) => PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade] || b.quantidadeSugerida - a.quantidadeSugerida
  );

  const totalAntesDoFiltro = movimentacoes.length;
  const filtradas = movimentacoes.filter(
    (m) =>
      (!filters.tipoIn || filters.tipoIn.length === 0 || filters.tipoIn.includes(m.tipoMovimentacao)) &&
      (!filters.prioridadeIn || filters.prioridadeIn.length === 0 || filters.prioridadeIn.includes(m.prioridade)) &&
      (!filters.origemIn || filters.origemIn.length === 0 || filters.origemIn.includes(m.origemPosicaoId)) &&
      (!filters.destinoIn || filters.destinoIn.length === 0 || filters.destinoIn.includes(m.destinoPosicaoId))
  );

  return { movimentacoes: filtradas, manter, colunas, totalAntesDoFiltro };
}

// ---------------------------------------------------------------------------
// VISÃO GERAL
// ---------------------------------------------------------------------------

export type ResumoPorUnidade = {
  posicaoId: string;
  posicaoNome: string;
  tipoPosicao: TipoPosicao;
  estoqueTotal: number;
  skusComEstoque: number;
  excessoUnidades: number;
  necessidadeUnidades: number;
  variantesPrecisa: number;
  variantesSobra: number;
  variantesParadas: number;
  situacao: "falta" | "excesso" | "equilibrado" | "sem_dado";
};

export type VisaoGeralDistribuicao = {
  estoqueTotal: number;
  porUnidade: ResumoPorUnidade[];
  excessoUnidades: number;
  produtosGradeIncompleta: number;
  oportunidadesRedistribuicao: number;
  pecasMovimentaveis: number;
  alertasEstoqueParado: number;
  variantesAnalisadas: number;
  semDadoSuficiente: number;
  unidadesIgnoradas: { nome: string; motivo: string }[];
  recolhimentos: number;
  manterCount: number;
  baixaConfianca: number;
};

export async function getVisaoGeralDistribuicao(
  filters: ComparacaoFiltro = {},
  coberturaAlvoDias = COBERTURA_ALVO_PADRAO_DIAS
): Promise<VisaoGeralDistribuicao> {
  const [{ variantes, colunas, posicoes, gradePorProdutoPosicao }, mov] = await Promise.all([
    montarComparacao(filters),
    getMovimentacoesRecomendadas(filters, coberturaAlvoDias),
  ]);

  const porUnidade: ResumoPorUnidade[] = colunas.map((c) => ({
    posicaoId: c.posicaoId,
    posicaoNome: c.posicaoNome,
    tipoPosicao: c.tipoPosicao,
    estoqueTotal: 0,
    skusComEstoque: 0,
    excessoUnidades: 0,
    necessidadeUnidades: 0,
    variantesPrecisa: 0,
    variantesSobra: 0,
    variantesParadas: 0,
    situacao: "sem_dado",
  }));
  const idx = new Map(porUnidade.map((u, i) => [u.posicaoId, i]));

  let estoqueTotal = 0;
  let alertasEstoqueParado = 0;
  let semDadoSuficiente = 0;

  for (const v of variantes) {
    if (v.porLoja.every((l) => l.diagnostico === "sem_dado")) semDadoSuficiente += 1;
    for (const l of v.porLoja) {
      const i = idx.get(l.storeId);
      if (i === undefined) continue;
      const u = porUnidade[i];
      u.estoqueTotal += l.estoqueAtual;
      estoqueTotal += l.estoqueAtual;
      if (l.estoqueAtual > 0) u.skusComEstoque += 1;
      const alvo = Math.round(l.velocidadeDiaria * coberturaAlvoDias);
      if (l.estoqueAtual > alvo) u.excessoUnidades += l.estoqueAtual - alvo;
      else if (l.vendasDias90 > 0) u.necessidadeUnidades += alvo - l.estoqueAtual;
      if (l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica") u.variantesPrecisa += 1;
      if (l.diagnostico === "cobertura_excessiva") u.variantesSobra += 1;
      if (l.diagnostico === "estoque_parado") {
        u.variantesParadas += 1;
        alertasEstoqueParado += 1;
      }
    }
  }

  for (const u of porUnidade) {
    if (u.variantesPrecisa === 0 && u.variantesSobra === 0 && u.variantesParadas === 0) {
      u.situacao = u.estoqueTotal > 0 ? "equilibrado" : "sem_dado";
    } else if (u.variantesPrecisa > u.variantesSobra + u.variantesParadas) u.situacao = "falta";
    else if (u.variantesSobra + u.variantesParadas > u.variantesPrecisa) u.situacao = "excesso";
    else u.situacao = "equilibrado";
  }

  // Produto com grade incompleta: existe pelo menos uma posição onde o produto vende mais tamanhos
  // do que ele tem em estoque hoje (definição histórica, ver GradePosicao).
  const produtosGradeIncompleta = new Set<string>();
  for (const [chave, g] of Object.entries(gradePorProdutoPosicao)) {
    if (g.tamanhosComEstoque < g.tamanhosComVenda) produtosGradeIncompleta.add(chave.split("::")[0]);
  }

  return {
    estoqueTotal,
    porUnidade,
    excessoUnidades: porUnidade.reduce((s, u) => s + u.excessoUnidades, 0),
    produtosGradeIncompleta: produtosGradeIncompleta.size,
    oportunidadesRedistribuicao: mov.movimentacoes.filter((m) => m.classificacao === "REDISTRIBUIR").length,
    pecasMovimentaveis: mov.movimentacoes.reduce((s, m) => s + m.quantidadeSugerida, 0),
    alertasEstoqueParado,
    variantesAnalisadas: variantes.length,
    semDadoSuficiente,
    unidadesIgnoradas: posicoes.ignoradas,
    recolhimentos: mov.movimentacoes.filter((m) => m.classificacao === "RECOLHER_PARA_CD_SITE").length,
    manterCount: mov.manter.length,
    baixaConfianca: mov.movimentacoes.filter((m) => m.confianca === "baixa").length,
  };
}

// ---------------------------------------------------------------------------
// ANÁLISE DE GRADE (dados)
// ---------------------------------------------------------------------------

export type AnaliseGradeResultado = {
  colunas: ComparacaoCompleta["colunas"];
  porProduto: MatrizGradeProduto[];
  porGrupo: ResumoGrupoGrade[];
};

export async function getAnaliseGrade(
  filters: ComparacaoFiltro = {},
  coberturaAlvoDias = COBERTURA_ALVO_PADRAO_DIAS,
  limiteProdutos = 40
): Promise<AnaliseGradeResultado> {
  const [{ variantes, colunas }, mov] = await Promise.all([
    montarComparacao(filters),
    getMovimentacoesRecomendadas(filters, coberturaAlvoDias),
  ]);

  const oportunidadesPorGrupo = new Map<string, number>();
  for (const m of mov.movimentacoes) {
    oportunidadesPorGrupo.set(m.grupo, (oportunidadesPorGrupo.get(m.grupo) ?? 0) + 1);
  }

  const porProdutoMap = new Map<string, ComparacaoVariante[]>();
  for (const v of variantes) {
    const k = `${v.produto}::${v.cor ?? ""}`;
    const arr = porProdutoMap.get(k) ?? [];
    arr.push(v);
    porProdutoMap.set(k, arr);
  }

  const porProduto = [...porProdutoMap.values()]
    .map((vs) => montarMatrizGrade(vs, colunas))
    .filter((m): m is MatrizGradeProduto => m !== null)
    // Produto com mais buraco de grade no núcleo primeiro — é o que mais custa venda.
    .sort(
      (a, b) =>
        b.buracosGradeNucleo - a.buracosGradeNucleo ||
        b.buracosGrade - a.buracosGrade ||
        b.totalGeral - a.totalGeral ||
        a.produto.localeCompare(b.produto, "pt-BR")
    )
    .slice(0, limiteProdutos);

  const porGrupoMap = new Map<string, ComparacaoVariante[]>();
  for (const v of variantes) {
    const arr = porGrupoMap.get(v.grupo) ?? [];
    arr.push(v);
    porGrupoMap.set(v.grupo, arr);
  }
  const porGrupo = [...porGrupoMap.entries()]
    .map(([grupo, vs]) =>
      resumirGrupoGrade(
        grupo,
        vs,
        colunas.map((c) => ({ posicaoId: c.posicaoId, posicaoNome: c.posicaoNome })),
        coberturaAlvoDias,
        oportunidadesPorGrupo.get(grupo) ?? 0
      )
    )
    .sort((a, b) => b.quantidadeTotal - a.quantidadeTotal);

  return { colunas, porProduto, porGrupo };
}

// ---------------------------------------------------------------------------
// HISTÓRICO / ACOMPANHAMENTO DE DECISÃO (persistência)
// ---------------------------------------------------------------------------
// Mesmo padrão de DecisaoCompra (compras-inteligencia.ts: registrarDecisaoCompra): a RECOMENDAÇÃO
// em si nunca é gravada ao ser calculada (as funções acima são puras / de leitura) — só grava
// quando um humano decide algo sobre ela. Status cobre o ciclo pedido: recomendação gerada →
// aprovada → movimentação executada → recusada → pendente.
//
// IMPORTANTE: a tabela depende da migration 20261111160000_add_decisao_movimentacao_estoque, que
// foi GERADA mas deliberadamente NÃO aplicada em produção nesta entrega. Por isso toda leitura
// passa por `comTabelaOpcional`, que devolve "migration pendente" em vez de estourar a tela.

export type StatusMovimentacaoRegistro = "PENDENTE" | "APROVADA" | "EXECUTADA" | "RECUSADA";

// O tipo de domínio é minúsculo (loja_loja) porque é o que a UI/URL usa; o enum do Postgres é
// maiúsculo (convenção de todos os enums do schema). Mapeamento explícito nos 2 sentidos — nunca
// `.toUpperCase()`, que silenciaria um valor novo não previsto.
const TIPO_MOV_DB: Record<TipoMovimentacao, TipoMovimentacaoEstoque> = {
  loja_loja: "LOJA_LOJA",
  cd_site_loja: "CD_SITE_LOJA",
  loja_cd_site: "LOJA_CD_SITE",
};

export function tipoMovimentacaoLabel(t: TipoMovimentacao | string): string {
  switch (t) {
    case "loja_loja":
    case "LOJA_LOJA":
      return "Loja → Loja";
    case "cd_site_loja":
    case "CD_SITE_LOJA":
      return "CD/Site → Loja";
    case "loja_cd_site":
    case "LOJA_CD_SITE":
      return "Loja → CD/Site";
    default:
      return String(t);
  }
}

export type RegistrarDecisaoMovimentacaoInput = {
  cod: string;
  produto: string;
  grupo: string;
  cor?: string | null;
  tamanho?: string | null;
  origemPosicaoId: string;
  origemNome: string;
  destinoPosicaoId: string;
  destinoNome: string;
  tipoMovimentacao: TipoMovimentacao;
  classificacao: ClassificacaoMovimentacao;
  quantidadeSugerida: number;
  quantidadeAprovada?: number | null;
  quantidadeExecutada?: number | null;
  status: StatusMovimentacaoRegistro;
  confianca: Confianca;
  premissas: unknown;
  responsavel?: string | null;
  observacao?: string | null;
};

// Erro do Prisma pra "tabela não existe no banco" (P2021) e "coluna não existe" (P2022) — o
// estado real deste repositório enquanto a migration não for aplicada.
function ehTabelaInexistente(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022");
}

export type HistoricoMovimentacoes = {
  migrationPendente: boolean;
  itens: {
    id: string;
    cod: string;
    produto: string;
    grupo: string;
    cor: string | null;
    tamanho: string | null;
    origemNome: string;
    destinoNome: string;
    tipoMovimentacao: string;
    classificacao: string;
    quantidadeSugerida: number;
    quantidadeAprovada: number | null;
    quantidadeExecutada: number | null;
    status: string;
    confianca: string;
    recomendadoEm: Date;
    decididoEm: Date | null;
    decididoPor: string | null;
    executadoEm: Date | null;
    executadoPor: string | null;
    observacao: string | null;
  }[];
};

export async function getHistoricoMovimentacoes(
  filters: { status?: StatusMovimentacaoRegistro; cod?: string; limite?: number } = {}
): Promise<HistoricoMovimentacoes> {
  try {
    const itens = await prisma.decisaoMovimentacaoEstoque.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.cod ? { cod: filters.cod } : {}),
      },
      orderBy: [{ recomendadoEm: "desc" }],
      take: filters.limite ?? 200,
    });
    return { migrationPendente: false, itens };
  } catch (e) {
    if (ehTabelaInexistente(e)) return { migrationPendente: true, itens: [] };
    throw e;
  }
}

export async function registrarDecisaoMovimentacao(input: RegistrarDecisaoMovimentacaoInput) {
  const agora = new Date();
  return prisma.decisaoMovimentacaoEstoque.create({
    data: {
      cod: input.cod,
      produto: input.produto,
      grupo: input.grupo,
      cor: input.cor ?? null,
      tamanho: input.tamanho ?? null,
      origemPosicaoId: input.origemPosicaoId,
      origemNome: input.origemNome,
      destinoPosicaoId: input.destinoPosicaoId,
      destinoNome: input.destinoNome,
      tipoMovimentacao: TIPO_MOV_DB[input.tipoMovimentacao],
      classificacao: input.classificacao,
      quantidadeSugerida: input.quantidadeSugerida,
      quantidadeAprovada: input.quantidadeAprovada ?? null,
      quantidadeExecutada: input.quantidadeExecutada ?? null,
      status: input.status,
      confianca: input.confianca,
      premissas: input.premissas as Prisma.InputJsonValue,
      // Só preenche data/responsável de decisão quando a decisão de fato aconteceu — PENDENTE é
      // "recomendação registrada pra acompanhar", sem decisão ainda.
      decididoEm: input.status === "PENDENTE" ? null : agora,
      decididoPor: input.status === "PENDENTE" ? null : input.responsavel ?? null,
      executadoEm: input.status === "EXECUTADA" ? agora : null,
      executadoPor: input.status === "EXECUTADA" ? input.responsavel ?? null : null,
      observacao: input.observacao ?? null,
    },
  });
}

export async function atualizarStatusMovimentacao(args: {
  id: string;
  status: StatusMovimentacaoRegistro;
  quantidadeAprovada?: number | null;
  quantidadeExecutada?: number | null;
  responsavel?: string | null;
  observacao?: string | null;
}) {
  const agora = new Date();
  return prisma.decisaoMovimentacaoEstoque.update({
    where: { id: args.id },
    data: {
      status: args.status,
      ...(args.quantidadeAprovada !== undefined ? { quantidadeAprovada: args.quantidadeAprovada } : {}),
      ...(args.quantidadeExecutada !== undefined ? { quantidadeExecutada: args.quantidadeExecutada } : {}),
      decididoEm: agora,
      decididoPor: args.responsavel ?? null,
      ...(args.status === "EXECUTADA" ? { executadoEm: agora, executadoPor: args.responsavel ?? null } : {}),
      ...(args.observacao !== undefined ? { observacao: args.observacao } : {}),
    },
  });
}
