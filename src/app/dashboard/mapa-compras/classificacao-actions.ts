"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { PossibilidadeReposicao, StatusComercialProduto, TipoCompraProduto } from "@prisma/client";
import {
  upsertClassificacaoProduto,
  setParametrosBestSellerGrupo,
  setOrcamentoTotalPlanejado,
  registrarDecisaoCompra,
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

// Classificar/reclassificar um produto como BEST_SELLER ou DROP (seção 2 e 3 do pedido) — nunca
// automático, sempre uma ação explícita confirmada por quem tem permissão de gestão.
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

  await upsertClassificacaoProduto(
    {
      cod,
      produto,
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
