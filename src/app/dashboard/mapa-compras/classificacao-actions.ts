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

// Classificar/reclassificar um produto como BEST_SELLER ou DROP (seção 2 e 3 do pedido) — nunca
// automático, sempre uma ação explícita confirmada por quem tem permissão de gestão.
export async function classificarProdutoAction(formData: FormData) {
  const user = await requireGestao();

  const cod = String(formData.get("cod") ?? "").trim();
  const produto = String(formData.get("produto") ?? "").trim();
  const grupo = String(formData.get("grupo") ?? "").trim();
  // Única tela que usa esta action é a fila de revisão (alertas-view.tsx) — por definição só
  // lista cods SEM classificação ainda, então esta ação é sempre CRIAÇÃO de linha nova em
  // ClassificacaoProduto. Por isso dataLancamento é exigida aqui no mesmo nível dos outros
  // campos obrigatórios (decisão do Rodrigo 2026-11-19: obrigatória daqui pra frente, nunca
  // retroagindo aos ~2681 cods já classificados sem essa data — ver upsertClassificacaoProduto).
  const dataLancamento = parseDate(formData.get("dataLancamento"));
  if (!cod || !produto || !grupo || !dataLancamento) return;

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

  await upsertClassificacaoProduto(
    {
      cod,
      produto,
      grupo,
      colecao: (formData.get("colecao") as string) || null,
      tipoCompra,
      statusComercial,
      possibilidadeReposicao,
      dataLancamento,
      dataEncerramentoPrevista: parseDate(formData.get("dataEncerramentoPrevista")),
      orcamentoDrop: parseFloatOrNull(formData.get("orcamentoDrop")),
      observacoes: (formData.get("observacoes") as string) || null,
    },
    user.email
  );

  revalidatePath("/dashboard/mapa-compras");
}

// Fase 2 do Planejamento de Estoque (2026-11-16) — resolve o gargalo real encontrado na Fase 1
// (354 de 360 produtos sem classificação): a fila de revisão é por COD (SKU individual, cor+
// tamanho), então classificar 1 produto com várias cores/tamanhos exigia 1 submit por SKU. Essa
// ação classifica TODOS os cods de um produto de uma vez, com a MESMA classificação escolhida —
// continua 100% manual (quem decide tipoCompra/status é sempre uma pessoa), só deixa de exigir
// repetir o clique por SKU. Não muda a chave do schema (ClassificacaoProduto continua por cod)
// nem o critério de qualificação — só reduz o atrito operacional de aplicar a mesma decisão a
// todas as variantes de um produto.
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
  // getFilaRevisaoClassificacao) — pega produto/grupo REAIS daquele cod, nunca os do formulário.
  // cod inexistente (não vendeu nem tem estoque) não aparece aqui nenhum dos dois lados, então
  // cai fora de `donoRealPorCod` e é rejeitado pela comparação abaixo igual a um cod de outro
  // produto — mesmo tratamento, mesma razão (não há base real pra classificar).
  const [vendas, estoque] = await Promise.all([
    prisma.sale.findMany({ where: { cod: { in: codsBrutos } }, distinct: ["cod"], select: { cod: true, produto: true, grupo: true } }),
    prisma.stockSnapshot.findMany({ where: { cod: { in: codsBrutos } }, distinct: ["cod"], select: { cod: true, produto: true, grupo: true } }),
  ]);
  const donoRealPorCod = new Map<string, { produto: string; grupo: string }>();
  for (const r of [...vendas, ...estoque]) {
    if (!donoRealPorCod.has(r.cod)) donoRealPorCod.set(r.cod, { produto: r.produto, grupo: r.grupo });
  }

  const codsValidos = codsBrutos.filter((cod) => donoRealPorCod.get(cod)?.produto === produto);
  if (codsValidos.length === 0) return; // nenhum cod submetido realmente pertence a este produto — nada é gravado

  const colecao = (formData.get("colecao") as string) || null;
  const dataLancamento = parseDate(formData.get("dataLancamento"));
  const dataEncerramentoPrevista = parseDate(formData.get("dataEncerramentoPrevista"));
  const orcamentoDrop = parseFloatOrNull(formData.get("orcamentoDrop"));
  const observacoes = (formData.get("observacoes") as string) || null;

  // Decisão do Rodrigo (2026-11-19): dataLancamento obrigatória daqui pra frente, só pra
  // classificação NOVA — nunca retroagindo aos cods já classificados. Esta tela mistura os dois
  // casos num único submit (produto NAO_CLASSIFICADO = todos os cods são novos; MISTO = pode ter
  // cods já classificados com tipoCompra diferente E cods ainda sem nenhuma linha): por isso
  // confere contra o cadastro real quais de `codsValidos` JÁ têm ClassificacaoProduto — se
  // nenhum deles é novo, a decisão é só reclassificação (editar quem já existe) e dataLancamento
  // continua opcional; se há pelo menos 1 cod novo, exige a data pra TODO o lote (a UI sempre
  // envia todos os cods do produto de uma vez, não dá pra separar "só os novos" neste submit).
  const classificacoesExistentes = await prisma.classificacaoProduto.findMany({
    where: { cod: { in: codsValidos } },
    select: { cod: true },
  });
  const codsComClassificacaoExistente = new Set(classificacoesExistentes.map((c) => c.cod));
  const temCodNovo = codsValidos.some((cod) => !codsComClassificacaoExistente.has(cod));
  if (temCodNovo && !dataLancamento) return;

  // Sequencial, não Promise.all: cada chamada já faz leitura+escrita+histórico (ver
  // upsertClassificacaoProduto) — paralelizar N upserts na mesma transação implícita de
  // histórico arriscaria condição de corrida sem ganho real (N é sempre pequeno, cods de 1
  // produto só).
  for (const cod of codsValidos) {
    const grupoReal = donoRealPorCod.get(cod)!.grupo; // grupo vem da fonte real, não do formulário
    await upsertClassificacaoProduto(
      { cod, produto, grupo: grupoReal, colecao, tipoCompra, statusComercial, possibilidadeReposicao, dataLancamento, dataEncerramentoPrevista, orcamentoDrop, observacoes },
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
    leadTimeUrgenteDias: parseFloatOrNull(formData.get("leadTimeUrgenteDias")),
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
  // Reformulação do Planejamento de Estoque (2026-11-23, Aba "Reposição e Compras"): o mesmo
  // formulário (MinimoManualForm) passou a ser embutido também ali — revalida essa rota também,
  // nunca um action paralelo só pra esse novo ponto de uso.
  revalidatePath("/dashboard/planejamento-estoque");
}
