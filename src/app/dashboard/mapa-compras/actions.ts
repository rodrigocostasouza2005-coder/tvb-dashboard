"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  setCoberturaMeta,
  setCrescimentoEsperado,
  setCenarioAtivo,
  setCenarioPreset,
  setAjusteLoja,
  setAjusteGrupo,
  setAjusteMensal,
  type Cenario,
} from "@/lib/metrics";

// Cobertura e Crescimento alimentam a recomendação de quanto comprar pra empresa toda — só
// ADMIN/GESTAO pode mudar (mesmo padrão de estoque-minimo/actions.ts). Achado numa auditoria em
// 2026-09-08: antes só checava se tinha usuário logado, então qualquer VENDEDOR conseguia mudar.
async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
}

export async function updateCoberturaMetaAction(formData: FormData) {
  await requireGestao();

  const grupo = String(formData.get("grupo") ?? "");
  const meses = Number(formData.get("mesesCobertura"));
  if (!grupo || !Number.isFinite(meses) || meses <= 0) return;

  await setCoberturaMeta(grupo, meses);
  revalidatePath("/dashboard/mapa-compras");
}

export async function updateCrescimentoAction(formData: FormData) {
  await requireGestao();

  const crescimentoPct = Number(formData.get("crescimentoPct"));
  if (!Number.isFinite(crescimentoPct)) return;

  await setCrescimentoEsperado(crescimentoPct);
  revalidatePath("/dashboard/mapa-compras");
}

// --- Premissas de Crescimento (evolução do Mapa de Compras, 2026-11-27, seções 8-10) ---
// Mesmo padrão de permissão/revalidação das actions acima — só ADMIN/GESTAO edita, VENDEDOR vê
// read-only (ver canEdit em page.tsx).

const CENARIOS_VALIDOS: Cenario[] = ["conservador", "base", "agressivo"];
function parseCenario(valor: FormDataEntryValue | null): Cenario | null {
  return CENARIOS_VALIDOS.includes(valor as Cenario) ? (valor as Cenario) : null;
}

export async function setCenarioAtivoAction(formData: FormData) {
  await requireGestao();
  const cenario = parseCenario(formData.get("cenario"));
  if (!cenario) return;
  await setCenarioAtivo(cenario);
  revalidatePath("/dashboard/mapa-compras");
}

export async function setCenarioPresetAction(formData: FormData) {
  await requireGestao();
  const cenario = parseCenario(formData.get("cenario"));
  const pct = Number(formData.get("crescimentoPct"));
  if (!cenario || !Number.isFinite(pct)) return;
  await setCenarioPreset(cenario, pct);
  revalidatePath("/dashboard/mapa-compras");
}

export async function setAjusteLojaAction(formData: FormData) {
  await requireGestao();
  const posicaoId = String(formData.get("posicaoId") ?? "");
  const multiplicador = Number(formData.get("multiplicador"));
  if (!posicaoId || !Number.isFinite(multiplicador) || multiplicador < 0) return;
  await setAjusteLoja(posicaoId, multiplicador);
  revalidatePath("/dashboard/mapa-compras");
}

export async function setAjusteGrupoAction(formData: FormData) {
  await requireGestao();
  const grupo = String(formData.get("grupo") ?? "");
  const multiplicador = Number(formData.get("multiplicador"));
  if (!grupo || !Number.isFinite(multiplicador) || multiplicador < 0) return;
  await setAjusteGrupo(grupo, multiplicador);
  revalidatePath("/dashboard/mapa-compras");
}

export async function setAjusteMensalAction(formData: FormData) {
  await requireGestao();
  const mesCalendario = Number(formData.get("mesCalendario"));
  const ajustePontos = Number(formData.get("ajustePontos"));
  if (!Number.isInteger(mesCalendario) || mesCalendario < 1 || mesCalendario > 12 || !Number.isFinite(ajustePontos)) return;
  await setAjusteMensal(mesCalendario, ajustePontos);
  revalidatePath("/dashboard/mapa-compras");
}
