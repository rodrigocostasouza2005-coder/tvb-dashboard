import { prisma } from "@/lib/prisma";
import { getB2BClienteNomes } from "./core";

export type DataQualitySummary = {
  devolucoesSemColecao: number;
  devolucoesTotal: number;
  vendasSemClassificacao: number;
  vendasTotal: number;
};

// Números calculados ao vivo contra o banco — nunca hardcoded. Pedido do Rodrigo em 2026-10-01
// (auditoria de Data Quality): os valores observados numa auditoria pontual mudam assim que o
// dado é corrigido, então essa função é o jeito de confirmar o estado real a qualquer momento,
// não um snapshot congelado.
export async function getDataQualitySummary(): Promise<DataQualitySummary> {
  const [devolucoesSemColecao, devolucoesTotal, vendasTotal, b2bClientes] = await Promise.all([
    prisma.return.count({ where: { colecao: null } }),
    prisma.return.count(),
    prisma.sale.count(),
    getB2BClienteNomes(),
  ]);

  // "Sem classificação" = classifySaleChannel devolveria DESCONHECIDO: sem tabelaPreco E sem
  // nenhum sinal de cliente (histórico de Tabela atacado ou CNPJ) que permita inferir o canal.
  // Não existe índice único pra isso em SQL puro (precisa checar o array de clientes conhecidos),
  // então filtra em duas etapas: busca candidatos (tabelaPreco null) e exclui quem bate com
  // algum nome do set de B2B — mesma regra de classifySaleChannel, sem reimplementar em SQL.
  const vendasSemTabela = await prisma.sale.findMany({
    where: { tabelaPreco: null },
    select: { clienteNome: true },
  });
  const vendasSemClassificacao = vendasSemTabela.filter(
    (s) => !s.clienteNome || !b2bClientes.has(s.clienteNome)
  ).length;

  return { devolucoesSemColecao, devolucoesTotal, vendasSemClassificacao, vendasTotal };
}
