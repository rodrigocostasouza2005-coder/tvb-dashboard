/**
 * Diagnóstico temporário, SOMENTE LEITURA (nenhum update/create/delete, nenhum segredo impresso)
 * — investiga por que faturamento líquido (receita bruta - devolvido) aparece negativo pra
 * alguma loja/mês, e compara dois jeitos de calcular isso:
 *
 *   Método A (atual no dashboard, netByReturns em core.ts): devolução entra no mês da PRÓPRIA
 *   data da devolução (returnDate), independente de quando a venda original aconteceu.
 *
 *   Método B (alternativo, só pra este diagnóstico): devolução é atribuída ao mês da VENDA
 *   ORIGINAL (saleDate do Sale correspondente via storeId+dapicVendaId), não ao mês em que a
 *   devolução em si foi processada.
 *
 * Não altera nenhum arquivo de métricas/cálculo existente — é um script isolado, só leitura.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const stores = await prisma.store.findMany({ select: { id: true, name: true, displayGroup: true } });
  const nameById = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const sales = await prisma.sale.findMany({
    where: { status: { not: "Cancelada" } },
    select: { storeId: true, dapicVendaId: true, saleDate: true, valorTotalLiquido: true },
  });
  const returns = await prisma.return.findMany({
    where: { status: { not: "Cancelada" } },
    select: { storeId: true, dapicVendaId: true, returnDate: true, valorTotal: true },
  });

  console.log(`Sale rows (não canceladas): ${sales.length}`);
  console.log(`Return rows (não canceladas): ${returns.length}`);

  // saleDate original por storeId+dapicVendaId — pra atribuir devolução ao mês da venda (Método B).
  // dapicVendaId pode repetir dentro da MESMA venda (vários itens); todas as linhas da mesma venda
  // têm a mesma saleDate, então pegar a 1ª encontrada é suficiente.
  const saleDateByVendaId = new Map<string, Date>();
  for (const s of sales) {
    if (s.dapicVendaId == null) continue;
    const key = `${s.storeId}::${s.dapicVendaId}`;
    if (!saleDateByVendaId.has(key)) saleDateByVendaId.set(key, s.saleDate);
  }

  type Bucket = { bruta: number; devolvidoA: number; devolvidoB: number };
  const buckets = new Map<string, Bucket>();
  const getBucket = (storeId: string, mes: string) => {
    const key = `${storeId}::${mes}`;
    const b = buckets.get(key) ?? { bruta: 0, devolvidoA: 0, devolvidoB: 0 };
    buckets.set(key, b);
    return b;
  };

  for (const s of sales) {
    getBucket(s.storeId, monthKey(s.saleDate)).bruta += s.valorTotalLiquido;
  }

  let devolucaoSemVendaEncontrada = 0;
  let valorSemVendaEncontrada = 0;
  let devolucaoMesmoMes = 0;
  let valorMesmoMes = 0;
  let devolucaoMesAnterior = 0;
  let valorMesAnterior = 0;

  for (const r of returns) {
    // Método A: sempre no mês da própria devolução.
    getBucket(r.storeId, monthKey(r.returnDate)).devolvidoA += r.valorTotal;

    // Método B: no mês da venda original, se encontrada; senão, fallback conservador pro mês
    // da própria devolução (mesmo comportamento de hoje), mas contado separadamente abaixo.
    const vendaKey = r.dapicVendaId != null ? `${r.storeId}::${r.dapicVendaId}` : undefined;
    const saleDate = vendaKey ? saleDateByVendaId.get(vendaKey) : undefined;
    if (!saleDate) {
      devolucaoSemVendaEncontrada++;
      valorSemVendaEncontrada += r.valorTotal;
      getBucket(r.storeId, monthKey(r.returnDate)).devolvidoB += r.valorTotal;
      continue;
    }
    getBucket(r.storeId, monthKey(saleDate)).devolvidoB += r.valorTotal;

    if (monthKey(saleDate) === monthKey(r.returnDate)) {
      devolucaoMesmoMes++;
      valorMesmoMes += r.valorTotal;
    } else {
      devolucaoMesAnterior++;
      valorMesAnterior += r.valorTotal;
    }
  }

  const rows = [...buckets.entries()]
    .map(([key, b]) => {
      const [storeId, mes] = key.split("::");
      return {
        storeId,
        loja: nameById.get(storeId) ?? storeId,
        mes,
        bruta: b.bruta,
        devolvidoA: b.devolvidoA,
        devolvidoB: b.devolvidoB,
        liquidoA: b.bruta - b.devolvidoA,
        liquidoB: b.bruta - b.devolvidoB,
      };
    })
    .sort((a, b) => a.liquidoA - b.liquidoA);

  const negativosA = rows.filter((r) => r.liquidoA < 0);
  const negativosB = rows.filter((r) => r.liquidoB < 0);

  console.log(`\n=== RESUMO GERAL ===`);
  console.log(`Buckets loja×mês totais: ${rows.length}`);
  console.log(`Negativos pelo Método A (devolução no mês da DEVOLUÇÃO, = cálculo atual do dashboard): ${negativosA.length}`);
  console.log(`Negativos pelo Método B (devolução no mês da VENDA ORIGINAL): ${negativosB.length}`);
  console.log(`\nDevoluções com venda original identificada: ${devolucaoMesmoMes + devolucaoMesAnterior}`);
  console.log(`  - mesmo mês da devolução: ${devolucaoMesmoMes} (valor R$ ${valorMesmoMes.toFixed(2)})`);
  console.log(`  - mês DIFERENTE (anterior ou posterior) da devolução: ${devolucaoMesAnterior} (valor R$ ${valorMesAnterior.toFixed(2)})`);
  console.log(`Devoluções SEM venda original encontrada (dapicVendaId nulo ou sem Sale correspondente): ${devolucaoSemVendaEncontrada} (valor R$ ${valorSemVendaEncontrada.toFixed(2)})`);

  console.log(`\n=== OS 10 PIORES BUCKETS (Método A, atual) ===`);
  for (const r of negativosA.slice(0, 10)) {
    console.log(
      `  ${r.loja} | ${r.mes} | bruta=R$ ${r.bruta.toFixed(2)} | devolvidoA=R$ ${r.devolvidoA.toFixed(2)} | liquidoA=R$ ${r.liquidoA.toFixed(2)} || devolvidoB=R$ ${r.devolvidoB.toFixed(2)} | liquidoB=R$ ${r.liquidoB.toFixed(2)}`
    );
  }

  if (negativosA.length > 0) {
    const pior = negativosA[0];
    console.log(`\n=== CASO REAL DETALHADO: ${pior.loja} em ${pior.mes} ===`);
    console.log(`Bruta do mês: R$ ${pior.bruta.toFixed(2)}`);
    console.log(`Devolvido (Método A, por data da devolução): R$ ${pior.devolvidoA.toFixed(2)} -> Líquido A = R$ ${pior.liquidoA.toFixed(2)}`);
    console.log(`Devolvido (Método B, por data da venda original): R$ ${pior.devolvidoB.toFixed(2)} -> Líquido B = R$ ${pior.liquidoB.toFixed(2)}`);

    const [anoStr, mesStr] = pior.mes.split("-");
    const ano = Number(anoStr);
    const mesNum = Number(mesStr);
    const inicio = new Date(Date.UTC(ano, mesNum - 1, 1));
    const fim = new Date(Date.UTC(ano, mesNum, 1));

    const returnsDoMes = await prisma.return.findMany({
      where: { storeId: pior.storeId, returnDate: { gte: inicio, lt: fim }, status: { not: "Cancelada" } },
      select: { dapicVendaId: true, valorTotal: true, returnDate: true },
      orderBy: { returnDate: "asc" },
    });

    console.log(`\nDevoluções individuais nesse mês (${returnsDoMes.length} registros) — data da devolução vs data da venda original:`);
    let mostrados = 0;
    for (const r of returnsDoMes) {
      const vendaKey = r.dapicVendaId != null ? `${pior.storeId}::${r.dapicVendaId}` : undefined;
      const saleDate = vendaKey ? saleDateByVendaId.get(vendaKey) : undefined;
      const origem = saleDate
        ? `venda original em ${saleDate.toISOString().slice(0, 10)}${monthKey(saleDate) !== pior.mes ? " <- MÊS DIFERENTE" : " (mesmo mês)"}`
        : "venda original NÃO encontrada (dapicVendaId nulo ou sem Sale correspondente)";
      console.log(`  devolução em ${r.returnDate.toISOString().slice(0, 10)} | valor=R$ ${r.valorTotal.toFixed(2)} | ${origem}`);
      mostrados++;
      if (mostrados >= 40) {
        console.log(`  ... (${returnsDoMes.length - mostrados} registros adicionais omitidos, mesmo padrão)`);
        break;
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
