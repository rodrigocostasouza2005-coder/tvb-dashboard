"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
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
//
// IMPORTANTE (incidente real 2026-11-25 com ClassificacaoProduto.cod): P2021/P2022 é o código
// genérico do Prisma pra "tabela/coluna não existe" — pode vir de QUALQUER tabela, não só
// DecisaoMovimentacaoEstoque. O regex antigo (`does not exist|P2021|P2022` OR
// `DecisaoMovimentacaoEstoque`) tratava QUALQUER erro desse tipo, de qualquer tabela, como "esta
// migration pendente" — mascarando erros reais e completamente diferentes. Agora: (1) sempre loga
// o erro técnico real antes de decidir a mensagem; (2) só mostra "migration pendente" quando a
// mensagem de fato menciona a tabela conhecida.
const TABELA_CONHECIDA = "DecisaoMovimentacaoEstoque";

function mensagemDeErro(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  const codigo = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null;
  const ehErroDeEsquema = codigo === "P2021" || codigo === "P2022" || /P2021|P2022/.test(texto);

  if (ehErroDeEsquema) {
    // Sempre loga o erro técnico real (código Prisma + mensagem completa) antes de decidir qual
    // mensagem mostrar — nunca engolir em silêncio.
    console.error("[distribuicao-estoque/actions] Prisma", codigo ?? "(sem código P2021/P2022 explícito)", "-", texto);

    if (texto.includes(TABELA_CONHECIDA)) {
      return "Histórico indisponível: a migration DecisaoMovimentacaoEstoque ainda não foi aplicada neste ambiente.";
    }
    console.error(
      `[distribuicao-estoque/actions] Erro de esquema NÃO é da tabela conhecida (${TABELA_CONHECIDA}) — não é "migration pendente", tratando como erro genérico.`
    );
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
