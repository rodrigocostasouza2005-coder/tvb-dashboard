import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Rede de segurança: não importa se o teste passa ou falha no meio (ex: timeout de UI), o
// override manual SEMPRE volta pra null (automático) no banco de dev depois de cada teste —
// direto via Prisma, sem depender da UI ter chegado até o botão "Voltar ao automático".
const prisma = new PrismaClient();
test.afterEach(async () => {
  await prisma.blackFridayBannerConfig.upsert({
    where: { id: "global" },
    create: { id: "global", modoManual: null, updatedByEmail: "e2e-cleanup" },
    update: { modoManual: null, updatedByEmail: "e2e-cleanup" },
  });
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

// Cobre só os 3 cenários priorizados (ver briefing): banner some/aparece corretamente,
// override manual persiste depois de reload (vem do DB, não de estado de cliente), e o banner
// fica escondido agora (hoje é antes de 2026-11-10) respeitando a janela automática.
// IMPORTANTE: deixa o override manual de volta em "automático" (null) no final — não pode
// sobrar "Forçado ATIVO" ligado no banco de dev como efeito colateral do teste.

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", "rodrigo@tvbshorts.com");
  await page.fill("#password", "trocar123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
}

test("banner oculto hoje (antes de 2026-11-10), automático por padrão", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("banner", { name: "Promoção Black Friday" })).toHaveCount(0);
});

test("admin: Ativar agora força o banner visível, persiste após reload, e Voltar ao automático limpa o override", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/admin");

  const section = page.locator("section", { has: page.getByRole("heading", { name: "Campanha Black Friday" }) });
  await expect(section.getByText("Automático (fora do período)")).toBeVisible();

  // Ativar agora — efeito imediato (inline), sem formulário separado.
  await section.getByRole("button", { name: "Ativar agora" }).click();
  await expect(section.getByText("Forçado ATIVO (manual)")).toBeVisible();

  // O banner tem que aparecer na própria página (dashboard/admin também usa o layout global).
  const banner = page.getByRole("banner", { name: "Promoção Black Friday" });
  await expect(banner).toBeVisible();
  await expect(banner.getByText("É BLACK FRIDAYYYYYYY!!!!!!!").first()).toBeVisible();
  // Logo (branco/contrastado) renderizado dentro da faixa.
  await expect(banner.locator("img").first()).toBeVisible();

  // Persistência real: reload da página, sem nenhum estado de cliente — vem do DB.
  await page.reload();
  await expect(page.getByRole("banner", { name: "Promoção Black Friday" })).toBeVisible();
  await expect(section.getByText("Forçado ATIVO (manual)")).toBeVisible();

  // Navega pra outra página do dashboard com o override ainda ligado — confirma que é global
  // (renderizado pelo layout, não duplicado por página).
  await page.goto("/dashboard/vendas");
  await expect(page.getByRole("banner", { name: "Promoção Black Friday" })).toHaveCount(1);

  // Limpeza: volta pro automático (não pode ficar "Forçado ATIVO" no banco de dev).
  await page.goto("/dashboard/admin");
  const section2 = page.locator("section", { has: page.getByRole("heading", { name: "Campanha Black Friday" }) });
  await section2.getByRole("button", { name: "Voltar ao automático" }).click();
  await expect(section2.getByText("Automático (fora do período)")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("banner", { name: "Promoção Black Friday" })).toHaveCount(0);
  await expect(section2.getByText("Automático (fora do período)")).toBeVisible();
});
