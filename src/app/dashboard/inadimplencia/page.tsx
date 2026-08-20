import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { getInadimplencia } from "@/lib/inadimplencia";
import { StatTile } from "../stat-tile";
import { InadimplenciaTable } from "./inadimplencia-table";

export default async function InadimplenciaPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "inadimplencia");

  const { parcelas } = await getInadimplencia();

  // Cards mostram só Boleto (padrão da tabela = atacado/Inter)
  const boletoOnly = parcelas.filter((p) => p.formaPagamento === "Boleto");
  const totalEmAberto = boletoOnly.reduce((s, p) => s + p.valorAberto, 0);
  const totalParcelas = boletoOnly.length;
  const totalClientes = new Set(boletoOnly.map((p) => p.pessoa)).size;

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Valor em aberto (Boleto)"
          value={totalEmAberto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          status={totalEmAberto > 0 ? "critical" : "good"}
        />
        <StatTile
          label="Parcelas vencidas"
          value={String(totalParcelas)}
          status={totalParcelas > 0 ? "warning" : "good"}
        />
        <StatTile
          label="Clientes com atraso"
          value={String(totalClientes)}
          status={totalClientes > 0 ? "warning" : "good"}
        />
      </div>

      <InadimplenciaTable parcelas={parcelas} />
    </div>
  );
}
