"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PossibilidadeReposicao, StatusComercialProduto, TipoCompraProduto } from "@prisma/client";
import {
  upsertClassificacaoProduto,
  setParametrosBestSellerGrupo,
  setOrcamentoTotalPlanejado,
  registrarDecisaoCompra,
  atualizarEstoqueMinimoManual,
} from "@/lib/metrics";

// Mesma regra de permissão de updateCoberturaMetaAction/updateCrescimentoAction em actions.ts —
// classificar um produto como Best Seller/Drop e aprovar quantidade de compra são decisões de
// gestão, não de vendedor.
async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
  return user;
}

function parseDate(v: FormDataEntryValue | null): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseFloatOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Classificar/reclassificar um produto+cor como BEST_SELLER ou DROP (seção 2 e 3 do pedido) —
// nunca automático, sempre uma ação explícita confirmada por quem tem permissão de gestão.
// Grão ALTERADO em 2026-11-19: o formulário continua submetendo UM cod (fila de revisão é por
// SKU — ver ClassificarProdutoForm), mas a classificação é gravada por produto+cor
// (ClassificacaoProduto não é mais por `cod`), então TODOS os outros tamanhos da mesma cor
// recebem automaticamente a mesma classificação — efeito pretendido, não um bug. `cor` nunca vem
// do formulário: é sempre resolvida contra Sale/StockSnapshot (mesma fonte real já usada em
// classificarProdutoEmLoteAction), pra nunca confiar num campo oculto adulterável. Produto/grupo
// também são confirmados contra essa fonte — se o cod não existir em Sale/StockSnapshot, ou se
// produto/grupo do formulário não baterem com os reais, nada é gravado.
export async function classificarProdutoAction(formData: FormData) {
  const user = await requireGestao();

  const cod = String(formData.get("cod") ?? "").trim();
  const produto = String(formData.get("produto") ?? "").trim();
  const grupo = String(formData.get("grupo") ?? "").trim();
  if (!cod || !produto || !grupo) return;

  const tipoCompra = String(formData.get("tipoCompra") ?? "") as TipoCompraProduto;
  const statusComercial = String(formData.get("statusComercial") ?? "") as StatusComercialProduto;
  const possibilidadeReposicao = String(formData.get("possibilidadeReposicao") ?? "") as PossibilidadeReposicao;
  if (
    !Object.values(TipoCompraProduto).includes(tipoCompra) ||
    !Object.values(StatusComercialProduto).includes(statusComercial) ||
    !Object.values(PossibilidadeReposicao).includes(possibilidadeReposicao)
  ) {
    return;
  }

  const [vendas, estoque] = await Promise.all([
    prisma.sale.findMany({ where: { cod }, distinct: ["cod"], select: { produto: true, grupo: true, cor: true } }),
    prisma.stockSnapshot.findMany({ where: { cod }, distinct: ["cod"], select: { produto: true, grupo: true, cor: true } }),
  ]);
  const real = vendas[0] ?? estoque[0];
  if (!real || real.produto !== produto || real.grupo !== grupo) return; // cod inexistente ou produto/grupo do formulário não bate com a fonte real

  await upsertClassificacaoProduto(
    {
      produto,
      cor: real.cor ?? "",
      grupo,
      colecao: (formData.get("colecao") as string) || null,
      tipoCompra,
      statusComercial,
      possibilidadeReposicao,
      dataLancamento: parseDate(formData.get("dataLancamento")),
      dataEncerramentoPrevista: parseDate(formData.get("dataEncerramentoPrevista")),
      orcamentoDrop: parseFloatOrNull(formData.get("orcamentoDrop")),
      observacoes: (formData.get("observacoes") as string) || null,
    },
    user.email
  );

  revalidatePath("/dashboard/mapa-compras");
  revalidatePath("/dashboard/planejamento-estoque");
}

// Fase 2 do Planejamento de Estoque (2026-11-16) — resolve o gargalo real encontrado na Fase 1
// (354 de 360 produtos sem classificação): a fila de revisão é por COD (SKU individual, cor+
// tamanho), então classificar 1 produto com várias cores/tamanhos exigia 1 submit por SKU. Essa
// ação classifica TODOS os cods de um produto de uma vez, com a MESMA classificação escolhida —
// continua 100% manual (quem decide tipoCompra/status é sempre uma pessoa), só deixa de exigir
// repetir o clique por SKU.
//
// Grão ALTERADO em 2026-11-19: ClassificacaoProduto passou a ser por produto+cor, não mais por
// `cod` — então aqui, em vez de 1 upsert por cod (que gravaria N linhas idênticas pros tamanhos
// de uma mesma cor), agrupamos os cods válidos por cor real e fazemos 1 upsert por cor distinta.
// Se o produto submetido tiver 2 cores, isso grava 2 linhas (ambas com a MESMA decisão deste
// formulário — é um override explícito e intencional de "classifique as duas cores assim",
// continua permitindo que, depois, alguém reclassifique uma cor individualmente via
// ClassificarProdutoForm sem afetar a outra).
export async function classificarProdutoEmLoteAction(formData: FormData) {
  const user = await requireGestao();

  // Dedup (o mesmo cod pode aparecer 2x se o form for reenviado) — nunca confia na lista crua
  // de `cod` vinda dos campos ocultos como prova de que aquele SKU pertence ao produto
  // informado: campo oculto pode ser adulterado no cliente (DevTools, requisição manual), e sem
  // essa checagem um cod de OUTRO produto classificaria errado (sobrescreveria produto/grupo/
  // tipoCompra daquele SKU com os valores deste formulário). A fonte de verdade de "a quem esse
  // cod pertence" é Sale/StockSnapshot — nunca o formulário.
  const codsBrutos = [...new Set(formData.getAll("cod").map((v) => String(v).trim()).filter(Boolean))];
  const produto = String(formData.get("produto") ?? "").trim();
  if (codsBrutos.length === 0 || !produto) return;

  const tipoCompra = String(formData.get("tipoCompra") ?? "") as TipoCompraProduto;
  const statusComercial = String(formData.get("statusComercial") ?? "") as StatusComercialProduto;
  const possibilidadeReposicao = String(formData.get("possibilidadeReposicao") ?? "") as PossibilidadeReposicao;
  if (
    !Object.values(TipoCompraProduto).includes(tipoCompra) ||
    !Object.values(StatusComercialProduto).includes(statusComercial) ||
    !Object.values(PossibilidadeReposicao).includes(possibilidadeReposicao)
  ) {
    return;
  }

  // Confere cada cod contra a fonte real (Sale + StockSnapshot, mesmo universo de
  // getFilaRevisaoClassificacao) — pega produto/grupo/cor REAIS daquele cod, nunca os do
  // formulário. cod inexistente (não vendeu nem tem estoque) não aparece aqui nenhum dos dois
  // lados, então cai fora de `donoRealPorCod` e é rejeitado pela comparação abaixo igual a um
  // cod de outro produto — mesmo tratamento, mesma razão (não há base real pra classificar).
  const [vendas, estoque] = await Promise.all([
    prisma.sale.findMany({ where: { cod: { in: codsBrutos } }, distinct: ["cod"], select: { cod: true, produto: true, grupo: true, cor: true } }),
    prisma.stockSnapshot.findMany({ where: { cod: { in: codsBrutos } }, distinct: ["cod"], select: { cod: true, produto: true, grupo: true, cor: true } }),
  ]);
  const donoRealPorCod = new Map<string, { produto: string; grupo: string; cor: string }>();
  for (const r of [...vendas, ...estoque]) {
    if (!donoRealPorCod.has(r.cod)) donoRealPorCod.set(r.cod, { produto: r.produto, grupo: r.grupo, cor: r.cor ?? "" });
  }

  const codsValidos = codsBrutos.filter((cod) => donoRealPorCod.get(cod)?.produto === produto);
  if (codsValidos.length === 0) return; // nenhum cod submetido realmente pertence a este produto — nada é gravado

  const colecao = (formData.get("colecao") as string) || null;
  const dataLancamento = parseDate(formData.get("dataLancamento"));
  const dataEncerramentoPrevista = parseDate(formData.get("dataEncerramentoPrevista"));
  const orcamentoDrop = parseFloatOrNull(formData.get("orcamentoDrop"));
  const observacoes = (formData.get("observacoes") as string) || null;

  // Agrupa por cor real (produto já é fixo aqui) — 1 upsert por cor distinta entre os cods
  // válidos, nunca 1 por cod (grão de ClassificacaoProduto é produto+cor desde 2026-11-19).
  const coresPorGrupo = new Map<string, { grupo: string; cor: string }>();
  for (const cod of codsValidos) {
    const real = donoRealPorCod.get(cod)!;
    coresPorGrupo.set(real.cor, { grupo: real.grupo, cor: real.cor });
  }

  // Sequencial, não Promise.all: cada chamada já faz leitura+escrita+histórico (ver
  // upsertClassificacaoProduto) — paralelizar N upserts na mesma transação implícita de
  // histórico arriscaria condição de corrida sem ganho real (N é sempre pequeno, cores de 1
  // produto só).
  for (const { grupo, cor } of coresPorGrupo.values()) {
    await upsertClassificacaoProduto(
      { produto, cor, grupo, colecao, tipoCompra, statusComercial, possibilidadeReposicao, dataLancamento, dataEncerramentoPrevista, orcamentoDrop, observacoes },
      user.email
    );
  }

  revalidatePath("/dashboard/mapa-compras");
  revalidatePath("/dashboard/planejamento-estoque");
}

export async function setParametrosBestSellerGrupoAction(formData: FormData) {
  await requireGestao();

  const grupo = String(formData.get("grupo") ?? "").trim();
  if (!grupo) return;

  await setParametrosBestSellerGrupo(grupo, {
    estoqueSegurancaUnidades: parseFloatOrNull(formData.get("estoqueSegurancaUnidades")),
    leadTimeDias: parseFloatOrNull(formData.get("leadTimeDias")),
  });

  revalidatePath("/dashboard/mapa-compras");
}

export async function setOrcamentoTotalPlanejadoAction(formData: FormData) {
  await requireGestao();

  await setOrcamentoTotalPlanejado(parseFloatOrNull(formData.get("orcamentoTotalPlanejado")));

  revalidatePath("/dashboard/mapa-compras");
}

// Grava a decisão humana sobre uma recomendação (seção 9) — a simulação em tela não chama esta
// action, só a confirmação final chama.
export async function confirmarDecisaoCompraAction(formData: FormData) {
  const user = await requireGestao();

  const grupo = String(formData.get("grupo") ?? "").trim();
  const tipoCompra = String(formData.get("tipoCompra") ?? "") as TipoCompraProduto;
  const quantidadeSugerida = Number(formData.get("quantidadeSugerida"));
  const quantidadeAprovada = Number(formData.get("quantidadeAprovada"));
  const premissasRaw = String(formData.get("premissas") ?? "{}");
  if (!grupo || !Object.values(TipoCompraProduto).includes(tipoCompra)) return;
  if (!Number.isFinite(quantidadeSugerida) || !Number.isFinite(quantidadeAprovada)) return;

  let premissas: unknown;
  try {
    premissas = JSON.parse(premissasRaw);
  } catch {
    premissas = { raw: premissasRaw };
  }

  await registrarDecisaoCompra({
    cod: (formData.get("cod") as string) || undefined,
    grupo,
    tipoCompra,
    quantidadeSugerida,
    quantidadeAprovada,
    justificativaAjuste: (formData.get("justificativaAjuste") as string) || undefined,
    premissas,
    decididoPor: user.email ?? undefined,
  });

  revalidatePath("/dashboard/mapa-compras");
}

// Ajuste leve do mínimo empresarial por cod (docs/planejamento-inteligente-estoque.md §19) — caso
// mais comum: ajustar SÓ o mínimo depois da classificação inicial, sem reclassificar o produto.
// Mesma régua de permissão das demais actions deste arquivo (gestão, não vendedor). Campo vazio
// limpa o mínimo (volta a SEM_MINIMO_DEFINIDO), nunca grava 0 por omissão.
export async function atualizarEstoqueMinimoManualAction(formData: FormData) {
  const user = await requireGestao();

  const cod = String(formData.get("cod") ?? "").trim();
  if (!cod) return;

  const valor = parseIntOrNull(formData.get("valor"));
  await atualizarEstoqueMinimoManual(cod, valor, user.email ?? undefined);

  revalidatePath("/dashboard/estoque-minimo-manual");
}
