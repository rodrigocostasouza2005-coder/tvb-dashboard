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

export type ArmazemConhecidoCache = Map<number, { nomeAtual: string; classificacao: string }>;

// Carrega TODOS os armazéns já conhecidos de um token numa única consulta — chamado 1x por
// syncArmazenadores, antes do loop por armazenador. Achado em 2026-11-01: a versão anterior de
// verificarArmazemNovo fazia 1-2 consultas por armazém DENTRO do loop (create, e no caso comum
// de "já existe" também um findUnique) — pra um token com 8 armazéns (cd-atacado), isso virou
// 8-16 round-trips extras por sincronização, a cada ~10min. Uma instabilidade pontual de conexão
// com o Neon durante esse loop reproduzia exatamente o sintoma reportado: TODOS os armazéns do
// token falhando juntos no mesmo ciclo ("não foi possível confirmar"). Pré-carregar tudo numa
// consulta só devolve o caminho comum (nada novo, nada mudou) a 0 queries extras no loop.
export async function carregarArmazensConhecidos(clientLabel: string): Promise<ArmazemConhecidoCache> {
  const rows = await prisma.armazemConhecido.findMany({
    where: { clientLabel },
    select: { dapicArmazenadorId: true, nomeAtual: true, classificacao: true },
  });
  return new Map(rows.map((r) => [r.dapicArmazenadorId, { nomeAtual: r.nomeAtual, classificacao: r.classificacao }]));
}

// Identificação persistente e idempotente de armazém "já visto", pra alimentar o alerta de
// "armazém novo no DAPIC" (syncArmazenadores, sync-runner.ts). Achado em 2026-10-31: a versão
// original (antes desta) comparava por NOME (Store.code) contra um snapshot do banco tirado no
// início de cada sync, e o próprio Store.code nunca era atualizado quando o DAPIC mudava o nome
// do armazém — qualquer divergência de nome (ou qualquer corrida entre syncs concorrentes lendo
// o mesmo snapshot "antes de ambos gravarem") disparava o alerta de novo em TODA sincronização
// seguinte, pra sempre, mesmo o armazém já sendo conhecido. "Conserto (enviados para fornecedor)"
// (Id 20, token cd-atacado) foi o caso real reportado.
//
// Correção: chave estável é (clientLabel, dapicArmazenadorId) — o ID do DAPIC não muda, o nome é
// só informativo. `cache` (carregarArmazensConhecidos) resolve o caminho comum SEM nenhuma query
// — só armazém que não estava na cache (realmente novo, ou criado por uma sync concorrente
// depois do carregamento) ou que teve nome/classificação mudados precisa de uma escrita. Pra
// quem não está na cache, create() + tratar violação de unicidade (P2002) continua sendo a fonte
// de verdade sob concorrência (a constraint @@unique garante atomicidade, não precisa de lock
// manual) — nunca reconsulta antes de decidir "é novo", e qualquer erro de banco que não seja
// "já existe" nunca é tratado como "é novo" (devolve o erro pro chamador decidir, sem alertar
// sem conseguir persistir de verdade — ver runbook do incidente de 2026-10-31).
export async function verificarArmazemNovo(
  cache: ArmazemConhecidoCache,
  clientLabel: string,
  dapicArmazenadorId: number,
  nomeAtual: string,
  sells: boolean
): Promise<VerificacaoArmazemNovo> {
  const classificacao = sells ? "VENDE" : "NAO_VENDE";
  const conhecido = cache.get(dapicArmazenadorId);

  if (conhecido) {
    if (conhecido.nomeAtual === nomeAtual && conhecido.classificacao === classificacao) {
      return { ehNovo: false }; // caminho comum — 0 queries
    }
    if (conhecido.classificacao !== classificacao) {
      console.warn(
        `[armazem-conhecido] classificação mudou: ${clientLabel}/${dapicArmazenadorId} (${nomeAtual}) ${conhecido.classificacao} -> ${classificacao}`
      );
    }
    try {
      await prisma.armazemConhecido.update({
        where: { clientLabel_dapicArmazenadorId: { clientLabel, dapicArmazenadorId } },
        data: { nomeAtual, classificacao },
      });
    } catch (e) {
      return { ehNovo: false, erro: e };
    }
    return { ehNovo: false };
  }

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
    // Corrida: outra sync concorrente criou entre o carregamento da cache e agora — já é
    // conhecido, não é novo. Não reconfere nome/classificação aqui (janela rara; a próxima
    // sincronização corrige qualquer divergência pelo caminho comum acima).
    return { ehNovo: false };
  }
}
