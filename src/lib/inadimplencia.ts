import { prisma } from "@/lib/prisma";

export type ParcelaVencida = {
  idParcela: number;
  conta: string;
  pessoa: string;
  formaPagamento: string;
  dataEmissao: Date;
  dataVencimento: Date;
  diasAtraso: number;
  valor: number;
  valorPago: number;
  valorAberto: number;
  valorMulta: number;
  valorJuros: number;
  numeroParcela: number;
  nossoNumeroBoleto: string | null;
};

export async function getInadimplencia(): Promise<{
  parcelas: ParcelaVencida[];
  totalEmAberto: number;
  totalClientes: number;
  totalParcelas: number;
}> {
  const hoje = new Date();

  const rows = await prisma.parcela.findMany({
    where: {
      status: "Aberta",
      dataVencimento: { lt: hoje },
    },
    orderBy: { dataVencimento: "asc" },
  });

  const parcelas: ParcelaVencida[] = rows.map((p) => ({
    idParcela: p.idParcela,
    conta: p.conta,
    pessoa: p.pessoa,
    formaPagamento: p.formaPagamento,
    dataEmissao: p.dataEmissao,
    dataVencimento: p.dataVencimento,
    diasAtraso: Math.floor((hoje.getTime() - p.dataVencimento.getTime()) / (1000 * 60 * 60 * 24)),
    valor: p.valor,
    valorPago: p.valorPago,
    valorAberto: p.valorAberto,
    valorMulta: p.valorMulta,
    valorJuros: p.valorJuros,
    numeroParcela: p.numeroParcela,
    nossoNumeroBoleto: p.nossoNumeroBoleto,
  }));

  // Sort: mais atrasado primeiro
  parcelas.sort((a, b) => b.diasAtraso - a.diasAtraso);

  const totalEmAberto = parcelas.reduce((s, p) => s + p.valorAberto, 0);
  const totalClientes = new Set(parcelas.map((p) => p.pessoa)).size;

  return { parcelas, totalEmAberto, totalClientes, totalParcelas: parcelas.length };
}
