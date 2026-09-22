// Backfill único (2026-09-21): popula Vendedor (1 linha por nome distinto de Sale.vendedor em
// cada loja física, ativo=true) e ClienteVendedorAtribuicao (dono persistente de cada cliente
// B2C dentro da loja onde ele mais compra). Sem isso, "Sugestão de Contato" por vendedor
// (filtro novo) não teria nenhum dado — nenhum cliente estaria atribuído a ninguém ainda.
//
// Prioridade de atribuição, por cliente:
//   1. ClienteCadastro.vendedorResponsavel, se bater com um Vendedor ativo da loja principal
//      dele (campo do DAPIC, já sincronizado, mais confiável que inferir de venda — mas só
//      24% dos cadastros têm isso preenchido).
//   2. Sale.vendedor da venda MAIS RECENTE do cliente naquela loja, se também bater com um
//      Vendedor ativo (cobre quem não tem vendedorResponsavel).
//   3. Round-robin entre os vendedores ativos da loja (cliente sem nenhum sinal de vendedor
//      nas vendas — ex: comprou só no site sem vendedor identificado).
//
// Idempotente: roda com skipDuplicates, então rodar de novo não duplica nem sobrescreve quem
// já foi atribuído (rodar de novo só preenche quem ainda não tinha).
//
// CD/Site e Atacado fica de FORA do sistema de vendedor — achado rodando a 1ª versão deste
// script: Sale.vendedor do CD praticamente só tem 1 nome (quem opera o canal online, não um
// vendedor individual de verdade), então TODO cliente sem sinal caía em cima dessa 1 pessoa
// (5.497 clientes numa rodada de teste). Não existe "vendedor" de verdade pra atribuir num
// canal de autoatendimento — login de loja única também nunca existe pro CD, então a etapa de
// seleção de vendedor nem apareceria pra esses clientes de qualquer forma.
import { prisma } from "../src/lib/prisma";
import { canalWhere } from "../src/lib/metrics";

async function main() {
  const stores = await prisma.store.findMany({ where: { sellsProducts: true, code: { not: "CD" } } });
  console.log(`Lojas: ${stores.map((s) => s.name).join(", ")}`);

  // 1) Vendedor — 1 linha por nome distinto de Sale.vendedor em cada loja.
  for (const store of stores) {
    const nomes = await prisma.sale.findMany({
      where: { storeId: store.id, vendedor: { not: null } },
      distinct: ["vendedor"],
      select: { vendedor: true },
    });
    const data = nomes.map((n) => ({ storeId: store.id, nome: n.vendedor as string }));
    const result = await prisma.vendedor.createMany({ data, skipDuplicates: true });
    console.log(`${store.name}: ${result.count} vendedores criados (de ${nomes.length} nomes distintos)`);
  }

  const vendedores = await prisma.vendedor.findMany({ where: { ativo: true } });
  const vendedorPorLojaNome = new Map<string, string>(); // `${storeId}::${nomeUpper}` -> vendedorId
  const vendedoresPorLoja = new Map<string, string[]>(); // storeId -> [vendedorId] (ordenado, pro round-robin)
  for (const v of vendedores) {
    vendedorPorLojaNome.set(`${v.storeId}::${v.nome.trim().toUpperCase()}`, v.id);
    const list = vendedoresPorLoja.get(v.storeId) ?? [];
    list.push(v.id);
    vendedoresPorLoja.set(v.storeId, list);
  }
  for (const list of vendedoresPorLoja.values()) list.sort(); // ordem estável pro round-robin

  // 2) Base de clientes B2C — mesmo filtro que Sugestão de Contato já usa (canalWhere("b2c")).
  const b2cWhere = await canalWhere("b2c");
  const rows = await prisma.sale.findMany({
    where: { ...b2cWhere, clienteNome: { not: null } },
    select: { clienteNome: true, storeId: true, quantidade: true, vendedor: true, saleDate: true },
  });
  console.log(`Linhas de venda B2C: ${rows.length}`);

  // Loja principal (mais unidades) + vendedor da venda mais recente naquela loja, por cliente.
  const porCliente = new Map<
    string,
    { nome: string; porLoja: Map<string, number>; ultimaVendaPorLoja: Map<string, { data: Date; vendedor: string | null }> }
  >();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const cur = porCliente.get(norm) ?? { nome, porLoja: new Map(), ultimaVendaPorLoja: new Map() };
    cur.porLoja.set(r.storeId, (cur.porLoja.get(r.storeId) ?? 0) + r.quantidade);
    const ultima = cur.ultimaVendaPorLoja.get(r.storeId);
    if (!ultima || r.saleDate > ultima.data) cur.ultimaVendaPorLoja.set(r.storeId, { data: r.saleDate, vendedor: r.vendedor });
    porCliente.set(norm, cur);
  }
  console.log(`Clientes B2C distintos: ${porCliente.size}`);

  const nomesClientes = [...porCliente.values()].map((c) => c.nome);
  const cadastros = await prisma.clienteCadastro.findMany({
    where: { nome: { in: nomesClientes } },
    select: { nome: true, vendedorResponsavel: true },
  });
  const respPorNome = new Map(cadastros.map((c) => [c.nome, c.vendedorResponsavel]));

  const existentes = await prisma.clienteVendedorAtribuicao.findMany({ select: { storeId: true, clienteNorm: true } });
  const jaAtribuido = new Set(existentes.map((e) => `${e.storeId}::${e.clienteNorm}`));

  const rrIndexPorLoja = new Map<string, number>();
  const novasAtribuicoes: { storeId: string; clienteNorm: string; vendedorAtualId: string }[] = [];
  const semSinalNenhum: string[] = [];

  const clientesOrdenados = [...porCliente.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [norm, c] of clientesOrdenados) {
    const lojaPrincipal = [...c.porLoja.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!lojaPrincipal) continue;
    // Só as 4 lojas físicas (sellsProducts) — descarta qualquer storeId fora dessa lista.
    if (!vendedoresPorLoja.has(lojaPrincipal)) continue;
    if (jaAtribuido.has(`${lojaPrincipal}::${norm}`)) continue;

    let vendedorId: string | undefined;
    const respNome = respPorNome.get(c.nome);
    if (respNome) vendedorId = vendedorPorLojaNome.get(`${lojaPrincipal}::${respNome.trim().toUpperCase()}`);
    if (!vendedorId) {
      const ultimaVenda = c.ultimaVendaPorLoja.get(lojaPrincipal);
      if (ultimaVenda?.vendedor) vendedorId = vendedorPorLojaNome.get(`${lojaPrincipal}::${ultimaVenda.vendedor.trim().toUpperCase()}`);
    }
    if (!vendedorId) {
      const lista = vendedoresPorLoja.get(lojaPrincipal) ?? [];
      if (lista.length === 0) continue; // loja sem nenhum vendedor conhecido — não dá pra atribuir
      const idx = rrIndexPorLoja.get(lojaPrincipal) ?? 0;
      vendedorId = lista[idx % lista.length];
      rrIndexPorLoja.set(lojaPrincipal, idx + 1);
      semSinalNenhum.push(c.nome);
    }

    novasAtribuicoes.push({ storeId: lojaPrincipal, clienteNorm: norm, vendedorAtualId: vendedorId });
  }

  console.log(`Novas atribuições a criar: ${novasAtribuicoes.length} (${semSinalNenhum.length} foram por round-robin, sem sinal de vendedor)`);

  const BATCH = 1000;
  let criadas = 0;
  for (let i = 0; i < novasAtribuicoes.length; i += BATCH) {
    const lote = novasAtribuicoes.slice(i, i + BATCH);
    const result = await prisma.clienteVendedorAtribuicao.createMany({ data: lote, skipDuplicates: true });
    criadas += result.count;
  }
  console.log(`Atribuições criadas: ${criadas}`);

  const totalAtribuicoes = await prisma.clienteVendedorAtribuicao.count();
  console.log(`Total geral de atribuições no banco: ${totalAtribuicoes}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
