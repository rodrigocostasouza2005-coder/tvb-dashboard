// Backfill: preenche colecao das devoluções (Return) já existentes no banco com colecao=null,
// buscando de novo no histórico via /vendaspdv. A API sempre manda Colecao pra linha de
// devolução (confirmado reconsultando a API ao vivo em 2026-10-01) — o null persistido vinha de
// um bug real de sync (ver comentário em upsertReturnsComColecaoAtualizavel, sync-runner.ts, e em
// prisma/schema.prisma no campo Return.colecao), já corrigido pra sync futuro. Esse script só
// trata o histórico que já ficou gravado antes da correção.
//
// Reescrito em 2026-10-01 — a versão anterior deste script tinha DOIS bugs que faziam ele nunca
// atualizar nada de verdade:
//   1. Usava `item.Id` (o Id da linha na API) como itemIndex — mas item.Id NÃO é estável ao longo
//      do tempo (achado em 2026-09-25, documentado em dapic.ts), enquanto o itemIndex realmente
//      gravado no banco vem de stableItemIndexes() (hash determinístico pelo conteúdo do item).
//      Os dois quase nunca batem, então o `where` do updateMany não encontrava a linha certa.
//   2. Assumia 1 storeId por cliente (primaryStoreIdFor) — não contempla o split CD/ATACADO do
//      token cd-atacado (devolução de atacado pode estar na loja ATACADO, não só na loja "site"),
//      introduzido em 2026-09-23. Esse script busca os DOIS storeIds possíveis por cliente.
//
// Idempotente (só atualiza linhas com colecao ainda null) — seguro rodar de novo.
// Uso: npx tsx scripts/backfill-return-colecao.ts
import { prisma } from "@/lib/prisma";
import { createDapicClients, stableItemIndexes, type DapicClient } from "@/lib/connectors/dapic";
import { syncArmazenadores } from "@/lib/sync-runner";

const DATA_INICIAL = "2024-01-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const waitMs = Math.min(2000 * 2 ** i, 30000);
      console.log(`  (falhou, tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function backfillCliente(client: DapicClient) {
  const { storeByDapicId, primaryStoreId, atacadoStoreId } = await syncArmazenadores(client);
  const storeIdsPossiveis = [...new Set([primaryStoreId, atacadoStoreId].filter((s): s is string => !!s))];
  if (storeIdsPossiveis.length === 0) {
    console.log(`[${client.label}] nenhuma loja encontrada — pulando.`);
    return { candidatos: 0, atualizados: 0 };
  }

  console.log(`[${client.label}] buscando /vendaspdv de ${DATA_INICIAL} a ${DATA_FINAL}...`);
  const vendasPdv = await withRetry(() => client.fetchVendasPdv(DATA_INICIAL, DATA_FINAL));

  let candidatos = 0;
  let atualizados = 0;
  for (const venda of vendasPdv) {
    // Mesma chave usada no sync de verdade (syncVendas, sync-runner.ts) — precisa ser IDÊNTICA
    // pra reproduzir o mesmo itemIndex gravado no banco.
    const itemIndexes = stableItemIndexes(
      venda.Produtos,
      (p) => `${p.IdGradeProduto ?? venda.Codigo}::${p.Quantidade}::${p.ValorLiquido.toFixed(2)}::${p.Tipo}`
    );

    for (let pos = 0; pos < venda.Produtos.length; pos++) {
      const item = venda.Produtos[pos];
      if (item.Tipo !== "Devolução" || !item.Colecao) continue;
      candidatos++;
      const itemIndex = itemIndexes[pos];
      const r = await prisma.return.updateMany({
        where: {
          storeId: { in: storeIdsPossiveis },
          dapicVendaId: venda.Id,
          itemIndex,
          colecao: null,
        },
        data: { colecao: item.Colecao },
      });
      atualizados += r.count;
    }
  }
  console.log(`[${client.label}] ${candidatos} linhas de devolução com coleção na API, ${atualizados} atualizadas.`);
  return { candidatos, atualizados };
}

async function main() {
  const clients = createDapicClients();
  if (!clients.length) {
    console.log("Nenhuma credencial DAPIC configurada.");
    process.exit(1);
  }

  const antes = await prisma.return.count({ where: { colecao: null } });
  console.log(`Devoluções sem colecao ANTES: ${antes}\n`);

  let totalAtualizados = 0;
  for (const client of clients) {
    const r = await backfillCliente(client);
    totalAtualizados += r.atualizados;
  }

  const depois = await prisma.return.count({ where: { colecao: null } });
  console.log(`\nTotal atualizado: ${totalAtualizados}`);
  console.log(`Devoluções sem colecao DEPOIS: ${depois}`);
  console.log(`Continuam sem colecao (API também não tinha, ou sem dapicVendaId/fictícias): ${depois}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
