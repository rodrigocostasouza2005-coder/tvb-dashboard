// Popula a tabela Parcela com as parcelas abertas do DAPIC (/contas/parcelas, Status=Aberta).
// Idempotente — trunca e reinicia. Rodar 1x pra popular antes do próximo sync automático.
// Uso: npx tsx scripts/backfill-parcelas.ts

import { PrismaClient } from "@prisma/client";
import { createDapicClients, parseDapicDateTime } from "../src/lib/connectors/dapic";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

async function main() {
  const clients = createDapicClients();
  const cd = clients.find((c) => c.label === "cd-atacado") ?? clients[0];
  if (!cd) throw new Error("Nenhuma credencial DAPIC encontrada.");

  const dataFinal = new Date().toISOString().slice(0, 10);
  console.log(`Buscando parcelas Aberta de 2024-01-01 até ${dataFinal}...`);

  const parcelas = await cd.fetchParcelas("2024-01-01", dataFinal, "Aberta");
  console.log(`Retornadas: ${parcelas.length} parcelas`);

  await prisma.parcela.deleteMany({});
  console.log("Tabela limpa. Inserindo...");

  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < parcelas.length; i += BATCH) {
    const batch = parcelas.slice(i, i + BATCH);
    await prisma.parcela.createMany({
      data: batch.map((p) => ({
        idParcela: p.IdParcela,
        idConta: p.IdConta,
        status: p.Status,
        dataEmissao: parseDapicDateTime(p.DataEmissao),
        dataVencimento: parseDapicDateTime(p.DataVencimento),
        conta: p.Conta,
        formaPagamento: p.FormaPagamento,
        pessoa: p.Pessoa,
        numeroParcela: p.Parcela,
        valor: p.Valor,
        valorPago: p.ValorPago,
        valorAberto: p.ValorAberto,
        valorMulta: p.ValorMulta,
        valorJuros: p.ValorJuros,
        nossoNumeroBoleto: p.NossoNumeroBoleto ?? null,
        planoConta: p.PlanoConta ?? null,
      })),
      skipDuplicates: true,
    });
    count += batch.length;
    process.stdout.write(".");
  }

  const hoje = new Date();
  const vencidas = await prisma.parcela.count({ where: { dataVencimento: { lt: hoje } } });
  console.log(`\nInseridas: ${count} | Vencidas (inadimplentes): ${vencidas}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
