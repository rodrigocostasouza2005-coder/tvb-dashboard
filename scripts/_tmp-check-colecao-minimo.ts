import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// So leitura. Investiga reclamacao do Rodrigo: "so bestsellers aparecem pra colocar minimo?" --
// getEstoqueMinimoManual nao filtra por colecao no codigo, mas quero confirmar com dado real se o
// RESULTADO na pratica acaba parecendo so-Best-Seller por outro motivo (ex: Drop sem estoque atual
// nao gera StockSnapshot, ou tem poucos produtos Drop com posicao positiva).
(async () => {
  const todasLinhas = await prisma.stockSnapshot.findMany({
    select: { cod: true, produto: true, colecao: true, quantidadeDisponivel: true },
  });
  console.log(`Total linhas StockSnapshot: ${todasLinhas.length}`);

  const produtosPorColecaoBucket = new Map<string, Set<string>>();
  const codsPorColecaoBucket = new Map<string, Set<string>>();
  for (const r of todasLinhas) {
    const bucket = r.colecao === "BESTSELLER" ? "BESTSELLER" : (r.colecao ?? "(sem colecao)");
    if (!produtosPorColecaoBucket.has(bucket)) produtosPorColecaoBucket.set(bucket, new Set());
    if (!codsPorColecaoBucket.has(bucket)) codsPorColecaoBucket.set(bucket, new Set());
    produtosPorColecaoBucket.get(bucket)!.add(r.produto);
    codsPorColecaoBucket.get(bucket)!.add(r.cod);
  }

  console.log("\n--- Por coleção (TODAS as linhas de StockSnapshot, independente de estoque>0) ---");
  for (const [bucket, produtos] of produtosPorColecaoBucket) {
    console.log(`  ${bucket}: ${produtos.size} produtos distintos, ${codsPorColecaoBucket.get(bucket)!.size} cods distintos`);
  }

  // Agora só os que têm estoque disponível > 0 em ALGUMA posição -- é esse universo que
  // getComparacaoCompleta/latestStockSnapshots realmente usa (cods vistos).
  const comEstoque = todasLinhas.filter((r) => r.quantidadeDisponivel > 0);
  const produtosComEstoquePorBucket = new Map<string, Set<string>>();
  for (const r of comEstoque) {
    const bucket = r.colecao === "BESTSELLER" ? "BESTSELLER" : (r.colecao ?? "(sem colecao)");
    if (!produtosComEstoquePorBucket.has(bucket)) produtosComEstoquePorBucket.set(bucket, new Set());
    produtosComEstoquePorBucket.get(bucket)!.add(r.produto);
  }
  console.log("\n--- Por coleção, SÓ onde quantidadeDisponivel > 0 em alguma posição ---");
  for (const [bucket, produtos] of produtosComEstoquePorBucket) {
    console.log(`  ${bucket}: ${produtos.size} produtos distintos com estoque > 0`);
  }

  await prisma.$disconnect();
})();
