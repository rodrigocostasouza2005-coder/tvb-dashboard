// Importação da meta diária de faturamento + real 2025 da Black Friday (planilha "Plano BF
// 2026.xlsx" do Rodrigo) pra MetaDiariaBlackFriday — pedido em 2026-11-06 ("só o periodo da
// black"), pra alimentar o painel "Meta vs. Real" na Central Black Friday (ver
// getComparativoMetaDiariaBlackFriday em src/lib/metrics/black-friday.ts). Mesma convenção de
// scripts/black-friday/importar-precos.ts (não é cron/build: ocasional, roda manualmente quando
// o Rodrigo atualiza a planilha; idempotente via upsert por `data`, seguro rodar de novo).
//
// "xlsx" (SheetJS) tem a mesma vulnerabilidade conhecida sem correção já documentada em
// importar-precos.ts (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) — mesma convenção: devDependency
// só por causa desses scripts, nunca importada por src/, só usar com arquivo de origem confiável.
//
// Grain real confirmado (parse da planilha em 2026-11-06): 30 linhas de dia (não 31 — a planilha
// cobre 2026-11-01 a 2026-11-30, não 10/Nov a 10/Dec como uma auditoria anterior tinha descrito;
// os totais batem exatos com o que foi confirmado antes: meta 2026 R$1.300.000, real 2025
// R$861.789,12 — então é o arquivo certo, só a janela de datas estava errada na descrição).
// Formato real: duas tabelas lado a lado na mesma linha (colunas 0-8 = bloco 2026: Dia da Semana,
// Data, Valor, Ação, Segmentação, E-mail Mkt/Whatsapp/SMS, Instagram/TikTok, Mídia Paga, Lojas;
// colunas 9-13 = bloco 2025: Dia da Semana, Data, Valor, Ação, %participação). Lidas por ÍNDICE
// de coluna (não pelo texto do header) porque "Dia da Semana"/"Data"/"Valor" se repetem nos dois
// blocos e colidiriam como chave de objeto num sheet_to_json normal.
//
// Uso: npx tsx scripts/black-friday/importar-meta-diaria.ts ["<caminho do xlsx>"]
// Sem argumento, usa o caminho padrão do Desktop do Rodrigo (só convenção local, não existe em CI).
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { upsertMetaDiariaBlackFriday, type MetaDiariaBlackFridayInput } from "../../src/lib/meta-diaria-black-friday";

// upsertMetaDiariaBlackFriday usa seu próprio client (src/lib/prisma) — essa instância aqui serve
// só pro count()/disconnect() finais deste script.
const prisma = new PrismaClient();

const DEFAULT_PATH = path.join("C:", "Users", "Dell", "Desktop", "CLAUDE", "Plano BF 2026.xlsx");

// Índices de coluna do bloco 2026 (0-indexado) — ver comentário do topo do arquivo.
const COL_DATA_2026 = 1;
const COL_VALOR_2026 = 2;
const COL_ACAO_2026 = 3;
const COL_SEGMENTACAO = 4;
const COL_EMAIL_WHATSAPP_SMS = 5;
const COL_INSTAGRAM_TIKTOK = 6;
const COL_MIDIA_PAGA = 7;
const COL_LOJAS = 8;
// Bloco 2025 (comparativo real, já encerrado — não tem "meta", só o que aconteceu).
const COL_VALOR_2025 = 11;
const COL_ACAO_2025 = 12;
const COL_PARTICIPACAO_2025 = 13;

type LinhaPlanilha = unknown[];

// Normaliza uma célula numérica: número real -> número; vazio/null/não-finito -> null (honesto,
// nunca inventa 0 — mesma convenção de numeroOuNull em importar-precos.ts).
function numeroOuNull(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

// Normaliza uma célula de texto: string vazia/null/whitespace-only -> null (a planilha real tem
// células só com um espaço " " em vez de vazias de verdade, ver linha 9/15 do grain confirmado).
function textoOuNull(valor: unknown): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === "" ? null : s;
}

// Célula de data já convertida pra Date (XLSX.readFile com cellDates:true) -> "YYYY-MM-DD".
// Usa os componentes UTC da Date, não um timeZone explícito: o serial do Excel chega com um
// resíduo de poucos segundos (ruído de ponto flutuante, ex. "03:00:28Z" em vez de "00:00:00Z"
// exato) que nunca cruza a virada de dia — ler em UTC direto é seguro e evita reintroduzir esse
// resíduo via conversão de fuso (mesmo tipo de cuidado de fuso documentado em lib/filters.ts,
// aplicado aqui de forma mais simples porque a única garantia que precisamos é "não mudar de dia").
function dataCelulaToStr(valor: unknown): string | null {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return null;
  const y = valor.getUTCFullYear();
  const m = String(valor.getUTCMonth() + 1).padStart(2, "0");
  const d = String(valor.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parsePlanilha(linhas: LinhaPlanilha[]): {
  validas: MetaDiariaBlackFridayInput[];
  ignoradas: number;
} {
  const validas: MetaDiariaBlackFridayInput[] = [];
  let ignoradas = 0;

  // Pula a linha 0 (header) — quem chama já deve ter removido, mas defensivo aqui também não
  // custa nada (uma linha sem Data válida vira "ignorada" de qualquer forma).
  for (const linha of linhas) {
    const dataStr = dataCelulaToStr(linha[COL_DATA_2026]);
    const metaReceita2026 = numeroOuNull(linha[COL_VALOR_2026]);
    // Linha sem Data ou sem Valor de meta não é um dia de campanha de verdade (header, linha de
    // total, linha em branco) — ignorada, nunca importada como zero fabricado.
    if (!dataStr || metaReceita2026 == null) {
      ignoradas++;
      continue;
    }

    const canais = {
      segmentacao: textoOuNull(linha[COL_SEGMENTACAO]),
      emailMktWhatsappSms: textoOuNull(linha[COL_EMAIL_WHATSAPP_SMS]),
      instagramTiktok: textoOuNull(linha[COL_INSTAGRAM_TIKTOK]),
      midiaPaga: textoOuNull(linha[COL_MIDIA_PAGA]),
      lojas: textoOuNull(linha[COL_LOJAS]),
      acao2025: textoOuNull(linha[COL_ACAO_2025]),
      participacao2025: numeroOuNull(linha[COL_PARTICIPACAO_2025]),
    };

    validas.push({
      data: dataStr,
      metaReceita2026,
      receitaReal2025: numeroOuNull(linha[COL_VALOR_2025]),
      acao: textoOuNull(linha[COL_ACAO_2026]),
      canais,
    });
  }

  return { validas, ignoradas };
}

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_PATH;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const primeiraAba = wb.SheetNames[0];
  const todasLinhas: LinhaPlanilha[] = XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], {
    header: 1,
    defval: null,
    raw: true,
  });
  // Primeira linha é o header das duas tabelas lado a lado — nunca é um dia de campanha.
  const linhas = todasLinhas.slice(1);

  const { validas, ignoradas } = parsePlanilha(linhas);
  const semReal2025 = validas.filter((v) => v.receitaReal2025 == null).length;

  const { criadas, atualizadas } = await upsertMetaDiariaBlackFriday(validas);

  const total = await prisma.metaDiariaBlackFriday.count();
  const datas = validas.map((v) => v.data).sort();
  console.log(`Linhas na planilha (sem header): ${linhas.length} | válidas: ${validas.length} | ignoradas (sem Data/Valor meta): ${ignoradas}`);
  console.log(`Criadas: ${criadas} | atualizadas: ${atualizadas} | sem real 2025 na planilha: ${semReal2025}`);
  console.log(`Janela de datas importada: ${datas[0] ?? "—"} a ${datas[datas.length - 1] ?? "—"}`);
  console.log(`Total de linhas em MetaDiariaBlackFriday agora: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
