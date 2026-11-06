// Importação dos preços/descontos REAIS da Black Friday (planilha "Preços Black Friday.xlsx" do
// Rodrigo) pra PrecoBlackFriday — pedido em 2026-11-06, pra alimentar o painel "vendas por faixa
// de desconto" na Central Black Friday (ver getVendasPorFaixaDesconto em
// src/lib/metrics/black-friday.ts). Não é cron/build: ocasional, roda manualmente quando o
// Rodrigo atualiza a planilha. Idempotente (upsert por grupo+produto) — seguro rodar de novo.
//
// "xlsx" (SheetJS) tem vulnerabilidade conhecida sem correção (prototype pollution / ReDoS ao
// PARSEAR um arquivo malicioso — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). Mesma convenção já
// usada em scripts/import-minimos-excel.ts: mantida como devDependency só por causa desses
// scripts (nunca importada por src/, não roda em produção). Só usar com arquivo .xlsx de origem
// confiável (o próprio Rodrigo).
//
// Grain real confirmado (parse da planilha em 2026-11-06): 218 linhas, uma por Grupo+Produto,
// sem duplicata de chave. Colunas: Grupo, Produto, Coleção, Preço, Desconto (fração decimal),
// "Preço c/ Desc.". Faixas de desconto distintas encontradas: 0, 0.1, 0.15, 0.2, 0.3, 0.4, 0.45
// (7 faixas, não um range contínuo). 2 linhas (grupo "Code") têm "Preço" vazio/zero — importadas
// com precoCheio/precoComDesconto null em vez de inventar 0 (ver comentário no model, schema.prisma).
//
// Uso: npx tsx scripts/black-friday/importar-precos.ts ["<caminho do xlsx>"]
// Sem argumento, usa o caminho padrão do Desktop do Rodrigo (só convenção local, não existe em CI).
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { upsertPrecosBlackFriday } from "../../src/lib/precos-black-friday";

// upsertPrecosBlackFriday usa seu próprio client (src/lib/prisma) — essa instância aqui serve só
// pro count()/disconnect() finais deste script.
const prisma = new PrismaClient();

const DEFAULT_PATH = path.join("C:", "Users", "Dell", "Desktop", "CLAUDE", "Preços Black Friday.xlsx");

type LinhaPlanilha = {
  Grupo?: unknown;
  Produto?: unknown;
  "Coleção"?: unknown;
  "Preço"?: unknown;
  Desconto?: unknown;
  "Preço c/ Desc."?: unknown;
};

// Normaliza uma célula numérica da planilha: número real -> número; vazio/null/0-sem-preço-cheio
// vira null (honesto, nunca inventa 0 — ver comentário do model). `undefined`/`null`/string vazia
// contam como ausente; 0 só é aceito quando `allowZero` (Desconto=0 é um valor real e válido).
function numeroOuNull(valor: unknown, allowZero: boolean): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return null;
  if (n === 0 && !allowZero) return null;
  return n;
}

export function parsePlanilha(linhas: LinhaPlanilha[]): {
  validas: { grupo: string; produto: string; colecao: string | null; precoCheio: number | null; desconto: number; precoComDesconto: number | null }[];
  ignoradas: number;
} {
  const validas: ReturnType<typeof parsePlanilha>["validas"] = [];
  let ignoradas = 0;

  for (const linha of linhas) {
    const grupo = String(linha.Grupo ?? "").trim();
    const produto = String(linha.Produto ?? "").trim();
    const descontoRaw = numeroOuNull(linha.Desconto, true);
    if (!grupo || !produto || descontoRaw == null) {
      ignoradas++;
      continue;
    }
    const colecaoRaw = linha["Coleção"];
    const colecao = colecaoRaw != null && String(colecaoRaw).trim() !== "" ? String(colecaoRaw).trim() : null;
    const precoCheio = numeroOuNull(linha["Preço"], false);
    const precoComDesconto = numeroOuNull(linha["Preço c/ Desc."], false);

    validas.push({ grupo, produto, colecao, precoCheio, desconto: descontoRaw, precoComDesconto });
  }

  return { validas, ignoradas };
}

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_PATH;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const wb = XLSX.readFile(filePath);
  const primeiraAba = wb.SheetNames[0];
  const linhas: LinhaPlanilha[] = XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { defval: null });

  const { validas, ignoradas } = parsePlanilha(linhas);
  const semPrecoCheio = validas.filter((v) => v.precoCheio == null).length;

  const { criadas, atualizadas } = await upsertPrecosBlackFriday(validas);

  const total = await prisma.precoBlackFriday.count();
  console.log(`Linhas na planilha: ${linhas.length} | válidas: ${validas.length} | ignoradas (sem grupo/produto/desconto): ${ignoradas}`);
  console.log(`Criadas: ${criadas} | atualizadas: ${atualizadas} | sem Preço cheio na planilha: ${semPrecoCheio}`);
  console.log(`Total de linhas em PrecoBlackFriday agora: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
