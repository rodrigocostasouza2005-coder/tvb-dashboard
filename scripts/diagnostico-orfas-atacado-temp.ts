/**
 * Diagnóstico temporário, SOMENTE LEITURA — confirma a hipótese de causa raiz (achada lendo
 * sync-runner.ts) pros 377 pedidos de devolução "órfãos": que syncVendas (/vendaspdv) grava
 * Return.dapicVendaId = venda.Id (Id de /vendaspdv), mas pro token cd-atacado a Sale real desse
 * mesmo canal vem de syncFaturas (/faturas) com Sale.dapicVendaId = fatura.Id — um ID de um
 * endpoint DIFERENTE, sem correspondência nenhuma no schema. Checa: (1) se as devoluções órfãs
 * são quase 100% do canal atacado (storeId/tabelaPreco), (2) se existe uma Sale "parecida" (mesma
 * loja, mesmo cod/produto, valor compatível, qualquer data) que bateria por conteúdo mesmo sem
 * bater por dapicVendaId — pra saber se é receita realmente ausente ou só não-linkável.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stores = await prisma.store.findMany({ select: { id: true, name: true, displayGroup: true } });
  const nameById = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const sales = await prisma.sale.findMany({ select: { storeId: true, dapicVendaId: true, cod: true, saleDate: true, valorTotalLiquido: true, quantidade: true, tabelaPreco: true } });
  const returns = await prisma.return.findMany({
    where: { status: { not: "Cancelada" } },
    select: { storeId: true, dapicVendaId: true, cod: true, returnDate: true, valorTotal: true, quantidade: true, tabelaPreco: true },
  });

  const saleIdsByStore = new Map<string, Set<number>>();
  for (const s of sales) {
    if (s.dapicVendaId == null) continue;
    const set = saleIdsByStore.get(s.storeId) ?? new Set<number>();
    set.add(s.dapicVendaId);
    saleIdsByStore.set(s.storeId, set);
  }

  const orfaos = returns.filter((r) => r.dapicVendaId != null && !(saleIdsByStore.get(r.storeId)?.has(r.dapicVendaId)));
  console.log(`Total devoluções órfãs (sem Sale com mesmo dapicVendaId NESTA loja): ${orfaos.length}`);

  // 1) Distribuição por loja e por tabelaPreco
  const porLoja = new Map<string, { count: number; valor: number }>();
  const porTabelaPreco = new Map<string, { count: number; valor: number }>();
  for (const r of orfaos) {
    const loja = nameById.get(r.storeId) ?? r.storeId;
    const a = porLoja.get(loja) ?? { count: 0, valor: 0 };
    a.count++; a.valor += r.valorTotal;
    porLoja.set(loja, a);
    const tp = r.tabelaPreco ?? "(null)";
    const b = porTabelaPreco.get(tp) ?? { count: 0, valor: 0 };
    b.count++; b.valor += r.valorTotal;
    porTabelaPreco.set(tp, b);
  }
  console.log("\n=== Órfãs por loja ===");
  for (const [loja, v] of [...porLoja.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${loja}: ${v.count} linhas | R$ ${v.valor.toFixed(2)}`);
  }
  console.log("\n=== Órfãs por tabelaPreco ===");
  for (const [tp, v] of [...porTabelaPreco.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${tp}: ${v.count} linhas | R$ ${v.valor.toFixed(2)}`);
  }

  // 2) Taxa de match da loja mais afetada: de TODAS as devoluções dessa loja (não só órfãs),
  // quantas batem com Sale por dapicVendaId vs não batem — pra confirmar se é sistemático (quase
  // 100% órfã) ou esporádico.
  const piorLoja = [...porLoja.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (piorLoja) {
    const [nomeLoja] = piorLoja;
    const storeIdPior = [...nameById.entries()].find(([, nome]) => nome === nomeLoja)?.[0];
    if (storeIdPior) {
      const todasDessaLoja = returns.filter((r) => r.storeId === storeIdPior);
      const orfasDessaLoja = todasDessaLoja.filter((r) => r.dapicVendaId != null && !(saleIdsByStore.get(storeIdPior)?.has(r.dapicVendaId)));
      console.log(`\n=== Taxa de match em "${nomeLoja}" ===`);
      console.log(`  Total devoluções (não canceladas) nessa loja: ${todasDessaLoja.length}`);
      console.log(`  Órfãs (sem Sale com mesmo dapicVendaId nessa loja): ${orfasDessaLoja.length} (${((orfasDessaLoja.length / todasDessaLoja.length) * 100).toFixed(1)}%)`);

      // 3) Pra uma amostra de 5 órfãs dessa loja, procura Sale "parecida" por conteúdo (mesma
      // loja, mesmo cod, valor unitário compatível, QUALQUER data) — se existir, a receita não
      // está ausente, só não está linkada por dapicVendaId.
      console.log(`\n=== Amostra: existe Sale parecida por CONTEÚDO (mesmo cod), mesmo sem bater dapicVendaId? ===`);
      const amostra = orfasDessaLoja.slice(0, 8);
      for (const r of amostra) {
        const parecidas = await prisma.sale.findMany({
          where: { storeId: storeIdPior, cod: r.cod },
          select: { dapicVendaId: true, saleDate: true, valorTotalLiquido: true, quantidade: true },
          orderBy: { saleDate: "desc" },
          take: 3,
        });
        console.log(`  devolução cod=${r.cod} qtd=${r.quantidade} valor=R$ ${r.valorTotal.toFixed(2)} (returnDate=${r.returnDate.toISOString().slice(0, 10)}, dapicVendaId=${r.dapicVendaId})`);
        if (parecidas.length === 0) {
          console.log(`    -> NENHUMA Sale com esse cod nessa loja, em NENHUMA data.`);
        } else {
          for (const p of parecidas) {
            console.log(`    -> Sale parecida: dapicVendaId=${p.dapicVendaId}, saleDate=${p.saleDate.toISOString().slice(0, 10)}, qtd=${p.quantidade}, valor=R$ ${p.valorTotalLiquido.toFixed(2)}`);
          }
        }
      }
    }
  }

  // 4) Confirma o espaço de Id: dapicVendaId de Sale em "TVB Site e Atacado" (via faturas) tem
  // faixa de valores bem diferente do dapicVendaId das devoluções órfãs (via vendaspdv)? Se as
  // faixas não se sobrepõem, é forte evidência de endpoints/Id-spaces diferentes.
  if (piorLoja) {
    const storeIdPior = [...nameById.entries()].find(([, nome]) => nome === piorLoja[0])?.[0];
    if (storeIdPior) {
      const salesDessaLoja = sales.filter((s) => s.storeId === storeIdPior && s.dapicVendaId != null).map((s) => s.dapicVendaId as number);
      const returnsOrfasDessaLoja = returns.filter((r) => r.storeId === storeIdPior && r.dapicVendaId != null && !(saleIdsByStore.get(storeIdPior)?.has(r.dapicVendaId))).map((r) => r.dapicVendaId as number);
      if (salesDessaLoja.length > 0 && returnsOrfasDessaLoja.length > 0) {
        console.log(`\n=== Faixa de dapicVendaId (confirma se são espaços de Id diferentes) ===`);
        console.log(`  Sale (via faturas) nessa loja: min=${Math.min(...salesDessaLoja)} max=${Math.max(...salesDessaLoja)} (n=${salesDessaLoja.length})`);
        console.log(`  Return órfã (via vendaspdv) nessa loja: min=${Math.min(...returnsOrfasDessaLoja)} max=${Math.max(...returnsOrfasDessaLoja)} (n=${returnsOrfasDessaLoja.length})`);
      }
    }
  }

  console.log("\n(Diagnóstico concluído — somente leitura, nenhum registro foi alterado.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
