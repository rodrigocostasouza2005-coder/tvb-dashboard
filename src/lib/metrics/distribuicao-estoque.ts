import { prisma } from "@/lib/prisma";
import { latestStockSnapshots } from "./core";
import { matchMinimumRule } from "./estoque";

// Lojas físicas de varejo onde a comparação faz sentido — âncora por CODE explícito, não por
// `sellsProducts` (achado na validação manual de 2026-10-30: o banco tem outros armazenadores com
// sellsProducts=true que NÃO são loja de verdade — "Uniformes", "Produtos acabados",
// "Matérias-primas" — simplesmente porque o nome deles não bate com o regex NAO_VENDE de
// armazenadores.ts. Mesma classe de bug já corrigida pro primaryStoreId do sync em 2026-10-30
// — "o primeiro/todos que não batem num regex de exclusão" não é o mesmo que "é uma loja real").
const CODES_LOJAS_VAREJO = ["Leblon", "Rio Sul", "Barra"];

// ---------------------------------------------------------------------------
// AGENTE DE INTELIGÊNCIA DE DISTRIBUIÇÃO DE ESTOQUE
// ---------------------------------------------------------------------------
// Pedido do Rodrigo em 2026-10-30 ("CORREÇÃO DO MAPA DE COMPRAS E SEPARAÇÃO DO AGENTE DE
// DISTRIBUIÇÃO"): responder "o estoque de cada produto está bem distribuído entre as lojas, ou
// vale transferir?" — pergunta DIFERENTE de "quanto comprar" (isso é compras-inteligencia.ts).
//
// Regras de arquitetura, pedidas explicitamente:
// - NUNCA sugere quantidade de compra, nem importa nada de compras-inteligencia.ts.
// - NUNCA executa transferência — só recomenda; a equipe decide e executa fora do Radar.
// - Compara só as lojas físicas de VAREJO (Leblon, Barra, Rio Sul, ver CODES_LOJAS_VAREJO acima)
//   — o armazém CD/ATACADO já tem sua própria lógica de abastecimento (Reposição,
//   getReplenishment*) e não é "uma loja" no sentido comercial.
//
// Mesma separação de camadas de compras-inteligencia.ts: funções PURAS (testáveis sem banco) +
// camada de DADOS (monta o input real a partir de Sale/StockSnapshot/StockMinimumRule).

export type Diagnostico =
  | "sem_dado"
  | "ruptura"
  | "cobertura_critica"
  | "equilibrado"
  | "cobertura_excessiva"
  | "estoque_parado";

export type VariantePorLoja = {
  storeId: string;
  storeCode: string;
  storeName: string;
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

export function diagnosticarVariante(v: {
  estoqueAtual: number;
  vendasDias30: number;
  vendasDias90: number;
  velocidadeDiaria: number;
  coberturaDias: number | null;
}): Diagnostico {
  if (v.estoqueAtual === 0 && v.vendasDias90 === 0) return "sem_dado";
  if (v.estoqueAtual === 0 && v.vendasDias90 > 0) return "ruptura";
  if (v.estoqueAtual > 0 && v.vendasDias90 === 0) return "estoque_parado";
  if (v.coberturaDias == null) return "sem_dado";
  if (v.coberturaDias < COBERTURA_CRITICA_DIAS) return "cobertura_critica";
  if (v.coberturaDias > COBERTURA_EXCESSIVA_DIAS) return "cobertura_excessiva";
  return "equilibrado";
}

export type OportunidadeTransferencia = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  lojaOrigem: string;
  lojaDestino: string;
  estoqueOrigemAntes: number;
  estoqueOrigemDepois: number;
  estoqueDestinoAntes: number;
  estoqueDestinoDepois: number;
  coberturaOrigemAntes: number | null;
  coberturaOrigemDepois: number | null;
  coberturaDestinoAntes: number | null;
  coberturaDestinoDepois: number | null;
  quantidadeSugerida: number;
  justificativa: string[];
};

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

// Pura, testável sem banco. Recebe TODAS as linhas (uma por loja) do MESMO cod e decide se há
// oportunidade real de transferência. Regra explícita, sem score oculto:
//  - DESTINO elegível: ruptura ou cobertura crítica (ambos já implicam demanda comprovada — ver
//    diagnosticarVariante: só entram nesses estados quem teve venda real nos últimos 90 dias).
//  - ORIGEM elegível: cobertura excessiva ou estoque parado, com sobra REAL depois de reservar o
//    próprio mínimo (StockMinimumRule, quando existir) + uma margem de segurança (meia semana da
//    própria venda) — nunca esvazia uma loja abaixo do que ela mesma precisa.
//  - Quantidade = min(necessidade do destino até a cobertura-alvo, sobra disponível na origem).
//  - Alocação gulosa: destino com maior necessidade primeiro, origem com maior sobra primeiro —
//    uma origem grande pode abastecer mais de um destino; nunca origem == destino.
export function calcularOportunidadeTransferencia(
  variantes: VariantePorLoja[],
  contexto: ContextoVariante
): OportunidadeTransferencia[] {
  const MARGEM_SEMANAS = 0.5;

  const origens = variantes
    .filter((v) => v.diagnostico === "cobertura_excessiva" || v.diagnostico === "estoque_parado")
    .map((v) => {
      const margemSeguranca = Math.round(v.velocidadeDiaria * 7 * MARGEM_SEMANAS);
      const disponivel = Math.max(0, v.estoqueAtual - (v.estoqueMinimo ?? 0) - margemSeguranca);
      return { ...v, disponivel, margemSeguranca };
    })
    .filter((v) => v.disponivel > 0)
    .sort((a, b) => b.disponivel - a.disponivel);

  const destinos = variantes
    .filter((v) => v.diagnostico === "ruptura" || v.diagnostico === "cobertura_critica")
    .map((v) => {
      // Velocidade de 30d pode estar artificialmente baixa/zero se a ruptura começou DENTRO da
      // janela de 30 dias (a loja só vendeu enquanto tinha estoque) — cai pra 90d nesse caso pra
      // não subestimar a necessidade real.
      const velocidadeParaNecessidade = v.vendasDias30 > 0 ? v.vendasDias30 / 30 : v.vendasDias90 / 90;
      const necessidade = Math.max(0, Math.round(velocidadeParaNecessidade * contexto.coberturaAlvoDias) - v.estoqueAtual);
      return { ...v, necessidade };
    })
    .filter((v) => v.necessidade > 0)
    .sort((a, b) => b.necessidade - a.necessidade);

  const resultado: OportunidadeTransferencia[] = [];
  for (const destino of destinos) {
    let faltaAtender = destino.necessidade;
    for (const origem of origens) {
      if (faltaAtender <= 0) break;
      if (origem.storeId === destino.storeId) continue;
      if (origem.disponivel <= 0) continue;

      const quantidade = Math.min(faltaAtender, origem.disponivel);
      if (quantidade <= 0) continue;

      const origemDepois = origem.estoqueAtual - quantidade;
      const destinoDepois = destino.estoqueAtual + quantidade;
      resultado.push({
        cod: contexto.cod,
        produto: contexto.produto,
        grupo: contexto.grupo,
        cor: contexto.cor,
        tamanho: contexto.tamanho,
        lojaOrigem: origem.storeName,
        lojaDestino: destino.storeName,
        estoqueOrigemAntes: origem.estoqueAtual,
        estoqueOrigemDepois: origemDepois,
        estoqueDestinoAntes: destino.estoqueAtual,
        estoqueDestinoDepois: destinoDepois,
        coberturaOrigemAntes: origem.coberturaDias,
        coberturaOrigemDepois: origem.velocidadeDiaria > 0 ? Math.round((origemDepois / origem.velocidadeDiaria) * 10) / 10 : null,
        coberturaDestinoAntes: destino.coberturaDias,
        coberturaDestinoDepois:
          destino.velocidadeDiaria > 0 ? Math.round((destinoDepois / destino.velocidadeDiaria) * 10) / 10 : null,
        quantidadeSugerida: quantidade,
        justificativa: [
          `${destino.storeName}: ${destino.diagnostico === "ruptura" ? "sem estoque e com venda real nos últimos 90 dias" : `cobertura de ${destino.coberturaDias} dia(s), abaixo do limite crítico`}.`,
          `${origem.storeName}: ${origem.diagnostico === "estoque_parado" ? "estoque sem nenhuma venda nos últimos 90 dias" : `cobertura de ${origem.coberturaDias} dia(s), bem acima do normal`}, com ${origem.disponivel} un. disponível acima do próprio mínimo${origem.margemSeguranca > 0 ? ` + margem de segurança (${origem.margemSeguranca} un.)` : ""}.`,
          `Quantidade = menor valor entre o que ${destino.storeName} precisa pra chegar a ${contexto.coberturaAlvoDias} dias de cobertura e o que ${origem.storeName} pode doar sem comprometer o próprio estoque.`,
        ],
      });
      origem.disponivel -= quantidade;
      faltaAtender -= quantidade;
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// CAMADA DE DADOS
// ---------------------------------------------------------------------------

export type ComparacaoFiltro = {
  grupoIn?: string[];
  colecaoIn?: string[];
  busca?: string;
  storeIdsPermitidas?: string[]; // restrição por usuário (allowedStores) — ver página
};

export type ComparacaoVariante = {
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  porLoja: VariantePorLoja[];
};

const JANELA_DIAS = { d30: 30, d60: 60, d90: 90 } as const;

// As 3 lojas físicas de varejo (CODES_LOJAS_VAREJO). Se o usuário tiver allowedStores restrito, a
// interseção é aplicada aqui (nunca mostra loja fora da permissão dele, mesmo que ela seja uma
// das 3).
async function getLojasVarejo(storeIdsPermitidas?: string[]) {
  const stores = await prisma.store.findMany({
    where: {
      code: { in: CODES_LOJAS_VAREJO },
      ...(storeIdsPermitidas ? { id: { in: storeIdsPermitidas } } : {}),
    },
    orderBy: { name: "asc" },
  });
  return stores;
}

async function montarComparacao(filters: ComparacaoFiltro): Promise<ComparacaoVariante[]> {
  const lojas = await getLojasVarejo(filters.storeIdsPermitidas);
  if (lojas.length < 2) return []; // nada pra comparar com 0 ou 1 loja visível

  const lojaIds = lojas.map((l) => l.id);

  const stockRows = await latestStockSnapshots({ storeIds: lojaIds, grupoIn: filters.grupoIn, colecaoIn: filters.colecaoIn });
  const buscaLower = filters.busca?.trim().toLowerCase();
  const codsVistos = new Set<string>();
  const metaPorCod = new Map<string, { produto: string; grupo: string; cor: string | null; tamanho: string | null; colecao: string | null }>();
  for (const s of stockRows) {
    if (buscaLower && !s.produto.toLowerCase().includes(buscaLower) && !s.cod.toLowerCase().includes(buscaLower)) continue;
    codsVistos.add(s.cod);
    if (!metaPorCod.has(s.cod)) {
      metaPorCod.set(s.cod, { produto: s.produto, grupo: s.grupo, cor: null, tamanho: s.tamanho, colecao: s.colecao });
    }
  }
  const cods = [...codsVistos];
  if (cods.length === 0) return [];

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

  const [vendas30, vendas60, vendas90, minimumRules] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { status: { not: "Cancelada" }, storeId: { in: lojaIds }, cod: { in: cods }, saleDate: { gte: desde(JANELA_DIAS.d30) } },
      _sum: { quantidade: true },
    }),
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { status: { not: "Cancelada" }, storeId: { in: lojaIds }, cod: { in: cods }, saleDate: { gte: desde(JANELA_DIAS.d60) } },
      _sum: { quantidade: true },
    }),
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { status: { not: "Cancelada" }, storeId: { in: lojaIds }, cod: { in: cods }, saleDate: { gte: desde(JANELA_DIAS.d90) } },
      _sum: { quantidade: true },
    }),
    prisma.stockMinimumRule.findMany(),
  ]);

  const key = (storeId: string, cod: string) => `${storeId}::${cod}`;
  const v30 = new Map(vendas30.map((v) => [key(v.storeId, v.cod), v._sum.quantidade ?? 0]));
  const v60 = new Map(vendas60.map((v) => [key(v.storeId, v.cod), v._sum.quantidade ?? 0]));
  const v90 = new Map(vendas90.map((v) => [key(v.storeId, v.cod), v._sum.quantidade ?? 0]));
  const estoquePorChave = new Map(stockRows.map((s) => [key(s.storeId, s.cod), s]));

  const resultado: ComparacaoVariante[] = [];
  for (const cod of cods) {
    const meta = metaPorCod.get(cod)!;
    const porLoja: VariantePorLoja[] = lojas.map((loja) => {
      const s = estoquePorChave.get(key(loja.id, cod));
      const estoqueAtual = s?.quantidadeDisponivel ?? 0;
      const vendasDias30 = v30.get(key(loja.id, cod)) ?? 0;
      const vendasDias60 = v60.get(key(loja.id, cod)) ?? 0;
      const vendasDias90 = v90.get(key(loja.id, cod)) ?? 0;
      const velocidadeDiaria = vendasDias30 > 0 ? vendasDias30 / 30 : vendasDias90 / 90;
      const coberturaDias = velocidadeDiaria > 0 ? Math.round((estoqueAtual / velocidadeDiaria) * 10) / 10 : null;
      const estoqueMinimo =
        matchMinimumRule(minimumRules, { storeId: loja.id, grupo: meta.grupo, tamanho: meta.tamanho, colecao: meta.colecao }) ??
        s?.estoqueMinimo ??
        null;
      const diagnostico = diagnosticarVariante({ estoqueAtual, vendasDias30, vendasDias90, velocidadeDiaria, coberturaDias });
      return {
        storeId: loja.id,
        storeCode: loja.code,
        storeName: loja.name,
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

    resultado.push({ cod, produto: meta.produto, grupo: meta.grupo, cor: meta.cor, tamanho: meta.tamanho, colecao: meta.colecao, porLoja });
  }

  return resultado.sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR") || (a.tamanho ?? "").localeCompare(b.tamanho ?? "", "pt-BR"));
}

export async function getComparacaoEntreLojas(filters: ComparacaoFiltro = {}): Promise<ComparacaoVariante[]> {
  return montarComparacao(filters);
}

const COBERTURA_ALVO_PADRAO_DIAS = 30;

export async function getOportunidadesTransferencia(
  filters: ComparacaoFiltro = {},
  coberturaAlvoDias = COBERTURA_ALVO_PADRAO_DIAS
): Promise<OportunidadeTransferencia[]> {
  const comparacoes = await montarComparacao(filters);
  const oportunidades: OportunidadeTransferencia[] = [];
  for (const c of comparacoes) {
    oportunidades.push(
      ...calcularOportunidadeTransferencia(c.porLoja, {
        cod: c.cod,
        produto: c.produto,
        grupo: c.grupo,
        cor: c.cor,
        tamanho: c.tamanho,
        coberturaAlvoDias,
      })
    );
  }
  return oportunidades.sort((a, b) => b.quantidadeSugerida - a.quantidadeSugerida);
}
