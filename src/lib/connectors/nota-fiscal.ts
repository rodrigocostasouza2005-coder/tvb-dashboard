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

// Número + chave de acesso (44 dígitos) de uma venda, buscados ao vivo no DAPIC. Começou em
// 2026-09-09 só com o número (pedido do Rodrigo pro follow-up pós-compra); estendido em
// 2026-11-11 pra também trazer a chave de acesso, pedido da seção de Notas Fiscais da Ficha do
// Cliente (ver getClienteNotas em metrics/clientes.ts).
//
// Site+Atacado: a venda vem de /faturas, cujo detalhe já traz o bloco Fiscal com NumeroNota +
// ChaveNotaFiscal (SEMPRE disponível pra esse canal — emissão passa pelo próprio DAPIC via
// Shopify).
// Loja física: a venda vem de /vendaspdv — a maioria é cupom fiscal (NFCE), que só tem número
// mesmo (a API NÃO expõe chave de 44 dígitos pra NFC-e — limitação real confirmada, não um bug
// pra resolver). Raramente é NFE (nota fiscal de verdade, mais comum em devolução/entrada): nesse
// caso IdNotaFiscal vem preenchido e tentamos /notasfiscais/{id} (fetchNotaFiscalDetalhe,
// best-effort, endpoint nunca confirmado contra dado real antes dessa entrega) como último
// recurso pra achar a chave. CFE existe no schema mas nunca visto preenchido até agora.
//
// Nunca lança — se a busca falhar ou não achar nada, as 2 funções devolvem o que tiverem (numero
// e/ou chaveAcesso podem ficar null) em vez de travar a tela/mensagem que está chamando.
//
// Cacheado PERMANENTEMENTE em NotaFiscalCache, 1 linha por (storeId, dapicVendaId) — a nota de
// uma venda passada nunca muda, então só busca de verdade na 1ª vez que aquela venda aparece (no
// follow-up OU agora na Ficha do Cliente). Achado em 2026-09-10: buscar ao vivo sem cache pra
// ~100 clientes toda vez que uma tela abria deixava a página perto de 1min.
export async function getNumeroNotaFiscal(storeId: string, dapicVendaId: number): Promise<string | null> {
  const info = await getNotaFiscalInfo(storeId, dapicVendaId);
  return info.numero;
}

export type NotaFiscalInfo = {
  numero: string | null;
  chaveAcesso: string | null;
  numeroSerie: number | null;
  tipo: string | null;
};

export async function getNotaFiscalInfo(storeId: string, dapicVendaId: number): Promise<NotaFiscalInfo> {
  const cached = await prisma.notaFiscalCache.findUnique({ where: { storeId_dapicVendaId: { storeId, dapicVendaId } } });
  if (cached) {
    return { numero: cached.numero, chaveAcesso: cached.chaveAcesso, numeroSerie: cached.numeroSerie, tipo: cached.tipo };
  }

  const info = await buscarNotaFiscalInfo(storeId, dapicVendaId);
  await prisma.notaFiscalCache
    .create({ data: { storeId, dapicVendaId, ...info } })
    .catch(() => {}); // corrida rara (2 requests simultâneos pra mesma venda nova) — não é fatal, só perde o cache dessa vez.
  return info;
}

async function buscarNotaFiscalInfo(storeId: string, dapicVendaId: number): Promise<NotaFiscalInfo> {
  const vazio: NotaFiscalInfo = { numero: null, chaveAcesso: null, numeroSerie: null, tipo: null };
  try {
    const map = await storeClientMap();
    const client = map.get(storeId);
    if (!client) return vazio;

    if (client.label === "cd-atacado") {
      const fatura = await client.fetchFaturaDetalhe(dapicVendaId);
      if (!fatura.Fiscal) return vazio;
      return {
        numero: String(fatura.Fiscal.NumeroNota),
        chaveAcesso: fatura.Fiscal.ChaveNotaFiscal ?? null,
        numeroSerie: fatura.Fiscal.NumeroSerie ?? null,
        tipo: "FATURA",
      };
    }

    const venda = await client.fetchVendaPdvDetalhe(dapicVendaId);
    const numero = venda.NFCE ?? venda.NFE ?? venda.CFE;
    const tipo = venda.NFCE != null ? "NFCE" : venda.NFE != null ? "NFE" : venda.CFE != null ? "CFE" : null;

    // Chave de 44 dígitos só é tentada pro caso raro de NFE de loja física (NFC-e não tem, ver
    // comentário no topo do arquivo) — best-effort, nunca lança (fetchNotaFiscalDetalhe já se
    // protege por dentro).
    let chaveAcesso: string | null = null;
    let numeroSerie: number | null = null;
    if (venda.NFE != null && venda.IdNotaFiscal != null) {
      const detalhe = await client.fetchNotaFiscalDetalhe(venda.IdNotaFiscal);
      if (detalhe) {
        chaveAcesso = detalhe.chaveAcesso;
        numeroSerie = detalhe.numeroSerie;
      }
    }

    return { numero: numero != null ? String(numero) : null, chaveAcesso, numeroSerie, tipo };
  } catch {
    return vazio;
  }
}
