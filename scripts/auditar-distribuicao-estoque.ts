// Auditoria SOMENTE LEITURA da Distribuição de Estoque contra o banco — roda o catálogo inteiro
// (mesma função da tela, getAnaliseDistribuicaoEstoque) e imprime as contagens reconciliáveis:
// produtos, variantes, combinações esperadas × processadas, diagnósticos, falhas e pendências.
// Não grava nada em tabela nenhuma e não chama o DAPIC.
//
// Uso: npx tsx scripts/auditar-distribuicao-estoque.ts [--json caminho.json]
//
// Armadilha do CLAUDE.md (2026-10-15): script rodado fora do Next lê `.env`, não `.env.local`.
// Antes de rodar, confira os DOIS: grep DATABASE_URL .env .env.local (comparando só o host). Este
// script se recusa a rodar se a URL carregada apontar para o host de produção conhecido.
import { writeFileSync } from "fs";
import { getAnaliseDistribuicaoEstoque } from "@/lib/metrics/distribuicao-estoque-dados";
import { prisma } from "@/lib/prisma";

const HOST_PRODUCAO = "ep-green-dew-axlg84qg";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/:?]+)/)?.[1] ?? "(sem DATABASE_URL)";
  if (host.includes(HOST_PRODUCAO)) {
    throw new Error(`DATABASE_URL aponta para PRODUÇÃO (${host}). Use o Neon dev.`);
  }
  console.log(`Banco: ${host.replace(/^(ep-[a-z]+-[a-z]+).*/, "$1…")}`);

  const t0 = Date.now();
  const r = await getAnaliseDistribuicaoEstoque();
  const c = r.contagens;
  console.log(`Execução ${r.execucao.id} — ${r.execucao.status} em ${Date.now() - t0} ms (${r.execucao.lotesProcessados} lotes)`);
  console.log(`Versão dos dados: ${r.execucao.versaoDados}`);
  console.log(`Período de vendas: ${r.periodo.inicio} .. ${r.periodo.fim}`);
  console.log(`Linhas de estoque lidas: ${r.linhasEstoque}`);
  console.log(`Locais: ${r.locais.map((l) => `${l.nome}=${l.papel}`).join(", ")}`);
  console.log(`Produtos únicos: ${c.produtosUnicos}`);
  console.log(`Variantes no universo: ${c.variantesUnicas} | processadas: ${c.variantesProcessadas} | falhas: ${c.variantesComFalha} | pendentes: ${c.variantesPendentes}`);
  console.log(`Combinações variante×local: esperadas ${c.combinacoesEsperadas} | processadas ${c.combinacoesProcessadas}`);
  console.log(`Conclusivas: ${c.conclusivas} | dados insuficientes: ${c.dadosInsuficientes} | não aplicáveis: ${c.naoAplicaveis}`);
  console.log(`Por diagnóstico: ${JSON.stringify(c.porDiagnostico)}`);
  console.log(`Por confiança: ${JSON.stringify(c.porConfianca)}`);
  console.log(`Variantes com inconsistência: ${c.variantesComInconsistencia} | produtos com dado ausente/inconsistente: ${c.produtosComDadosAusentesOuInconsistentes}`);
  console.log(`Transferências sugeridas: ${c.transferenciasSugeridas} (${c.unidadesTransferiveis} un)`);
  console.log(`RECONCILIADO: ${c.reconciliado ? "SIM" : "NÃO"}`);
  if (r.execucao.falhas.length > 0) console.log(`Falhas: ${JSON.stringify(r.execucao.falhas.slice(0, 20))}`);

  const i = process.argv.indexOf("--json");
  if (i > 0 && process.argv[i + 1]) {
    writeFileSync(process.argv[i + 1], JSON.stringify({ execucao: r.execucao.id, contagens: c, transferencias: r.transferencias }, null, 2));
    console.log(`Detalhe salvo em ${process.argv[i + 1]}`);
  }
  if (!c.reconciliado || r.execucao.status !== "COMPLETA") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
