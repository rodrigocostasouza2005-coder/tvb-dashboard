import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.atacadoProspect.findMany({
    where: { nomeFantasia: "ZINZANE", cidade: "RIO DE JANEIRO" },
    select: { id: true, cnpjRaiz: true, enderecoOficial: true, createdAt: true, origem: true },
  });
  const porRaiz = new Map<string, number>();
  for (const r of rows) {
    const k = r.cnpjRaiz ?? "(null)";
    porRaiz.set(k, (porRaiz.get(k) ?? 0) + 1);
  }
  console.log(`Total linhas ZINZANE/RJ: ${rows.length}`);
  console.log(`CNPJ-raiz distintos: ${porRaiz.size}`);
  for (const [raiz, count] of porRaiz) console.log(`  raiz ${raiz}: ${count} linha(s)`);
  const enderecos = new Set(rows.map((r) => r.enderecoOficial ?? "(null)"));
  console.log(`Endereços distintos: ${enderecos.size}`);
  const origens = new Set(rows.map((r) => r.origem));
  console.log(`Origens: ${[...origens].join(", ")}`);
}
main().finally(() => prisma.$disconnect());
