import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { canSeeFinancials } from "@/lib/permissions";
import { getInadimplencia } from "@/lib/inadimplencia";
import { StatTile } from "../stat-tile";
import { InadimplenciaTable } from "./inadimplencia-table";

export default async function InadimplenciaPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "inadimplencia");
  // Achado na auditoria de 2026-09-02: a aba inteira é sobre dinheiro (valor em aberto, boletos
  // vencidos) — diferente das outras abas, não tem conteúdo não-financeiro pra mostrar, então
  // bloqueia a página inteira pra quem não tem "Ver valores financeiros" em vez de esconder card
  // por card.
  if (!canSeeFinancials(user)) redirect("/dashboard");

  const { parcelas } = await getInadimplencia();

  // Cards mostram só atacado B2B (planoConta 4.1.4 = clientes atacado Inter)
  const boletoOnly = parcelas.filter((p) => p.planoConta === "4.1.4");
  const totalEmAberto = boletoOnly.reduce((s, p) => s + p.valorAberto, 0);
  const totalParcelas = boletoOnly.length;
  const totalClientes = new Set(boletoOnly.map((p) => p.pessoa)).size;

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Valor em aberto (Atacado)"
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
