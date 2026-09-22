// Backfill de ContatoMarcado.storeId pros registros que já existiam antes dessa coluna (ver
// prisma/schema.prisma). Resolve por contatadoPor -> Vendedor.nome, só quando o nome é único
// numa loja só (nome ambíguo entre lojas, ou nome que não bate com nenhum Vendedor — como login
// multi-loja "atendimento" registrando via fallback — fica null de propósito, não dá pra
// confirmar a loja). Achado pelo Rodrigo em 2026-09-22.
import { prisma } from "../src/lib/prisma";

async function main() {
  const vendedores = await prisma.vendedor.findMany({ select: { nome: true, storeId: true } });
  const porNome = new Map<string, Set<string>>();
  for (const v of vendedores) {
    const set = porNome.get(v.nome) ?? new Set<string>();
    set.add(v.storeId);
    porNome.set(v.nome, set);
  }

  const semStoreId = await prisma.contatoMarcado.findMany({
    where: { storeId: null },
    select: { contatadoPor: true },
    distinct: ["contatadoPor"],
  });

  let atualizados = 0;
  let ignorados = 0;
  for (const { contatadoPor } of semStoreId) {
    const stores = porNome.get(contatadoPor);
    if (!stores || stores.size !== 1) {
      ignorados++;
      continue;
    }
    const [storeId] = stores;
    const r = await prisma.contatoMarcado.updateMany({
      where: { contatadoPor, storeId: null },
      data: { storeId },
    });
    atualizados += r.count;
    console.log(`  ${contatadoPor} -> storeId ${storeId} (${r.count} registros)`);
  }

  console.log(`\nTotal atualizado: ${atualizados} | nomes ignorados (ambíguo ou sem match): ${ignorados}`);
}

main().finally(() => prisma.$disconnect());
