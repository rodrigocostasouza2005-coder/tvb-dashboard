"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSessionUser } from "@/lib/auth";
import { TABS, type TabKey } from "@/lib/tabs";
import { generateApiToken, getApiToken } from "@/lib/api-token";
import { runSync, recuperarVendasRecentes } from "@/lib/sync-runner";
import { setBannerModoManual, getBannerStatus, type ModoManual } from "@/lib/black-friday-banner";
import { upsertPrecosBlackFriday, type PrecoBlackFridayInput } from "@/lib/precos-black-friday";
import precosBlackFridayData from "../../../../data/precos-black-friday.json";
import type { Role } from "@prisma/client";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    throw new Error("Só administradores podem fazer isso.");
  }
  return user;
}

function readAllowedTabs(formData: FormData): string[] {
  const keys = TABS.map((t) => t.key);
  return formData
    .getAll("tab")
    .map(String)
    .filter((k): k is TabKey => (keys as string[]).includes(k));
}

function readAllowedStores(formData: FormData): string[] {
  return formData.getAll("store").map(String).filter(Boolean);
}

function readAllowedMarcas(formData: FormData): string[] {
  return formData.getAll("marca").map(String).filter(Boolean);
}

function readAllowedTabelasPreco(formData: FormData): string[] {
  return formData.getAll("tabelaPreco").map(String).filter(Boolean);
}

function readCanSeeFinancials(formData: FormData): boolean {
  return formData.get("canSeeFinancials") === "true";
}

export async function createUserAction(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "VENDEDOR") as Role;
  const allowedTabs = readAllowedTabs(formData);
  const allowedStores = readAllowedStores(formData);
  const allowedMarcas = readAllowedMarcas(formData);
  const allowedTabelasPreco = readAllowedTabelasPreco(formData);
  const canSeeFinancials = readCanSeeFinancials(formData);

  if (!name || !email || !password) return;

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { name, email, passwordHash, role, allowedTabs, allowedStores, allowedMarcas, allowedTabelasPreco, canSeeFinancials },
  });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?ok=1");
}

export async function updateUserAction(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "VENDEDOR") as Role;
  const allowedTabs = readAllowedTabs(formData);
  const allowedStores = readAllowedStores(formData);
  const allowedMarcas = readAllowedMarcas(formData);
  const allowedTabelasPreco = readAllowedTabelasPreco(formData);
  const canSeeFinancials = readCanSeeFinancials(formData);
  if (!userId) return;

  await prisma.user.update({
    where: { id: userId },
    data: { role, allowedTabs, allowedStores, allowedMarcas, allowedTabelasPreco, canSeeFinancials },
  });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?ok=1");
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId || !password) return;

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?ok=1");
}

export async function deleteUserAction(formData: FormData) {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === admin.id) return; // não deixa se autoexcluir

  const remainingAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: userId } } });
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (target?.role === "ADMIN" && remainingAdmins === 0) return; // não deixa zerar os admins

  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/dashboard/admin");
}

// Dispara a sync direto em processo (sem round-trip de rede) e retorna imediatamente — o botão
// não trava a página. runSync() nunca lança (sempre captura e grava SyncLog + Telegram), então
// não precisa de try/catch aqui; after() só garante que essa chamada continua rodando depois da
// resposta já ter voltado pro navegador (mesmo mecanismo de self-heal-sync.ts).
//
// Achado em 2026-08-31 (Rodrigo reportou "botão não funciona") e READACHADO em 2026-10-27
// (nenhuma venda de 22/10 a 27/10 aparecia, nem clicando no botão): a versão antiga disparava um
// fetch() HTTP pra /api/sync (POST, mesma instância se chamando por rede) dentro do after() — na
// prática, nenhuma invocação de /api/sync aparecia nos logs de produção depois do clique,
// confirmado comparando o log do POST /dashboard/admin com a ausência total de POST /api/sync no
// mesmo intervalo. O fetch morria antes de completar (DNS/TLS/cold start da invocação de rede
// pra si mesmo, mesma classe de risco que o comentário original já suspeitava, só que o after()
// sozinho não cobria esse tipo de falha — só evitava o corte da RESPOSTA, não garantia a entrega
// da requisição em si). Chamar runSync() direto, no mesmo processo, elimina esse salto de rede
// inteiro (sem DNS/TLS/nova invocação) — é a mesma função que /api/sync chama por baixo.
export async function forceSyncAction(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  after(() =>
    runSync({ checkDuplicates: true }).catch((e) => {
      // runSync() já captura e reporta (SyncLog + Telegram) toda falha interna — esse catch é
      // só rede de segurança pra erro inesperado FORA do try/catch dela (ex: acquireSyncLock
      // falhando antes mesmo de entrar no try).
      console.error("[forceSyncAction] runSync falhou:", e);
    })
  );

  return {
    ok: true,
    message: "Sincronização iniciada! Você vai receber um aviso no Telegram quando terminar.",
  };
}

// Recuperação pontual do gap real achado em 2026-10-27 (forceSyncAction nunca executava de
// verdade — ver fix acima). Roda SÍNCRONO (sem after()) de propósito: queremos o resultado
// (quantas vendas entraram, antes/depois por loja) de volta na tela agora, não só um aviso de
// "iniciado". Idempotente (reaproveita syncVendas/syncFaturas) — pode clicar de novo sem medo.
export async function recuperarVendasFaltantesAction(): Promise<{
  ok: boolean;
  message: string;
  detalhe?: Awaited<ReturnType<typeof recuperarVendasRecentes>>;
}> {
  await requireAdmin();

  const resultado = await recuperarVendasRecentes(10);
  if (!resultado.ok) {
    return { ok: false, message: resultado.message };
  }

  const linhas = resultado.depois.map((d) => {
    const a = resultado.antes.find((x) => x.loja === d.loja);
    return `${d.loja}: ${a?.totalNaJanela ?? 0} → ${d.totalNaJanela}`;
  });
  return {
    ok: true,
    message: `Recuperação concluída (janela de ${resultado.dias} dias). ${linhas.join(" | ")}`,
    detalhe: resultado,
  };
}

// Gera (ou substitui) o token de API usado pelo Custom GPT/Conector MCP — invalida o anterior,
// então só usar quando quiser trocar de verdade (qualquer coisa já conectada com o token antigo
// para de funcionar até reconfigurar lá).
export async function generateApiTokenAction(): Promise<{ ok: boolean; message: string; token?: string }> {
  await requireAdmin();

  const token = await generateApiToken();
  revalidatePath("/dashboard/admin");

  return { ok: true, message: "Novo token gerado.", token };
}

// Mostra o token atual sob demanda — não fica pré-carregado na página, só busca quando a pessoa
// clica em "Ver token".
export async function revealApiTokenAction(): Promise<{ ok: boolean; message: string; token?: string }> {
  await requireAdmin();

  const token = await getApiToken();
  if (!token) return { ok: false, message: "Nenhum token gerado ainda." };
  return { ok: true, message: "", token };
}

// Reativa um vendedor — pedido do Rodrigo em 2026-09-21. Não tenta "reconquistar" de volta
// clientes que já foram redistribuídos enquanto ele estava inativo (fica como está — decisão
// deliberada, não foi pedido reverter automaticamente); ele só volta a poder ser selecionado e
// receber novos clientes/contatos dali pra frente.
export async function ativarVendedorAction(formData: FormData) {
  await requireAdmin();
  const vendedorId = String(formData.get("vendedorId") ?? "");
  if (!vendedorId) return;
  await prisma.vendedor.update({ where: { id: vendedorId }, data: { ativo: true } });
  revalidatePath("/dashboard/admin");
}

// Desativa um vendedor e redistribui a carteira dele — pedido do Rodrigo em 2026-09-21 (ex:
// vendedor que saiu da empresa). Só ADMIN (mesmo padrão de deleteUserAction/deletarContatoAction
// — ação de alto impacto). Redistribuição é round-robin equilibrado ENTRE OS VENDEDORES ATIVOS
// RESTANTES DA MESMA LOJA (nunca entre lojas diferentes), e é persistida na hora — não é
// recalculada toda vez que alguém abre a tela (ver ClienteVendedorAtribuicao). Bloqueia se essa
// desativação zerasse os vendedores ativos da loja (não teria pra quem redistribuir).
export async function desativarVendedorAction(formData: FormData): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const vendedorId = String(formData.get("vendedorId") ?? "");
  if (!vendedorId) return { ok: false, message: "Vendedor não informado." };

  const vendedor = await prisma.vendedor.findUnique({ where: { id: vendedorId } });
  if (!vendedor) return { ok: false, message: "Vendedor não encontrado." };
  if (!vendedor.ativo) return { ok: true, message: "Já estava inativo." };

  const restantes = await prisma.vendedor.findMany({
    where: { storeId: vendedor.storeId, ativo: true, id: { not: vendedorId } },
    orderBy: { nome: "asc" },
  });
  if (restantes.length === 0) {
    return { ok: false, message: "Não dá pra desativar: seria o último vendedor ativo dessa loja, e não sobraria ninguém pra redistribuir a carteira dele." };
  }

  const clientesDoVendedor = await prisma.clienteVendedorAtribuicao.findMany({
    where: { storeId: vendedor.storeId, vendedorAtualId: vendedorId },
  });

  // Agrupa por vendedor de destino e faz 1 updateMany por destino (não 1 update por cliente) —
  // achado testando com a Juliana (481 clientes): 1 update por linha numa transação interativa
  // estourava o timeout padrão do Prisma antes de terminar. Agrupado, viram só
  // restantes.length+1 idas ao banco (ex: 6 pra Leblon), não importa quantos clientes tenha.
  const idsPorNovoVendedor = new Map<string, string[]>();
  for (let i = 0; i < clientesDoVendedor.length; i++) {
    const novoVendedorId = restantes[i % restantes.length].id;
    const ids = idsPorNovoVendedor.get(novoVendedorId) ?? [];
    ids.push(clientesDoVendedor[i].id);
    idsPorNovoVendedor.set(novoVendedorId, ids);
  }

  await prisma.$transaction(async (tx) => {
    await tx.vendedor.update({ where: { id: vendedorId }, data: { ativo: false } });
    for (const [novoVendedorId, atribuicaoIds] of idsPorNovoVendedor) {
      await tx.clienteVendedorAtribuicao.updateMany({
        where: { id: { in: atribuicaoIds } },
        data: { vendedorAtualId: novoVendedorId, vendedorOriginalId: vendedorId },
      });
    }
  });

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/clientes-sugestoes-contato");
  return {
    ok: true,
    message: `${vendedor.nome} desativado. ${clientesDoVendedor.length} cliente(s) redistribuído(s) entre ${restantes.length} vendedor(es) ativo(s).`,
  };
}

// Override manual do banner de Black Friday (ver lib/black-friday-banner.ts) — botão de clique
// único, efeito imediato (pedido do Rodrigo: controle inline, não formulário à parte). Grava no
// BlackFridayBannerConfig (DB), não em memória/env — sobrevive a reload/novo login/restart do
// servidor. `revalidatePath` nas páginas do dashboard pra qualquer aba já aberta pegar o status
// novo no próximo request (o layout é quem lê o status, não a página em si).
async function setModoManualBanner(modoManual: ModoManual): Promise<{ ok: boolean; message: string; label: string }> {
  const admin = await requireAdmin();
  await setBannerModoManual(modoManual, admin.email);
  revalidatePath("/dashboard", "layout");
  const status = await getBannerStatus();
  return { ok: true, message: "Status do banner atualizado.", label: status.label };
}

export async function ativarBannerBlackFridayAction() {
  return setModoManualBanner("ATIVO");
}

export async function desativarBannerBlackFridayAction() {
  return setModoManualBanner("INATIVO");
}

// Limpa o override manual (volta pro automático) — único jeito de sair de "Forçado ATIVO/INATIVO"
// de volta pra "Automático" sem editar o banco na mão. Sem isso, um "Desativar" clicado por engano
// (ou esquecido) depois de 01/12 esconderia o banner pra sempre mesmo fora da janela, e um
// "Ativar agora" esquecido o manteria ligado pra sempre — nenhum dos dois é o comportamento
// correto de "override temporário" pedido pelo Rodrigo.
export async function voltarAutomaticoBannerAction() {
  return setModoManualBanner(null);
}

// Importa/atualiza PrecoBlackFriday a partir de data/precos-black-friday.json (commitado no
// repo, gerado 1x da planilha real do Rodrigo "Preços Black Friday.xlsx" — ver
// scripts/black-friday/importar-precos.ts, que gera esse mesmo JSON a partir do .xlsx original).
// Rodada aqui (dentro do processo do servidor, com acesso real a DATABASE_URL de produção) porque
// a env var de produção está marcada "Sensitive" na Vercel — não dá pra rodar o script local
// apontando pra produção sem ela. Quando o Rodrigo mandar uma planilha de preço atualizada,
// regenerar data/precos-black-friday.json (reaproveitando o parser do script) e clicar de novo —
// upsert por grupo+produto, idempotente, seguro repetir.
export async function importarPrecosBlackFridayAction(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  try {
    const { criadas, atualizadas } = await upsertPrecosBlackFriday(
      precosBlackFridayData as PrecoBlackFridayInput[]
    );
    return { ok: true, message: `Importado: ${criadas} criados, ${atualizadas} atualizados.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Erro desconhecido ao importar." };
  }
}
