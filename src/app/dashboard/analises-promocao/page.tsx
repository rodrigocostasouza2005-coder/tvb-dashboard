import { getSessionUser } from "@/lib/auth";
import { getPromotionRows, getPromotionRulesConfig } from "@/lib/metrics";
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
  const [rows, regrasSalvas] = await Promise.all([
    getPromotionRows({ storeIds: allowedStores, grupoIn }),
    getPromotionRulesConfig(),
  ]);

  const podeEditarRegras = user.role === "ADMIN" || user.role === "GESTAO";

  return <PromocaoClient rows={rows} regrasSalvas={regrasSalvas} podeEditarRegras={podeEditarRegras} />;
}
