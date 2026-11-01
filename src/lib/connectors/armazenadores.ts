import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// Regras de mapeamento armazenador (DAPIC) -> Store (nosso banco).
// Centralizado aqui porque script de sync e a rota /api/sync precisam da mesma lógica.

// Armazenadores de "defeito", lixeira, bonificação, marketing/produção, extraviados (perda de
// estoque, achado em 2026-09-25) e conserto (achado em 2026-10-27 — mesma classe de bug: o DAPIC
// criou esse armazenador novo e, como não batia com nenhum termo daqui, sellsProducts() tratava
// como loja de venda. Pior ainda: por vir ANTES de "CD" na lista de /armazenadores, "roubava" o
// primaryStoreId em syncArmazenadores (`if (sells && !primaryStoreId) primaryStoreId = store.id`
// pega o PRIMEIRO que vende, não especificamente o CD) — toda venda real do Site (via /faturas)
// desde então foi gravada silenciosamente na loja "Conserto", sem erro nenhum, só saleDate real
// mas no storeId errado. Ver scripts/corrigir-storeid-conserto.ts pro reparo do dado já gravado
// errado; esse regex só evita achar NOVO armazenador assim de novo — não é proteção genérica
// contra qualquer nome futuro.
const NAO_VENDE = /defeito|lixeira|bonifica|marketing|extravia|conserto/i;

// Agrupamento só visual (pro filtro mostrar uma opção só) — os dados continuam em Stores
// separadas por baixo, porque CD e ATACADO têm quantidades diferentes pro mesmo produto
// (juntar de verdade faria uma sobrescrever a outra em vez de somar).
const DISPLAY_GROUP: Record<string, string> = {
  CD: "TVB Site e Atacado",
  ATACADO: "TVB Site e Atacado",
};

export function displayGroupFor(descricao: string): string | null {
  return DISPLAY_GROUP[descricao] ?? null;
}

export function sellsProducts(descricao: string): boolean {
  return !NAO_VENDE.test(descricao);
}

// Âncora pra primaryStoreId (ver syncArmazenadores em sync-runner.ts) — achado em 2026-10-30,
// causa raiz real do incidente do armazém "Conserto": a regra antiga escolhia "o primeiro
// armazenador que vende, na ordem que a API devolveu", não especificamente o CD. Quando um
// armazém novo não reconhecido pelo NAO_VENDE veio antes de "CD" na resposta, ele roubou o
// primaryStoreId e toda venda real do Site foi gravada no lugar errado por 5 dias, sem erro
// nenhum. Daqui pra frente, pros tokens listados aqui, primaryStoreId é sempre o Store cujo code
// bate com o valor configurado — nunca "o primeiro que vende" por acidente de ordenação.
export const PRIMARY_STORE_CODE_BY_CLIENT_LABEL: Record<string, string> = {
  "cd-atacado": "CD",
};

export type VerificacaoArmazemNovo = {
  // true só quando ESTA chamada criou o registro de verdade — nunca "provavelmente novo".
  ehNovo: boolean;
  // Presente só quando a persistência falhou por um motivo que não é "já existe" — o chamador
  // decide o que fazer (hoje: não alertar "novo" e logar a falha, nunca assumir novo às cegas).
  erro?: unknown;
};

// Identificação persistente e idempotente de armazém "já visto", pra alimentar o alerta de
// "armazém novo no DAPIC" (syncArmazenadores, sync-runner.ts). Achado em 2026-10-31: a versão
// anterior comparava por NOME (Store.code) contra um snapshot do banco tirado no início de cada
// sync, e o próprio Store.code nunca era atualizado quando o DAPIC mudava o nome do armazém —
// qualquer divergência de nome (ou qualquer corrida entre syncs concorrentes lendo o mesmo
// snapshot "antes de ambos gravarem") disparava o alerta de novo em TODA sincronização seguinte,
// pra sempre, mesmo o armazém já sendo conhecido. "Conserto (enviados para fornecedor)" (Id 20,
// token cd-atacado) foi o caso real reportado.
//
// Correção: chave estável é (clientLabel, dapicArmazenadorId) — o ID do DAPIC não muda, o nome é
// só informativo. A detecção de "é novo" não lê o estado antes e decide depois (a mesma janela
// de corrida do bug antigo) — tenta CRIAR direto; se o banco aceitar o INSERT, é
// inequivocamente a primeira vez (mesmo sob concorrência, só uma das duas chamadas concorrentes
// consegue criar — a constraint @@unique garante isso, não precisa de lock manual). Se o banco
// rejeitar por violação de unicidade (P2002), já existia — não é novo, só atualiza nome/
// classificação se mudaram (e registra em log quando a CLASSIFICAÇÃO muda, não o nome, que é só
// estético). Qualquer outro erro de banco não é tratado como "sabemos que não é novo" nem como
// "é novo" — devolve o erro pro chamador decidir (nunca afirmar novidade sem conseguir persistir,
// senão volta a alertar toda sync; ver runbook do incidente de 2026-10-31).
export async function verificarArmazemNovo(
  clientLabel: string,
  dapicArmazenadorId: number,
  nomeAtual: string,
  sells: boolean
): Promise<VerificacaoArmazemNovo> {
  const classificacao = sells ? "VENDE" : "NAO_VENDE";
  try {
    await prisma.armazemConhecido.create({
      data: { clientLabel, dapicArmazenadorId, nomeAtual, classificacao },
    });
    return { ehNovo: true };
  } catch (e) {
    const violacaoDeUnicidade = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
    if (!violacaoDeUnicidade) {
      return { ehNovo: false, erro: e };
    }
    // Já existia (sync anterior, ou a outra ponta de uma corrida concorrente que ganhou o
    // INSERT) — atualiza nome/classificação se mudaram, sem contar como "novo".
    const existente = await prisma.armazemConhecido
      .findUnique({ where: { clientLabel_dapicArmazenadorId: { clientLabel, dapicArmazenadorId } } })
      .catch(() => null);
    if (existente && (existente.nomeAtual !== nomeAtual || existente.classificacao !== classificacao)) {
      if (existente.classificacao !== classificacao) {
        console.warn(
          `[armazem-conhecido] classificação mudou: ${clientLabel}/${dapicArmazenadorId} (${nomeAtual}) ${existente.classificacao} -> ${classificacao}`
        );
      }
      await prisma.armazemConhecido
        .update({ where: { clientLabel_dapicArmazenadorId: { clientLabel, dapicArmazenadorId } }, data: { nomeAtual, classificacao } })
        .catch(() => {});
    }
    return { ehNovo: false };
  }
}
