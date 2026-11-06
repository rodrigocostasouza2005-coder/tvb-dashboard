import { prisma } from "@/lib/prisma";
import { todayBrasiliaStr, defaultRecentRangeStr } from "@/lib/filters";

// Janela automática do banner "É BLACK FRIDAYYYYYYY!!!!!!!" — pedido do Rodrigo em 2026-11-05.
// Fixa no código (não editável pelo admin, de propósito). Mesma convenção de brasiliaDayStart em
// lib/filters.ts: constrói o instante já com o offset de Brasília explícito no ISO string (-03:00)
// em vez de deixar o JS assumir UTC — Brasil não observa horário de verão desde 2019, então o
// offset fixo é seguro. Isso garante que "06:00 em Brasília" vira o MESMO instante UTC
// (2026-11-10T09:00:00.000Z) não importa o fuso/relógio do navegador de quem acessa.
export const BANNER_INICIO_BRT = new Date("2026-11-10T06:00:00.000-03:00");
export const BANNER_FIM_BRT = new Date("2026-12-01T06:00:00.000-03:00");

export type ModoManual = "ATIVO" | "INATIVO" | null;

export type BannerStatus = {
  visible: boolean;
  // Rótulo pro indicador de status no Admin (ver spec: "Automático (fora do período)" /
  // "Forçado ATIVO (manual)" / "Forçado INATIVO (manual)" / "Automático (dentro do período)").
  label: string;
};

// Janela automática pura (sem DB, sem Date.now() implícito) — testável isoladamente e reusável
// tanto pelo componente quanto pelos testes unitários do enunciado (entrada 2026-11-10 06:00 BRT,
// saída 2026-12-01 06:00 BRT).
export function isWithinAutomaticWindow(now: Date): boolean {
  return now.getTime() >= BANNER_INICIO_BRT.getTime() && now.getTime() < BANNER_FIM_BRT.getTime();
}

// Resolve visibilidade final: override manual (se houver) sempre vence a janela automática —
// é um override TEMPORÁRIO de propósito (pedido do Rodrigo), nunca uma mudança de data. Desativar
// o override (modoManual = null) volta a respeitar a janela automática de verdade, então nunca
// "vaza" e deixa o banner ligado depois de 2026-12-01 só porque alguém esqueceu de desligar.
export function resolveBannerVisibility(modoManual: ModoManual, now: Date): BannerStatus {
  if (modoManual === "ATIVO") return { visible: true, label: "Forçado ATIVO (manual)" };
  if (modoManual === "INATIVO") return { visible: false, label: "Forçado INATIVO (manual)" };
  const dentro = isWithinAutomaticWindow(now);
  return {
    visible: dentro,
    label: dentro ? "Automático (dentro do período)" : "Automático (fora do período)",
  };
}

const BANNER_CONFIG_ID = "global";

export async function getBannerModoManual(): Promise<ModoManual> {
  const record = await prisma.blackFridayBannerConfig.findUnique({ where: { id: BANNER_CONFIG_ID } });
  return (record?.modoManual as ModoManual) ?? null;
}

// Status completo pronto pro componente renderizar — já resolve o `now` real (Brasília é só um
// detalhe de exibição; o instante UTC é o mesmo em qualquer fuso, ver comentário das constantes).
export async function getBannerStatus(): Promise<BannerStatus> {
  const modoManual = await getBannerModoManual();
  return resolveBannerVisibility(modoManual, new Date());
}

// Pedido do Rodrigo (2026-11-06): a partir do dia real de início da campanha (BANNER_INICIO_BRT,
// 10/11/2026), o filtro PADRÃO da Central Black Friday passa a começar sempre em 10/11/2026 —
// não mais "últimos 30 dias" — porque o que importa a partir daí é o desempenho da campanha
// inteira, não uma janela rolante. Antes da data real, continua "últimos 30 dias" (a regra só
// entra em vigor na data real, não retroage pra hoje). Só afeta o VALOR PADRÃO — se o usuário já
// escolheu um período manualmente (query string), isso sempre tem prioridade (ver black-
// friday/page.tsx). Específico desta página — nenhuma outra aba do Radar muda de regra.
//
// Pura (testável sem Date.now() implícito) — mesmo padrão de isWithinAutomaticWindow acima.
export function defaultFiltroBlackFridayStrPura(now: Date): { from: string; to: string } {
  const hojeStr = todayBrasiliaStr(now);
  const inicioStr = todayBrasiliaStr(BANNER_INICIO_BRT);
  return hojeStr >= inicioStr ? { from: inicioStr, to: hojeStr } : defaultRecentRangeStr(30);
}

// Resolve o `now` real — chamada direto da página (Server Component, que não pode chamar
// `new Date()` por conta própria, eslint react-hooks/purity) — mesmo padrão de getBannerStatus().
export function defaultFiltroBlackFridayStr(): { from: string; to: string } {
  return defaultFiltroBlackFridayStrPura(new Date());
}

export async function setBannerModoManual(modoManual: ModoManual, updatedByEmail: string | null): Promise<void> {
  await prisma.blackFridayBannerConfig.upsert({
    where: { id: BANNER_CONFIG_ID },
    create: { id: BANNER_CONFIG_ID, modoManual, updatedByEmail },
    update: { modoManual, updatedByEmail },
  });
}
