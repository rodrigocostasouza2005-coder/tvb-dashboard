import { prisma } from "@/lib/prisma";
import { createDapicClients, type DapicClient } from "@/lib/connectors/dapic";

// Não existe no banco um campo ligando Store -> label do token DAPIC (a associação só é
// descoberta rodando /armazenadores com cada token, dentro do sync). Pra buscar a nota de uma
// venda específica sob demanda (fora do sync em lote), precisamos resolver isso de novo aqui.
// Cacheado em memória de processo por 10min — são só ~4 chamadas pequenas (1 por loja física +
// site/atacado), não pesa, mas não precisa repetir a cada render do follow-up.
let cache: { at: number; map: Map<string, DapicClient> } | null = null;
const CACHE_MS = 10 * 60_000;

async function storeClientMap(): Promise<Map<string, DapicClient>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;

  const clients = createDapicClients().filter((c) => c.label !== "matriz");
  const stores = await prisma.store.findMany({ where: { dapicArmazenadorId: { not: null } } });
  const map = new Map<string, DapicClient>();

  for (const client of clients) {
    const armazenadores = await client.fetchArmazenadores();
    const ids = new Set(armazenadores.map((a) => a.Id));
    for (const store of stores) {
      if (store.dapicArmazenadorId != null && ids.has(store.dapicArmazenadorId)) {
        map.set(store.id, client);
      }
    }
  }

  cache = { at: Date.now(), map };
  return map;
}

// Número da nota/cupom fiscal de uma venda, buscado ao vivo no DAPIC (não gravado no banco —
// pedido do Rodrigo em 2026-09-09, só pro follow-up pós-compra, volume baixo demais pra
// justificar mexer no sync em lote ou no schema).
//
// Site+Atacado: a venda vem de /faturas, cujo detalhe já traz o bloco Fiscal com NumeroNota.
// Loja física: a venda vem de /vendaspdv — a maioria é cupom fiscal (NFCE), que só tem número
// mesmo (sem chave de 44 dígitos disponível pela API); raramente é NFE (nota fiscal de verdade,
// mais comum em devolução/entrada). CFE existe no schema mas nunca visto preenchido até agora.
//
// Nunca lança — se a busca falhar ou não achar nada, retorna null e a mensagem de follow-up
// simplesmente sai sem a linha da nota (decisão do Rodrigo, não trava o resto da mensagem).
//
// Cacheado em NotaFiscalCache (achado em 2026-09-10: buscar ao vivo pra ~100 clientes toda vez
// que a aba de Sugestões de Contato abre deixava a página perto de 1min) — a nota de uma venda
// passada nunca muda, então só busca de verdade na 1ª vez que aquela venda aparece no follow-up.
export async function getNumeroNotaFiscal(storeId: string, dapicVendaId: number): Promise<string | null> {
  const cached = await prisma.notaFiscalCache.findUnique({ where: { storeId_dapicVendaId: { storeId, dapicVendaId } } });
  if (cached) return cached.numero;

  const numero = await buscarNumeroNotaFiscal(storeId, dapicVendaId);
  await prisma.notaFiscalCache
    .create({ data: { storeId, dapicVendaId, numero } })
    .catch(() => {}); // corrida rara (2 requests simultâneos pra mesma venda nova) — não é fatal, só perde o cache dessa vez.
  return numero;
}

async function buscarNumeroNotaFiscal(storeId: string, dapicVendaId: number): Promise<string | null> {
  try {
    const map = await storeClientMap();
    const client = map.get(storeId);
    if (!client) return null;

    if (client.label === "cd-atacado") {
      const fatura = await client.fetchFaturaDetalhe(dapicVendaId);
      return fatura.Fiscal ? String(fatura.Fiscal.NumeroNota) : null;
    }

    const venda = await client.fetchVendaPdvDetalhe(dapicVendaId);
    const numero = venda.NFCE ?? venda.NFE ?? venda.CFE;
    return numero != null ? String(numero) : null;
  } catch {
    return null;
  }
}
