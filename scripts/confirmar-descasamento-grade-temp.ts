/**
 * Confirmação SOMENTE LEITURA, mínima e pontual — testa a previsão exata do mecanismo
 * identificado para o achado §16.3 (26/280 produtos com excesso+ruptura sem oportunidade de
 * transferência): por COD (cor+tamanho), o cod em ruptura numa loja nunca tem o próprio CD/Site em
 * excesso, e o cod com CD/Site em excesso nunca tem nenhuma loja em ruptura — é descasamento de
 * grade de tamanho entre cods do mesmo produto, não um bug no motor de transferência.
 *
 * Uso: npx tsx scripts/confirmar-descasamento-grade-temp.ts
 */
import { getComparacaoCompleta, construirOrigem } from "@/lib/metrics";
import { prisma } from "@/lib/prisma";

const PRODUTOS = ["Classic Black", "High Five Jungle", "High Five Black"];

async function main() {
  for (const produto of PRODUTOS) {
    console.log(`\n=== ${produto} ===`);
    const { variantes } = await getComparacaoCompleta({ busca: produto });
    const exato = variantes.filter((v) => v.produto === produto);
    for (const v of exato) {
      for (const l of v.porLoja) {
        const disponivel = construirOrigem(l).disponivel;
        const sinal =
          l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica"
            ? "RUPTURA"
            : (l.diagnostico === "cobertura_excessiva" || l.diagnostico === "estoque_parado") && disponivel > 0
              ? "EXCESSO"
              : "-";
        if (sinal !== "-") {
          console.log(`  cod=${v.cod} cor=${v.cor} tamanho=${v.tamanho} posicao=${l.storeName}(${l.tipoPosicao}) diagnostico=${l.diagnostico} disponivel=${disponivel} => ${sinal}`);
        }
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
