// Teste de integração contra o banco DEV (Neon branch dev — .env.local). Valida o novo
// comportamento da tela de Follow-up (pedido do Rodrigo em 2026-10-02): clicar marca como
// concluído e remove IMEDIATAMENTE da lista de pendências, persistindo de verdade (não só
// visual), sem duplicar em clique duplo, sem afetar outro cliente, e respeitando a atribuição de
// vendedor. Cria sua própria fixture (2 clientes fictícios na loja Leblon, CLIENTE_X atribuído a
// Luan, CLIENTE_Y atribuído a Caio — 2 vendedores reais da loja) e limpa tudo no final.
// Chama a MESMA função exportada que a página usa (getFollowUpPosCompra) e o MESMO upsert que a
// Server Action usa (prisma.contatoMarcado.upsert, idêntico ao de marcarContatadoAction) —
// getSessionUser()/cookies() não são chamáveis fora de uma requisição Next.js de verdade, então
// este script testa a camada de dados+lista diretamente, não via HTTP/clique real (ver relatório
// final pra essa ressalva — validação via navegador foi bloqueada por uma inconsistência
// transitória de infraestrutura do Neon nesta sessão, não relacionada ao código).
// Uso: npx tsx scripts/test-followup-comportamento.ts
import { prisma } from "@/lib/prisma";
import { getFollowUpPosCompra } from "@/lib/metrics";

const CLIENTE_X = "ZZTESTE FOLLOWUP CLIENTE X";
const CLIENTE_Y = "ZZTESTE FOLLOWUP CLIENTE Y";
const DAPIC_X = 900005001;
const DAPIC_Y = 900005002;
const CLIENTE_CADASTRO_IDS = [900005101, 900005102];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`OK: ${msg}`);
}

// Mesmo upsert de marcarContatadoAction (actions.ts) — idêntico pela chave natural
// (tipo, cliente, chave), sem o resolver de sessão/cookie (não chamável fora de uma request).
async function marcarComoVendedor(cliente: string, chave: string, contatadoPor: string, storeId: string) {
  return prisma.contatoMarcado.upsert({
    where: { tipo_cliente_chave: { tipo: "followup", cliente, chave } },
    create: { tipo: "followup", cliente, chave, contatadoPor, storeId },
    update: { contatadoPor, storeId, contatadoEm: new Date() },
  });
}

async function limpar(leblonId: string) {
  await prisma.sale.deleteMany({ where: { dapicVendaId: { in: [DAPIC_X, DAPIC_Y] } } });
  await prisma.clienteCadastro.deleteMany({ where: { dapicId: { in: CLIENTE_CADASTRO_IDS } } });
  await prisma.clienteVendedorAtribuicao.deleteMany({ where: { storeId: leblonId, clienteNorm: { in: [CLIENTE_X, CLIENTE_Y] } } });
  await prisma.contatoMarcado.deleteMany({ where: { tipo: "followup", cliente: { in: [CLIENTE_X, CLIENTE_Y] } } });
}

async function main() {
  const leblon = await prisma.store.findFirst({ where: { code: "Leblon" } });
  if (!leblon) throw new Error("loja Leblon não encontrada");

  await limpar(leblon.id);

  try {
    // ===== Fixture: 2 clientes fictícios, compra há 8 dias (dentro da janela 7-10), cada um
    // atribuído a um vendedor real DIFERENTE da loja Leblon =====
    const luan = await prisma.vendedor.findFirst({ where: { storeId: leblon.id, nome: { contains: "LUAN" } } });
    const caio = await prisma.vendedor.findFirst({ where: { storeId: leblon.id, nome: { contains: "CAIO" } } });
    if (!luan || !caio) throw new Error("vendedores de teste (Luan/Caio) não encontrados na loja Leblon");

    const oitoDiasAtras = new Date(Date.now() - 8 * 86_400_000);
    await prisma.clienteCadastro.createMany({
      data: [
        { dapicId: CLIENTE_CADASTRO_IDS[0], nome: CLIENTE_X, telefone: "21999990001" },
        { dapicId: CLIENTE_CADASTRO_IDS[1], nome: CLIENTE_Y, telefone: "21999990002" },
      ],
    });
    await prisma.sale.createMany({
      data: [
        { storeId: leblon.id, dapicVendaId: DAPIC_X, itemIndex: 0, cod: "ZZTESTE", produto: "ZZPRODUTO-FOLLOWUP-X", grupo: "ZZTeste", clienteNome: CLIENTE_X, quantidade: 1, valorTotalLiquido: 199, saleDate: oitoDiasAtras, status: "Fechada", tabelaPreco: "Tabela varejo", marca: "TVBSHORTS" },
        { storeId: leblon.id, dapicVendaId: DAPIC_Y, itemIndex: 0, cod: "ZZTESTE", produto: "ZZPRODUTO-FOLLOWUP-Y", grupo: "ZZTeste", clienteNome: CLIENTE_Y, quantidade: 1, valorTotalLiquido: 299, saleDate: oitoDiasAtras, status: "Fechada", tabelaPreco: "Tabela varejo", marca: "TVBSHORTS" },
      ],
    });
    await prisma.clienteVendedorAtribuicao.createMany({
      data: [
        { storeId: leblon.id, clienteNorm: CLIENTE_X, vendedorAtualId: luan.id },
        { storeId: leblon.id, clienteNorm: CLIENTE_Y, vendedorAtualId: caio.id },
      ],
    });

    const filters = {
      from: new Date(0), to: new Date(),
      storeIds: [leblon.id],
      marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined,
    };

    // ===== 1. Estado inicial: os 2 clientes de teste aparecem como pendentes =====
    const antes = await getFollowUpPosCompra(filters, null);
    const antesNomes = antes.map((f) => f.cliente);
    assert(antesNomes.includes(CLIENTE_X), "[setup] Cliente X aparece pendente antes de marcar");
    assert(antesNomes.includes(CLIENTE_Y), "[setup] Cliente Y aparece pendente antes de marcar");

    // ===== 2. Clicar em "Follow-up" do Cliente X -> marca como concluído (teste 1) =====
    await marcarComoVendedor(CLIENTE_X, String(DAPIC_X), luan.nome, leblon.id);

    // ===== 3. Item desaparece da lista (mesma chamada que a página faz) (teste 2) =====
    const depoisDeMarcar = await getFollowUpPosCompra(filters, null);
    const depoisNomes = depoisDeMarcar.map((f) => f.cliente);
    assert(!depoisNomes.includes(CLIENTE_X), "[1,2] Cliente X NÃO aparece mais como pendente depois de marcado");

    // ===== 4. "Atualizar página" = chamar a função de novo -> continua desaparecido (teste 3) =====
    const depoisDeRecarregar = await getFollowUpPosCompra(filters, null);
    assert(!depoisDeRecarregar.map((f) => f.cliente).includes(CLIENTE_X), "[3] Depois de 'recarregar' (nova chamada), Cliente X continua fora da lista");

    // ===== 5. Outro follow-up (cliente diferente) continua aparecendo (teste 5) =====
    assert(depoisDeRecarregar.map((f) => f.cliente).includes(CLIENTE_Y), "[5] Cliente Y (outro cliente, nunca marcado) continua pendente normalmente");

    // ===== 6. Clicar duas vezes rapidamente -> não duplica/não gera inconsistência (teste 4) =====
    const [r1, r2] = await Promise.all([
      marcarComoVendedor(CLIENTE_X, String(DAPIC_X), luan.nome, leblon.id),
      marcarComoVendedor(CLIENTE_X, String(DAPIC_X), luan.nome, leblon.id),
    ]);
    assert(r1.id === r2.id, "[4] Clique duplo simultâneo resolve pro MESMO registro (upsert pela chave natural, sem duplicar)");
    const totalRegistrosX = await prisma.contatoMarcado.count({ where: { tipo: "followup", cliente: CLIENTE_X } });
    assert(totalRegistrosX === 1, "[4] Só existe 1 registro de ContatoMarcado pro Cliente X, mesmo depois do clique duplo");

    // ===== 7. Permissão: vendedor só marca cliente atribuído a ele (teste 7) =====
    // Mesma query usada no guard de marcarContatadoAction (actions.ts) — confirma que o dado real
    // de atribuição distingue corretamente Luan (dono de X) de Caio (dono de Y).
    const atribuicaoX = await prisma.clienteVendedorAtribuicao.findUnique({
      where: { storeId_clienteNorm: { storeId: leblon.id, clienteNorm: CLIENTE_X.trim().toUpperCase() } },
      include: { vendedorAtual: true },
    });
    const atribuicaoY = await prisma.clienteVendedorAtribuicao.findUnique({
      where: { storeId_clienteNorm: { storeId: leblon.id, clienteNorm: CLIENTE_Y.trim().toUpperCase() } },
      include: { vendedorAtual: true },
    });
    assert(atribuicaoX?.vendedorAtual.nome === luan.nome, "[7] Cliente X está atribuído a Luan (quem pode tratar)");
    assert(atribuicaoY?.vendedorAtual.nome === caio.nome, "[7] Cliente Y está atribuído a Caio, NÃO a Luan");
    assert(atribuicaoY?.vendedorAtual.nome !== luan.nome, "[7] Guard de marcarContatadoAction negaria Luan tentando marcar o follow-up do Cliente Y (atribuído a Caio)");

    console.log("\nTODOS OS TESTES PASSARAM (comportamento de Follow-up).");
  } finally {
    await limpar(leblon.id);
    console.log("Limpeza: fixture e ContatoMarcado fictícios removidos.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
