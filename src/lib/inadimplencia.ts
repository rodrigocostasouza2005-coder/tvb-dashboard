import { unstable_cache } from "next/cache";
import { getCredentials, DapicClient, parseDapicDateTime } from "@/lib/connectors/dapic";

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

async function fetchInadimplencia() {
  const creds = getCredentials();
  if (creds.length === 0) {
    return { parcelas: [] as ParcelaVencida[], totalEmAberto: 0, totalClientes: 0, totalParcelas: 0 };
  }

  const client = new DapicClient(creds[0].tokenIntegracao, creds[0].label);

  const hoje = new Date();
  const dataFinal = hoje.toISOString().slice(0, 10);
  // 2024-01-01 cobre inadimplências ativas relevantes sem buscar 6 anos de histórico
  const dataInicial = "2024-01-01";

  // A API aceita Status=Aberta como parâmetro — reduz o volume de dados transferido
  const raw = await client.fetchParcelas(dataInicial, dataFinal, "Aberta");

  const parcelas: ParcelaVencida[] = [];
  for (const p of raw) {
    if (p.Status !== "Aberta") continue;
    const vencimento = parseDapicDateTime(p.DataVencimento);
    if (vencimento >= hoje) continue;
    const diasAtraso = Math.floor(
      (hoje.getTime() - vencimento.getTime()) / (1000 * 60 * 60 * 24)
    );
    parcelas.push({
      idParcela: p.IdParcela,
      conta: p.Conta,
      pessoa: p.Pessoa,
      formaPagamento: p.FormaPagamento,
      dataEmissao: parseDapicDateTime(p.DataEmissao),
      dataVencimento: vencimento,
      diasAtraso,
      valor: p.Valor,
      valorPago: p.ValorPago,
      valorAberto: p.ValorAberto,
      valorMulta: p.ValorMulta,
      valorJuros: p.ValorJuros,
      numeroParcela: p.Parcela,
      nossoNumeroBoleto: p.NossoNumeroBoleto,
    });
  }

  parcelas.sort((a, b) => b.diasAtraso - a.diasAtraso);

  const totalEmAberto = parcelas.reduce((s, p) => s + p.valorAberto, 0);
  const totalClientes = new Set(parcelas.map((p) => p.pessoa)).size;

  return { parcelas, totalEmAberto, totalClientes, totalParcelas: parcelas.length };
}

// Cache de 5 minutos — evita rebuscar na API a cada page load
export const getInadimplencia = unstable_cache(
  fetchInadimplencia,
  ["inadimplencia-atacado"],
  { revalidate: 300 }
);
