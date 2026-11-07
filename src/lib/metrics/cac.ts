// CAC (Custo de Aquisição de Cliente) — módulo novo (missão Black Friday, 2026-11-05). Escopo
// INEGOCIÁVEL: e-commerce apenas. Nunca calcula CAC de loja física (Leblon/Rio Sul/Barra) nem de
// atacado — ver RESUMO DE CONFIABILIDADE no fim do arquivo antes de consumir isto em qualquer UI.
//
// E-commerce = Store com code="CD" (dapicArmazenadorId=3), SEMPRE por storeId específico dessa
// loja — nunca por displayGroup ("TVB Site e Atacado" agrupa CD + ATACADO só pra exibição no
// FilterBar; são Store distintos com storeId diferente). ATACADO (dapicArmazenadorId=14) e as
// lojas físicas nunca entram no denominador nem no numerador de CAC.
//
// Caveat de dado histórico (ver comentário de getSiteAtacadoStoreIds em metrics/core.ts): antes de
// 2026-09-23 o sync gravava venda de atacado (faturas) e venda de site juntas na loja CD; só depois
// disso elas passaram a ser separadas de verdade. Período anterior a essa data pode ter alguma
// venda de atacado "vazada" dentro de CD — não corrigimos isso aqui (seria uma heurística nova,
// fora do pedido), só documentamos.
import { prisma } from "@/lib/prisma";
import { saleWhere, type DashboardFilters } from "./core";
import { getPrimeiraCompraGlobalPorCliente } from "./clientes";
import { getInsightsPorConjunto, getGastoDiarioConta } from "@/lib/connectors/meta-ads";
import { todayBrasiliaStr, brasiliaDayStart, brasiliaDayEnd } from "@/lib/filters";

// ===== Identificação do Store "CD" (e-commerce) =====

export async function getEcommerceStoreId(): Promise<string | null> {
  const cd = await prisma.store.findFirst({ where: { code: "CD" } });
  return cd?.id ?? null;
}

// ===== Investimento em aquisição (Meta Ads) =====

// Soma o gasto de TODOS os conjuntos de anúncio no período — é o investimento bruto em mídia,
// sem nenhum recorte por canal (o Meta Ads da TVB hoje roda só pra site/e-commerce, mas essa
// função não tem como confirmar isso por conta própria — ver motivoLimitacao em getCacEcommerce).
// Lança a mesma exceção de getInsightsPorConjunto quando faltam as credenciais (META_AD_ACCOUNT_ID/
// META_ACCESS_TOKEN) — quem chama decide se trata como erro fatal ou fallback (getCacEcommerce
// trata como fallback, ver lá).
export async function getInvestimentoAquisicao(from: Date, to: Date): Promise<number> {
  const since = todayBrasiliaStr(from);
  const until = todayBrasiliaStr(to);
  const insights = await getInsightsPorConjunto({ since, until });
  let total = 0;
  for (const insight of insights.values()) total += insight.gasto;
  return total;
}

// Mesma ideia, mas por dia — pedido do Rodrigo em 2026-11-07 ("o cac diario eu quero em
// grafico"), consumido por getCacDiarioBlackFriday (black-friday.ts). Mapa "YYYY-MM-DD" -> gasto
// daquele dia (fuso da conta de anúncios no Meta, ver comentário de getGastoDiarioConta). Lança a
// mesma exceção de getGastoDiarioConta quando faltam as credenciais — quem chama decide o
// fallback (getCacDiarioBlackFriday trata como "investimento indisponível pra toda a janela",
// nunca fabrica um número).
export async function getInvestimentoDiarioAquisicao(from: Date, to: Date): Promise<Map<string, number>> {
  const since = todayBrasiliaStr(from);
  const until = todayBrasiliaStr(to);
  return getGastoDiarioConta(since, until);
}

// ===== Novos compradores do e-commerce (denominador do CAC) =====

export type NovosCompradoresEcommerce = {
  novos: number;
  recorrentes: number;
  // Quantos dos clientes contados teriam o resultado de novo/recorrente ao menos
  // estruturalmente verificável contra ClienteCadastro (bateu por nome normalizado) — não é uma
  // confirmação de identidade (CPF/e-mail/dapicId), só sinaliza se EXISTE algum registro de
  // cadastro pra aquele nome. Ver getHomonimosNosNovos para o sinal de risco mais direto.
  semCadastroVinculado: number;
  // Nomes normalizados (trim+upper) dentre os "novos" que batem com MAIS DE UM dapicId distinto em
  // ClienteCadastro — homônimo de verdade (duas pessoas físicas/jurídicas diferentes compartilhando
  // o mesmo nome digitado no DAPIC). Cada ocorrência aqui é um "novo" que pode estar errado: a
  // primeira compra pode ter sido da OUTRA pessoa com o mesmo nome, não da que comprou agora.
  homonimosDetectados: number;
};

// Clientes que compraram no e-commerce (storeId=CD) dentro do período E cuja 1ª compra GLOBAL
// (empresa inteira — qualquer loja física, atacado, ou histórico pré-DAPIC via
// ClienteCadastro.primeiraCompraExterna) caiu dentro desse mesmo período. Deliberadamente NÃO usa
// getNovosERecorrentesClientes(filters) com storeIds=[cdStoreId] porque aquela função, quando
// recebe storeIds, restringe TAMBÉM a busca da 1ª compra a essas lojas (ver comentário em
// getPrimeiraCompraGlobalPorCliente) — ótimo pra "respeitar a permissão do usuário" na Visão
// Geral, mas errado pra CAC: um cliente que já comprava na Leblon há anos e agora fez a 1ª compra
// NO SITE não foi "adquirido" pelo Meta Ads, só migrou de canal. Usar a 1ª compra restrita a CD
// inflaria o número de "novos" e, com isso, SUBESTIMARIA o CAC real.
async function getNovosCompradoresEcommerce(
  cdStoreId: string,
  from: Date,
  to: Date
): Promise<NovosCompradoresEcommerce> {
  const filters: DashboardFilters = { from, to, storeIds: [cdStoreId] };
  const where = { ...saleWhere(filters), clienteNome: { not: null } };
  const compradoresNoPeriodo = await prisma.sale.groupBy({ by: ["clienteNome"], where });
  const normSet = new Set(
    compradoresNoPeriodo.map((c) => (c.clienteNome as string).trim().toUpperCase())
  );
  if (normSet.size === 0) {
    return { novos: 0, recorrentes: 0, semCadastroVinculado: 0, homonimosDetectados: 0 };
  }

  // SEM storeIds aqui — de propósito, é a 1ª compra da empresa inteira (ver comentário acima).
  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...normSet]);

  let novos = 0;
  let recorrentes = 0;
  const nomesNovos: string[] = [];
  for (const norm of normSet) {
    const first = primeiraGlobal.get(norm);
    if (!first) continue;
    if (first >= from && first <= to) {
      novos++;
      nomesNovos.push(norm);
    } else if (first < from) {
      recorrentes++;
    }
  }

  if (nomesNovos.length === 0) {
    return { novos, recorrentes, semCadastroVinculado: 0, homonimosDetectados: 0 };
  }

  // Sinal de risco de identidade: quantos "novos" não têm NENHUM ClienteCadastro casando pelo
  // nome (identidade nunca verificada por CPF/e-mail/dapicId — é pura string) e quantos batem com
  // MAIS DE UM dapicId (homônimo real, risco concreto de 1ª compra errada).
  const cadastroRows = await prisma.$queryRaw<{ norm: string; dapicId: number }[]>`
    SELECT UPPER(TRIM("nome")) AS norm, "dapicId"
    FROM "ClienteCadastro"
    WHERE UPPER(TRIM("nome")) = ANY(${nomesNovos})
  `;
  const dapicIdsPorNome = new Map<string, Set<number>>();
  for (const r of cadastroRows) {
    const set = dapicIdsPorNome.get(r.norm) ?? new Set<number>();
    set.add(r.dapicId);
    dapicIdsPorNome.set(r.norm, set);
  }
  let semCadastroVinculado = 0;
  let homonimosDetectados = 0;
  for (const norm of nomesNovos) {
    const ids = dapicIdsPorNome.get(norm);
    if (!ids || ids.size === 0) semCadastroVinculado++;
    else if (ids.size > 1) homonimosDetectados++;
  }

  return { novos, recorrentes, semCadastroVinculado, homonimosDetectados };
}

// ===== Novos compradores do e-commerce, por DIA (gráfico "CAC diário") =====
//
// Pedido do Rodrigo em 2026-11-07: "o cac diario eu quero em grafico" — versão diária de
// getNovosCompradoresEcommerce acima, consumida por getCacDiarioBlackFriday (black-friday.ts).
// Diferença deliberada em relação à versão de período: usa o vínculo REAL Sale.clienteCadastroId
// (PR #65, cliente-cadastro-link.ts) em vez de casar só por clienteNome normalizado — tanto
// confiança ID (fatura.IdCliente, e-commerce) quanto NOME (nome normalizado batendo com
// EXATAMENTE 1 ClienteCadastro, já sem ambiguidade de homônimo porque resolverClienteCadastro
// nunca resolve um nome com mais de 1 candidato) são mais seguras que repetir o casamento por
// string cru feito pela versão de período. Venda com clienteCadastroId null (nunca resolvido —
// nem por ID nem por NOME) NUNCA é classificada como novo/recorrente aqui: entra em
// "naoIdentificados" (contado por nome normalizado, só pra não desaparecer do total do dia, nunca
// usado pra decidir novo/recorrente) — mesma convenção de honestidade de getVendasPorFaixaDesconto
// ("sem desconto cadastrado")/getVendasPorEstadoEcommerce ("semEstado") em black-friday.ts: nunca
// esconde, nunca chuta.
export type NovosClientesDiarioDia = {
  novos: number;
  recorrentes: number;
  naoIdentificados: number;
};

export async function getNovosClientesDiarioEcommerce(
  cdStoreId: string,
  from: Date,
  to: Date
): Promise<Map<string, NovosClientesDiarioDia>> {
  // Mesmo truncamento de dia (fuso Brasília) já usado em getSalesByDay (vendas.ts) — GROUP BY já
  // devolve 1 linha por combinação (dia, clienteCadastroId, clienteNome) distinta, então o loop em
  // JS abaixo só precisa deduplicar por dia (um cliente com 2 vendas no mesmo dia conta 1 vez).
  const rows = await prisma.$queryRaw<{ day: Date; clienteCadastroId: string | null; clienteNome: string | null }[]>`
    SELECT
      (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      "clienteCadastroId",
      "clienteNome"
    FROM "Sale"
    WHERE "status" != 'Cancelada'
      AND "storeId" = ${cdStoreId}
      AND "saleDate" >= ${from}
      AND "saleDate" <= ${to}
    GROUP BY day, "clienteCadastroId", "clienteNome"
  `;
  if (rows.length === 0) return new Map();

  const idsPorDia = new Map<string, Set<string>>();
  const naoIdentificadosPorDia = new Map<string, Set<string>>();
  const todosIds = new Set<string>();

  for (const r of rows) {
    const day = new Date(r.day).toISOString().slice(0, 10);
    if (r.clienteCadastroId) {
      todosIds.add(r.clienteCadastroId);
      const set = idsPorDia.get(day) ?? new Set<string>();
      set.add(r.clienteCadastroId);
      idsPorDia.set(day, set);
    } else if (r.clienteNome) {
      // Sem clienteCadastroId resolvido — não dá pra classificar novo/recorrente com segurança
      // (é exatamente a fragilidade que a PR #65 resolveu pra quem TEM o vínculo). Deduplicado só
      // por nome normalizado, melhor esforço, só pra contagem de "naoIdentificados" do dia.
      const norm = r.clienteNome.trim().toUpperCase();
      const set = naoIdentificadosPorDia.get(day) ?? new Set<string>();
      set.add(norm);
      naoIdentificadosPorDia.set(day, set);
    }
    // Sem clienteCadastroId E sem clienteNome: não há nenhuma identidade (nem fraca) pra contar
    // como "um comprador" — fica de fora de todos os três buckets, de propósito.
  }

  const result = new Map<string, NovosClientesDiarioDia>();
  if (todosIds.size === 0) {
    for (const [day, nomes] of naoIdentificadosPorDia) {
      result.set(day, { novos: 0, recorrentes: 0, naoIdentificados: nomes.size });
    }
    return result;
  }

  // 1ª compra GLOBAL por clienteCadastroId — qualquer loja/canal da empresa, SEM restrição de
  // storeId (mesmo racional de getPrimeiraCompraGlobalPorCliente/getNovosCompradoresEcommerce:
  // comprador que já comprava na Leblon antes não é "novo" só porque essa foi a 1ª compra dele NO
  // SITE). Inclui ClienteCadastro.primeiraCompraExterna (site antigo pré-DAPIC) pelo mesmo motivo
  // que getPrimeiraCompraGlobalPorCliente inclui.
  const idsArray = [...todosIds];
  const [primeiraPorSale, externaRows] = await Promise.all([
    prisma.$queryRaw<{ clienteCadastroId: string; first: Date }[]>`
      SELECT "clienteCadastroId", MIN("saleDate") AS first
      FROM "Sale"
      WHERE "status" != 'Cancelada' AND "clienteCadastroId" = ANY(${idsArray})
      GROUP BY "clienteCadastroId"
    `,
    prisma.$queryRaw<{ id: string; first: Date }[]>`
      SELECT "id", "primeiraCompraExterna" AS first
      FROM "ClienteCadastro"
      WHERE "id" = ANY(${idsArray}) AND "primeiraCompraExterna" IS NOT NULL
    `,
  ]);

  const primeiraGlobalPorId = new Map<string, Date>();
  for (const r of primeiraPorSale) primeiraGlobalPorId.set(r.clienteCadastroId, new Date(r.first));
  for (const r of externaRows) {
    const d = new Date(r.first);
    const cur = primeiraGlobalPorId.get(r.id);
    if (!cur || d < cur) primeiraGlobalPorId.set(r.id, d);
  }

  const todosDias = new Set([...idsPorDia.keys(), ...naoIdentificadosPorDia.keys()]);
  for (const day of todosDias) {
    const dayStart = brasiliaDayStart(day);
    const dayEnd = brasiliaDayEnd(day);
    let novos = 0;
    let recorrentes = 0;
    for (const id of idsPorDia.get(day) ?? []) {
      const first = primeiraGlobalPorId.get(id);
      // Defensivo: todo id em idsPorDia comprou nesse dia (status != Cancelada), logo tem pelo
      // menos essa venda em primeiraPorSale — "first" faltando não deveria acontecer na prática.
      if (!first) continue;
      if (first >= dayStart && first <= dayEnd) novos++;
      else recorrentes++;
    }
    result.set(day, { novos, recorrentes, naoIdentificados: naoIdentificadosPorDia.get(day)?.size ?? 0 });
  }
  return result;
}

// ===== CAC consolidado do período =====

export type CacResultado = {
  from: Date;
  to: Date;
  investimento: number;
  investimentoIndisponivel: boolean;
  novosCompradores: number;
  recorrentes: number;
  cac: number | null;
  participacaoNovosPct: number | null;
  participacaoRecorrentesPct: number | null;
  // false sempre que a identificação de "novo comprador" não puder ser considerada segura —
  // ver motivoLimitacao pro detalhe exato de por quê. Nunca true só porque não detectamos homônimo
  // NESTE período específico (ausência de homônimo detectado não é prova de identidade correta,
  // é só ausência de colisão de nome dentro da amostra atual).
  confiavel: boolean;
  motivoLimitacao: string;
  homonimosDetectados: number;
  semCadastroVinculado: number;
};

// Monta a frase de limitação de forma determinística — sempre a mesma explicação estrutural, mais
// o achado específico do período quando há homônimo detectado ou falta de investimento.
function montarMotivoLimitacao(params: {
  homonimosDetectados: number;
  semCadastroVinculado: number;
  investimentoIndisponivel: boolean;
}): string {
  const partes: string[] = [
    "Identificação de cliente novo/recorrente usa Sale.clienteNome (texto livre, sem foreign key " +
      "pra ClienteCadastro) casado por nome normalizado (trim+upper) — não por CPF, e-mail ou " +
      "dapicId. Dois clientes reais com o mesmo nome no DAPIC são tratados como 1 só, o que pode " +
      "atribuir a 1ª compra de um deles ao outro (falso 'novo' ou falso 'recorrente').",
  ];
  if (params.homonimosDetectados > 0) {
    partes.push(
      `Neste período, ${params.homonimosDetectados} comprador(es) classificado(s) como 'novo' ` +
        "bate(m) com mais de um cadastro (dapicId) distinto em ClienteCadastro — homônimo real " +
        "confirmado, não só risco teórico."
    );
  }
  if (params.semCadastroVinculado > 0) {
    partes.push(
      `${params.semCadastroVinculado} comprador(es) 'novo(s)' não têm nenhum ClienteCadastro ` +
        "vinculável pelo nome — identidade nunca verificada por CPF/e-mail, só o nome da venda."
    );
  }
  if (params.investimentoIndisponivel) {
    partes.push(
      "Investimento em mídia não pôde ser obtido nesta chamada (Meta Ads indisponível ou " +
        "credenciais ausentes) — CAC não pode ser calculado para o período."
    );
  }
  partes.push(
    "Faltaria, pro cálculo ficar seguro: um vínculo real em Sale pro ClienteCadastro (ex: coluna " +
      "clienteCadastroId, resolvida no sync por CPF/e-mail, não por nome) — proposta de schema, " +
      "não aplicada aqui (fora do escopo desta tarefa)."
  );
  return partes.join(" ");
}

export async function getCacEcommerce(from: Date, to: Date): Promise<CacResultado> {
  const cdStoreId = await getEcommerceStoreId();
  if (!cdStoreId) {
    return {
      from,
      to,
      investimento: 0,
      investimentoIndisponivel: true,
      novosCompradores: 0,
      recorrentes: 0,
      cac: null,
      participacaoNovosPct: null,
      participacaoRecorrentesPct: null,
      confiavel: false,
      motivoLimitacao: "Store com code=\"CD\" (e-commerce) não encontrado no banco — sync de lojas nunca rodou ou cadastro foi alterado.",
      homonimosDetectados: 0,
      semCadastroVinculado: 0,
    };
  }

  const [compradores, investimentoResult] = await Promise.all([
    getNovosCompradoresEcommerce(cdStoreId, from, to),
    getInvestimentoAquisicao(from, to).then(
      (valor) => ({ valor, indisponivel: false }),
      () => ({ valor: 0, indisponivel: true })
    ),
  ]);

  const { novos, recorrentes, semCadastroVinculado, homonimosDetectados } = compradores;
  const totalClientes = novos + recorrentes;
  const cac = !investimentoResult.indisponivel && novos > 0 ? investimentoResult.valor / novos : null;

  return {
    from,
    to,
    investimento: investimentoResult.valor,
    investimentoIndisponivel: investimentoResult.indisponivel,
    novosCompradores: novos,
    recorrentes,
    cac,
    participacaoNovosPct: totalClientes > 0 ? (novos / totalClientes) * 100 : null,
    participacaoRecorrentesPct: totalClientes > 0 ? (recorrentes / totalClientes) * 100 : null,
    // Estruturalmente nunca confiável 100% — ver montarMotivoLimitacao. Mantido como campo
    // explícito (em vez de omitir) pra quem consome isto na UI nunca apresentar o CAC como um
    // número definitivo sem o aviso ao lado.
    confiavel: false,
    motivoLimitacao: montarMotivoLimitacao({ homonimosDetectados, semCadastroVinculado, investimentoIndisponivel: investimentoResult.indisponivel }),
    homonimosDetectados,
    semCadastroVinculado,
  };
}

// ===== Evolução mensal =====

export type CacMensal = CacResultado & { mes: string };

function primeiroDiaDoMes(ano: number, mesIndex0: number): Date {
  return new Date(Date.UTC(ano, mesIndex0, 1, 3, 0, 0)); // 03:00 UTC ~ 00:00 Brasília
}

function ultimoInstanteDoMes(ano: number, mesIndex0: number): Date {
  return new Date(Date.UTC(ano, mesIndex0 + 1, 1, 2, 59, 59, 999));
}

// Um CacResultado por mês, do mês de `desde` (inclusive) até o mês de `ate` (inclusive) — pedido
// da missão de "evolução no tempo". Meses processados em sequência (não em paralelo) pra não
// disparar N chamadas simultâneas pro Meta Ads.
export async function getCacEvolucaoMensal(desde: Date, ate: Date): Promise<CacMensal[]> {
  const resultado: CacMensal[] = [];
  let ano = desde.getUTCFullYear();
  let mes = desde.getUTCMonth();
  const anoFim = ate.getUTCFullYear();
  const mesFim = ate.getUTCMonth();

  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const from = primeiroDiaDoMes(ano, mes);
    const to = ultimoInstanteDoMes(ano, mes);
    const cacDoMes = await getCacEcommerce(from, to);
    resultado.push({ ...cacDoMes, mes: `${ano}-${String(mes + 1).padStart(2, "0")}` });
    mes++;
    if (mes > 11) {
      mes = 0;
      ano++;
    }
  }
  return resultado;
}

// ===== CAC por campanha — EXPLICITAMENTE NÃO IMPLEMENTADO =====

export type CacPorCampanhaIndisponivel = {
  disponivel: false;
  motivo: string;
};

// Não existe hoje nenhuma ligação entre uma venda (Sale) e uma campanha/conjunto/anúncio
// específico do Meta Ads: getInsightsPorConjunto/getInsightsPorAnuncio (connectors/meta-ads.ts)
// devolvem gasto e "compras" chaveados por NOME de conjunto/anúncio — "compras" ali é a contagem
// que o PRÓPRIO Meta atribui via pixel, não reconciliada com Sale do DAPIC. Sale não grava
// utm_campaign/utm_content/click_id/ad_id — não tem como juntar uma linha de venda a uma campanha
// com confiança. Calcular "CAC por campanha" hoje seria inventar uma atribuição que o dado não
// sustenta (ex: dividir investimento do conjunto pelas "compras" que o Meta diz que teve, que são
// eventos de pixel — podem incluir compra de brinde, teste, carrinho abandonado recuperado por
// outro canal, etc). Por isso esta função só documenta a limitação, de propósito, em vez de
// calcular um número que pareceria preciso sem ser.
//
// Pra isso virar possível e seguro, falta: Sale gravar o parâmetro de atribuição do pedido (ex:
// utm_campaign/click_id capturado no checkout do site e salvo na venda) — mudança de schema fora
// do escopo desta tarefa, proposta aqui só como registro.
export function getCacPorCampanha(): CacPorCampanhaIndisponivel {
  return {
    disponivel: false,
    motivo:
      "Sale não tem utm_campaign/utm_content/click_id nem qualquer vínculo com conjunto/anúncio do " +
      "Meta Ads — getInsightsPorConjunto/getInsightsPorAnuncio são chaveados por nome, sem ligação " +
      "com Sale. 'compras' que o Meta reporta ali é contagem de pixel (não reconciliada com o " +
      "DAPIC), então dividir gasto por essas 'compras' não seria CAC real por campanha, só o número " +
      "que o próprio Meta já mostra no Gerenciador de Anúncios. Precisa de atribuição salva na venda " +
      "(ex: utm_campaign capturado no checkout) antes de calcular isso aqui.",
  };
}

/*
 * RESUMO DE CONFIABILIDADE (ler antes de consumir este módulo numa UI):
 *
 * 1. Denominador (novos compradores do e-commerce) é estruturalmente NÃO verificado por CPF/
 *    e-mail/dapicId — só nome normalizado. getCacEcommerce() sempre devolve confiavel=false com
 *    motivoLimitacao explicando o porquê, mais homonimosDetectados/semCadastroVinculado como sinal
 *    concreto do risco NESTE período específico (não é uma garantia pro período seguinte).
 * 2. CAC é sempre e-commerce (storeId do Store code="CD") — nunca loja física, nunca atacado
 *    (code="ATACADO"), nunca pelo displayGroup agrupado "TVB Site e Atacado".
 * 3. CAC por campanha/conjunto/anúncio não é calculado — ver getCacPorCampanha().
 * 4. Investimento é 100% Meta Ads (getInsightsPorConjunto) — não inclui Google Ads, influencer,
 *    SEO pago ou qualquer outro canal de aquisição que a TVB rode fora do Meta.
 */
