"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  registrarDecisaoMovimentacao,
  atualizarStatusMovimentacao,
  type RegistrarDecisaoMovimentacaoInput,
  type StatusMovimentacaoRegistro,
} from "@/lib/metrics";

// Decisão sobre recomendação de distribuição move estoque da empresa toda — só ADMIN/GESTAO,
// mesmo padrão de mapa-compras/actions.ts e estoque-minimo/actions.ts (a página também esconde os
// botões de quem não pode, mas a trava que vale é esta, no servidor).
async function requireGestao(): Promise<string> {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
  return user.email;
}

export type ResultadoDecisao = { ok: boolean; mensagem: string };

// Enquanto a migration 20261111160000_add_decisao_movimentacao_estoque não estiver aplicada no
// ambiente, a gravação falha com P2021 (tabela não existe). Em vez de estourar um erro bruto na
// tela, devolve uma mensagem que diz exatamente o que falta — foi uma decisão desta entrega gerar
// a migration e NÃO aplicá-la em produção.
function mensagemDeErro(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  if (/DecisaoMovimentacaoEstoque|does not exist|P2021|P2022/i.test(texto)) {
    return "Histórico indisponível: a migration DecisaoMovimentacaoEstoque ainda não foi aplicada neste ambiente.";
  }
  if (/Sem permissão/.test(texto)) return "Sem permissão pra registrar decisão.";
  return "Não foi possível registrar a decisão.";
}

export async function registrarDecisaoMovimentacaoAction(
  input: Omit<RegistrarDecisaoMovimentacaoInput, "responsavel">
): Promise<ResultadoDecisao> {
  try {
    const email = await requireGestao();
    await registrarDecisaoMovimentacao({ ...input, responsavel: email });
    revalidatePath("/dashboard/distribuicao-estoque");
    return { ok: true, mensagem: "Decisão registrada no histórico." };
  } catch (e) {
    return { ok: false, mensagem: mensagemDeErro(e) };
  }
}

export async function atualizarStatusMovimentacaoAction(formData: FormData): Promise<void> {
  const email = await requireGestao();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as StatusMovimentacaoRegistro;
  if (!id || !["PENDENTE", "APROVADA", "EXECUTADA", "RECUSADA"].includes(status)) return;

  const qtdRaw = formData.get("quantidade");
  const quantidade = qtdRaw != null && String(qtdRaw).trim() !== "" ? Number(qtdRaw) : null;

  await atualizarStatusMovimentacao({
    id,
    status,
    // "Executada" é a confirmação humana de que a peça foi MOVIDA de fato (o Radar nunca move
    // nada) — é aí que a quantidade executada passa a existir.
    ...(status === "EXECUTADA" ? { quantidadeExecutada: quantidade } : {}),
    ...(status === "APROVADA" ? { quantidadeAprovada: quantidade } : {}),
    responsavel: email,
  });
  revalidatePath("/dashboard/distribuicao-estoque");
}
