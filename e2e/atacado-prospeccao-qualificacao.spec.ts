import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Cobre a reformulação da aba Prospecção (seção "Qualificação B2B", PR do rebuild do motor já
// mergeado em #51): dados reais do motor são raros em produção hoje, então este teste cria sua
// própria fixture isolada (CNPJs com prefixo E2E- pra nunca colidir com dado real) e remove tudo
// por id específico no final — nunca um deleteMany({}) sem filtro numa tabela compartilhada.
const prisma = new PrismaClient();

const IDS = {
  aprovado: "e2e-qualif-aprovado-1",
  pendente: "e2e-qualif-pendente-1",
  reprovado: "e2e-qualif-reprovado-1",
};

async function limpar() {
  await prisma.atacadoProspect.deleteMany({ where: { id: { in: Object.values(IDS) } } });
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", "rodrigo@tvbshorts.com");
  await page.fill("#password", "trocar123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
}

// O usuário de teste (rodrigo@tvbshorts.com) tem allowedTabs curado manualmente no banco de dev
// e não inclui "atacado-prospeccao" ainda — gap de ambiente, não causado por este rebuild. Em vez
// de escrever direto na tabela User (sensível), concede pela própria UI de admin (fluxo real) só
// pra durar o teste, e desfaz no afterAll pra devolver o ambiente exatamente como estava.
async function setProspeccaoTab(page: import("@playwright/test").Page, checked: boolean) {
  await page.goto("/dashboard/admin");
  const card = page.locator("div.rounded-lg", { hasText: "rodrigo@tvbshorts.com" }).first();
  const checkbox = card.getByRole("checkbox", { name: "Prospecção" });
  if ((await checkbox.isChecked()) !== checked) {
    await checkbox.setChecked(checked);
    await card.getByRole("button", { name: "Salvar" }).click();
    // updateUserAction termina com redirect("/dashboard/admin?ok=1") — esperar essa navegação
    // explicitamente é o que garante que a Server Action já terminou antes de seguir (sem isso,
    // fechar a page cedo demais pode cancelar o fetch da action antes de persistir no banco).
    await page.waitForURL(/\?ok=1/);
  }
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  await setProspeccaoTab(page, true);
  await page.close();
  await limpar();
  await prisma.atacadoProspect.create({
    data: {
      id: IDS.aprovado,
      nomeFantasia: "E2E Surf Multimarcas",
      razaoSocial: "E2E Comercio de Roupas Ltda",
      cnpj: "E2E-APROVADO-0001",
      cidade: "Florianópolis",
      estado: "SC",
      capitalEstadual: true,
      tipoEstabelecimento: "MATRIZ",
      cnpjRaiz: "E2EAPRV0",
      statusComercial: "APROVADO",
      classificacaoProspect: "ALTA_PRIORIDADE",
      resultadoEliminacao: "APROVADO_GATE",
      status: "CONTATADO",
      scoreDetalhe: {
        total: 88,
        classificacao: "ALTA_PRIORIDADE",
        subScores: [{ criterio: "MULTIMARCAS", pontos: 28, maximo: 30, rationale: "3 marcas confirmadas com evidência individual" }],
      },
      evidenciasQualificacao: {
        criterios: [{ id: "MULTIMARCAS", resultado: "ATENDE", motivo: "Vitrine com 3 marcas de terceiros identificadas" }],
        motivosReprovacao: [],
      },
      brands: {
        create: [{
          marca: "E2E Brand Co",
          marcaNormalizada: "e2e brand co",
          evidencia: "Produto da marca à venda na vitrine do site oficial",
          fonteUrl: "https://example.com/e2e-evidencia",
          dataVerificacao: new Date("2026-11-01"),
          tipoEvidencia: "SITE_OFICIAL",
          confianca: "ALTA",
        }],
      },
    },
  });
  await prisma.atacadoProspect.create({
    data: {
      id: IDS.pendente,
      nomeFantasia: "E2E Loja Pendente",
      cnpj: "E2E-PENDENTE-0001",
      cidade: "Blumenau",
      estado: "SC",
      capitalEstadual: false,
      statusComercial: "PENDENTE_REVISAO_HUMANA",
      classificacaoProspect: "QUALIFICADO",
      resultadoEliminacao: "APROVADO_GATE",
      scoreDetalhe: { total: 79, classificacao: "QUALIFICADO", subScores: [] },
    },
  });
  await prisma.atacadoProspect.create({
    data: {
      id: IDS.reprovado,
      nomeFantasia: "E2E Loja Reprovada",
      cnpj: "E2E-REPROVADO-0001",
      cidade: "Joinville",
      estado: "SC",
      statusComercial: "REPROVADO",
      resultadoEliminacao: "REPROVADO",
      motivosEliminacao: ["Nenhuma marca de terceiro com evidência individual (critério MULTIMARCAS)"],
    },
  });
});

test.afterAll(async ({ browser }) => {
  await limpar();
  const page = await browser.newPage();
  await login(page);
  await setProspeccaoTab(page, false);
  await page.close();
  await prisma.$disconnect();
});

test("seção Qualificação B2B separa visualmente aprovados, pendentes e reprovados", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/atacado-prospeccao?qEstado=SC");

  const section = page.locator("section", { has: page.getByRole("heading", { name: "Qualificação B2B (motor automático)" }) });
  await expect(section).toBeVisible();

  // Aprovado aparece na tabela principal, com badge de prioridade e marca identificada.
  const aprovadosTable = page.getByTestId("qualificacao-aprovados");
  await expect(aprovadosTable.getByText("E2E Surf Multimarcas")).toBeVisible();
  await expect(aprovadosTable.getByText("Alta prioridade")).toBeVisible();
  await expect(aprovadosTable.getByText("Capital")).toBeVisible();

  // Expande a marca identificada e confirma evidência/fonte/confiança aparecem.
  await aprovadosTable.getByText(/1 marca/).click();
  await expect(aprovadosTable.getByText("E2E Brand Co")).toBeVisible();
  await expect(aprovadosTable.getByText("Alta").first()).toBeVisible();
  await expect(aprovadosTable.getByRole("link", { name: "Ver fonte ↗" })).toHaveAttribute("href", "https://example.com/e2e-evidencia");

  // Pendente NUNCA aparece dentro da tabela de aprovados — fica no bloco âmbar separado.
  await expect(aprovadosTable.getByText("E2E Loja Pendente")).toHaveCount(0);
  const pendentesSection = page.getByTestId("qualificacao-pendentes");
  await expect(pendentesSection.getByRole("heading", { name: /Pendentes de revisão humana/ })).toBeVisible();
  await expect(pendentesSection.getByText("E2E Loja Pendente")).toBeVisible();
  await expect(pendentesSection.getByText("Qualificado")).toBeVisible();

  // Reprovado fica escondido por padrão (auditoria sob demanda), com motivo visível ao abrir.
  const reprovadosDetails = page.getByTestId("qualificacao-reprovados");
  const auditoria = reprovadosDetails.locator("summary");
  await expect(auditoria).toBeVisible();
  // <details> fechado: o conteúdo existe no DOM mas fica oculto (display:none nativo do navegador).
  await expect(reprovadosDetails.getByText("E2E Loja Reprovada")).toBeHidden();
  await auditoria.click();
  await expect(reprovadosDetails.getByText("E2E Loja Reprovada")).toBeVisible();
  await expect(reprovadosDetails.getByText(/Nenhuma marca de terceiro/)).toBeVisible();
});

test("filtro por município na seção Qualificação B2B restringe a lista sem reload de página", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/atacado-prospeccao?qEstado=SC");

  const section = page.locator("section", { has: page.getByRole("heading", { name: "Qualificação B2B (motor automático)" }) });
  await expect(section.getByText("E2E Surf Multimarcas")).toBeVisible();

  await section.getByLabel("Município").fill("Blumenau");
  await section.getByRole("button", { name: "Filtrar" }).click();
  await page.waitForURL(/qMunicipio=Blumenau/);

  const pendentesSection = page.getByTestId("qualificacao-pendentes");
  await expect(pendentesSection.getByText("E2E Loja Pendente")).toBeVisible();
  // Florianópolis não bate com o filtro de município -> aprovado sai da lista.
  const aprovadosTable = page.getByTestId("qualificacao-aprovados");
  await expect(aprovadosTable.getByText("E2E Surf Multimarcas")).toHaveCount(0);
});

// Fase 3 (2026-11-13): "Bruce só deve trabalhar com quem já foi confirmado Qualificado" — a
// Carteira de prospectos (pipeline legado onde Bruce trabalha, campo `status`) não pode mais
// vazar EM_INVESTIGACAO/PENDENTE_REVISAO_HUMANA/REPROVADO só porque não é explicitamente
// REPROVADO; só statusComercial=APROVADO entra, por padrão.
test("Carteira de prospectos (pipeline do Bruce) só expõe prospects Qualificados por padrão", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/atacado-prospeccao?uf=SC");

  const carteira = page.locator("section", { has: page.getByRole("heading", { name: /Carteira de prospectos/ }) });
  await expect(carteira.getByText("E2E Surf Multimarcas")).toBeVisible();
  await expect(carteira.getByText("E2E Loja Pendente")).toHaveCount(0);
  await expect(carteira.getByText("E2E Loja Reprovada")).toHaveCount(0);
});

// Tela de confirmação de exclusão em massa precisa mostrar a classificação de cada registro
// (não só nome/contagem) antes do botão definitivo — pedido explícito da Fase 3.
test("confirmação de exclusão em massa mostra a classificação de cada prospect antes de excluir", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/atacado-prospeccao?qEstado=SC");

  const reprovadosDetails = page.getByTestId("qualificacao-reprovados");
  await reprovadosDetails.locator("summary").click();
  await reprovadosDetails.getByRole("checkbox", { name: "Selecionar E2E Loja Reprovada" }).check();
  await reprovadosDetails.getByRole("button", { name: "Excluir selecionados" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Confirmar exclusão definitiva" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Confirmar exclusão definitiva de 1 prospecto(s)?")).toBeVisible();
  await expect(dialog.getByText("E2E Loja Reprovada")).toBeVisible();
  await expect(dialog.getByText(/Inadequado \/ Inválido/)).toBeVisible();

  // Não confirma de fato — só valida que a tela mostra classificação antes do botão existir.
  await dialog.getByRole("link", { name: "Cancelar" }).click();
});
