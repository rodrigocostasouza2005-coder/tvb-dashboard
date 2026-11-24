import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// So leitura. Investiga pedido do Rodrigo: "nao pode ficar sem colecao um produto" -- antes de
// qualquer correcao, preciso entender O QUE SAO os produtos sem colecao (bug de sync? categoria
// que nao se aplica? SKU antigo/descontinuado?).
(async () => {
  const semColecao = await prisma.stockSnapshot.findMany({
    where: { colecao: null },
    select: { cod: true, produto: true, grupo: true, quantidadeDisponivel: true, storeId: true },
    distinct: ["cod"],
  });
  console.log(`Total cods com colecao=null: ${semColecao.length}`);

  // Pra cada um desses cods, ver se ALGUMA OUTRA posicao do MESMO cod tem colecao preenchida
  // (ruido de sync por loja, mesmo padrao ja encontrado no caso Best Seller) vs se e null em
  // TODAS as posicoes (produto genuinamente sem colecao cadastrada no DAPIC).
  const cods = semColecao.map((s) => s.cod);
  const todasPosicoes = await prisma.stockSnapshot.findMany({
    where: { cod: { in: cods } },
    select: { cod: true, colecao: true, storeId: true },
  });
  const colecaoPorCod = new Map<string, Set<string | null>>();
  for (const p of todasPosicoes) {
    if (!colecaoPorCod.has(p.cod)) colecaoPorCod.set(p.cod, new Set());
    colecaoPorCod.get(p.cod)!.add(p.colecao);
  }

  let totalmenteNulo = 0;
  let parcialmenteNulo = 0;
  const exemplosParcial: { cod: string; produto: string; colecoes: (string | null)[] }[] = [];
  for (const s of semColecao) {
    const colecoes = [...(colecaoPorCod.get(s.cod) ?? [])];
    const temAlgumaPreenchida = colecoes.some((c) => c != null);
    if (temAlgumaPreenchida) {
      parcialmenteNulo++;
      if (exemplosParcial.length < 10) exemplosParcial.push({ cod: s.cod, produto: s.produto, colecoes });
    } else {
      totalmenteNulo++;
    }
  }
  console.log(`\nCods onde TODAS as posições têm colecao=null: ${totalmenteNulo}`);
  console.log(`Cods onde ALGUMA posição tem colecao preenchida (ruído de sync, igual achado do Best Seller): ${parcialmenteNulo}`);
  if (exemplosParcial.length > 0) {
    console.log("\nExemplos de ruído (cod: colecoes vistas entre posições):");
    for (const e of exemplosParcial) console.log(`  ${e.cod} (${e.produto}): ${JSON.stringify(e.colecoes)}`);
  }

  // Grupo/produto dos totalmente-nulos -- pra ver se é uma categoria específica (ex: Brinde,
  // Acessório) ou produtos de verdade espalhados.
  const totalmenteNulosLista = semColecao.filter((s) => {
    const colecoes = [...(colecaoPorCod.get(s.cod) ?? [])];
    return !colecoes.some((c) => c != null);
  });
  const porGrupo = new Map<string, number>();
  for (const s of totalmenteNulosLista) porGrupo.set(s.grupo, (porGrupo.get(s.grupo) ?? 0) + 1);
  console.log("\n--- Totalmente sem colecao, por grupo ---");
  for (const [grupo, n] of [...porGrupo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${grupo}: ${n} cods`);
  }

  console.log("\n--- Amostra de 15 produtos totalmente sem colecao ---");
  for (const s of totalmenteNulosLista.slice(0, 15)) {
    console.log(`  cod=${s.cod} produto="${s.produto}" grupo="${s.grupo}" disponivel=${s.quantidadeDisponivel}`);
  }

  await prisma.$disconnect();
})();
