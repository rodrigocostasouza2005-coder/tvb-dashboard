import { getSessionUser } from "@/lib/auth";
import { getPromotionRows } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { PromocaoClient } from "./promocao-client";

export default async function AnalisesPromocaoPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "analises-promocao");

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  // Consolidado (todas as lojas permitidas) — filtro por loja específica fica pra uma próxima
  // rodada (a granularidade atual da análise é Grupo+Produto+Coleção, sem quebra por loja ainda).
  // allowedStores vazio é default-deny de propósito (restrito a nada) — nunca vira "undefined"
  // (que significaria "sem restrição", o oposto do pretendido).
  const rows = await getPromotionRows({ storeIds: allowedStores, grupoIn });

  return <PromocaoClient rows={rows} />;
}
