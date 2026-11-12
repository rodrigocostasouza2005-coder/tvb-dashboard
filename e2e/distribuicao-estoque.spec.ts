import { test, expect } from "@playwright/test";

// Valida num navegador REAL as 4 abas da Inteligência de Distribuição (2026-11-11) — vitest cobre
// a lógica pura, mas nada do que importa aqui é provável por teste puro: a troca de aba por
// searchParam, a expansão de linha (estado de cliente), o toggle produto↔grupo da Análise de Grade
// (estado de cliente, sem sair da aba) e os filtros de origem/destino/tipo/prioridade.
//
// Roda contra o banco de DEV (.env.local) com dado real — por isso as asserções olham estrutura
// (colunas, aba ativa, detalhe expandido) e não números específicos, que mudam a cada sync.
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", "rodrigo@tvbshorts.com");
  await page.fill("#password", "trocar123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
}

// O usuário de teste tem allowedTabs curado manualmente no banco de dev e NÃO inclui
// "distribuicao-estoque" (gap de ambiente, igual ao que a spec de prospecção já documentou).
// Concede pela própria UI de admin (fluxo real, sem escrever direto na tabela User) só pra durar o
// teste, e desfaz no afterAll pra devolver o ambiente exatamente como estava.
async function setDistribuicaoTab(page: import("@playwright/test").Page, checked: boolean) {
  await page.goto("/dashboard/admin");
  const card = page.locator("div.rounded-lg", { hasText: "rodrigo@tvbshorts.com" }).first();
  const checkbox = card.getByRole("checkbox", { name: "Inteligência de Distribuição" });
  if ((await checkbox.isChecked()) !== checked) {
    await checkbox.setChecked(checked);
    await card.getByRole("button", { name: "Salvar" }).click();
    // updateUserAction termina com redirect("/dashboard/admin?ok=1") — esperar essa navegação é o
    // que garante que a Server Action terminou antes de seguir.
    await page.waitForURL(/\?ok=1/);
  }
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  await setDistribuicaoTab(page, true);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  await setDistribuicaoTab(page, false);
  await page.close();
});

test("as 4 abas existem e a navegação entre elas preserva os filtros aplicados", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/distribuicao-estoque?busca=Cruiser");

  const tablist = page.getByRole("tablist");
  for (const nome of ["Visão Geral", "Movimentações", "Análise de Grade", "Histórico"]) {
    await expect(tablist.getByRole("tab", { name: nome })).toBeVisible();
  }
  // Default = Visão Geral.
  await expect(tablist.getByRole("tab", { name: "Visão Geral" })).toHaveAttribute("aria-selected", "true");

  await tablist.getByRole("tab", { name: "Movimentações" }).click();
  await page.waitForURL(/aba=movimentacoes/);
  // A busca aplicada sobrevive à troca de aba (estado em searchParam, não em memória do cliente).
  await expect(page).toHaveURL(/busca=Cruiser/);
  await expect(page.getByRole("tab", { name: "Movimentações" })).toHaveAttribute("aria-selected", "true");
});

test("Visão Geral traz o CD/Site como unidade de primeira classe no quadro comparativo", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/distribuicao-estoque?aba=visao-geral");

  const quadro = page.locator("section", { has: page.getByRole("heading", { name: "Quadro comparativo por unidade" }) });
  await expect(quadro).toBeVisible();

  // As 3 lojas de varejo reais + a posição única CD/Site (CD + Atacado juntos, nunca duplicada).
  for (const unidade of ["TVB Leblon", "TVB Barra", "TVB Rio Sul", "TVB Site e Atacado"]) {
    await expect(quadro.getByRole("cell", { name: new RegExp(unidade) })).toHaveCount(1);
  }
  await expect(quadro.getByText("CD/Site")).toHaveCount(1);

  // Os KPIs pedidos na Visão Geral.
  for (const kpi of [
    "Estoque total nas unidades",
    "Excesso identificado",
    "Produtos com grade incompleta",
    "Oportunidades de redistribuição",
    "Peças potencialmente movimentáveis",
    "Alertas de estoque parado",
  ]) {
    await expect(page.getByText(kpi, { exact: true })).toBeVisible();
  }
});

test("Movimentações: linha expande com detalhe, grade por tamanho e justificativa; recolhe ao clicar de novo", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/distribuicao-estoque?aba=movimentacoes&prioridade=alta");

  const linhas = page.getByTestId("movimentacao-linha");
  await expect(linhas.first()).toBeVisible();

  // Fechada: nada de detalhe na tela.
  await expect(page.getByText("Grade por tamanho")).toHaveCount(0);

  await linhas.first().click();
  await expect(linhas.first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Posições" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Grade por tamanho/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Justificativa" })).toBeVisible();
  await expect(page.getByText(/Quantidade sugerida:/)).toBeVisible();
  await expect(page.getByText(/Impacto esperado:/)).toBeVisible();
  // Nunca executa movimentação — o aviso tem que estar visível junto dos botões de decisão.
  await expect(page.getByText(/nunca executa a transferência/)).toBeVisible();

  // Clicar de novo fecha (estado de cliente de verdade, não navegação).
  await linhas.first().click();
  await expect(linhas.first()).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "Posições" })).toHaveCount(0);
});

test("Movimentações: filtro de tipo restringe às direções escolhidas", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/distribuicao-estoque?aba=movimentacoes");

  // Todas as 3 direções aparecem como opção de filtro. (FilterDropdown é <details>/<summary>, não
  // um button — por isso o locator é por elemento, não por role.)
  await page.locator("summary", { hasText: "Tipo de movimentação" }).click();
  for (const label of ["Loja → Loja", "CD/Site → Loja", "Loja → CD/Site"]) {
    await expect(page.getByRole("checkbox", { name: label })).toBeVisible();
  }

  await page.getByRole("checkbox", { name: "Loja → CD/Site" }).check();
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForURL(/tipo=loja_cd_site/);

  // Toda linha visível é da direção escolhida — o destino é sempre o CD/Site.
  const linhas = page.getByTestId("movimentacao-linha");
  await expect(linhas.first()).toBeVisible();
  const total = await linhas.count();
  for (let i = 0; i < Math.min(total, 10); i++) {
    await expect(linhas.nth(i)).toContainText("Loja → CD/Site");
  }
});

test("Análise de Grade: alterna produto ↔ grupo sem sair da aba", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/distribuicao-estoque?aba=grade");

  // Visão por produto é o padrão: matriz Tamanho × unidade (com coluna do CD/Site).
  const porProduto = page.getByTestId("grade-visao-produto");
  await expect(porProduto).toBeVisible();
  await expect(porProduto.getByRole("columnheader", { name: "Tamanho" }).first()).toBeVisible();
  await expect(porProduto.getByRole("columnheader", { name: "TVB Site e Atacado" }).first()).toBeVisible();
  await expect(page.getByTestId("grade-visao-grupo")).toHaveCount(0);

  const urlAntes = page.url();
  await page.getByTestId("grade-toggle-grupo").click();

  await expect(page.getByTestId("grade-visao-grupo")).toBeVisible();
  await expect(page.getByTestId("grade-visao-produto")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Quadro por grupo de produto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Distribuição por tamanho dentro de cada grupo" })).toBeVisible();
  // "Sem sair da aba": nenhuma navegação aconteceu.
  expect(page.url()).toBe(urlAntes);
  await expect(page.getByRole("tab", { name: "Análise de Grade" })).toHaveAttribute("aria-selected", "true");

  // E volta.
  await page.getByTestId("grade-toggle-produto").click();
  await expect(page.getByTestId("grade-visao-produto")).toBeVisible();
});

test("Histórico: declara que a migration não foi aplicada em vez de estourar erro", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/distribuicao-estoque?aba=historico");

  // Esta entrega GEROU a migration de DecisaoMovimentacaoEstoque mas deliberadamente NÃO a aplicou
  // em banco nenhum — a aba precisa dizer isso com clareza, não quebrar. Depois de aplicada, o
  // mesmo código passa a listar o acompanhamento (por isso o teste aceita os dois estados).
  const pendente = page.getByText(/migration/i);
  const tabela = page.getByRole("heading", { name: /Acompanhamento de decisões/ });
  const vazio = page.getByText(/Nenhuma decisão registrada ainda/);
  await expect(pendente.or(tabela).or(vazio).first()).toBeVisible();
  // Em nenhum dos casos a tela pode cair no error boundary do dashboard.
  await expect(page.getByText(/Algo deu errado|Application error/i)).toHaveCount(0);
});

// Um teste por aba (em vez de um loop num teste só): cada aba agrega o catálogo inteiro e leva
// vários segundos no `next dev`, então um teste único estourava o timeout por acumulação, não por
// lentidão de uma aba específica.
for (const aba of ["visao-geral", "movimentacoes", "grade", "historico"]) {
  test(`responsivo no celular: aba ${aba} não vaza horizontalmente`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/dashboard/distribuicao-estoque?aba=${aba}`);
    await expect(page.getByRole("tablist")).toBeVisible();
    // Tabela densa larga rola DENTRO do próprio container (overflow-x-auto), nunca empurrando o
    // body — mesma regra das outras telas do Radar.
    const vazou = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(vazou, `aba ${aba} vazou horizontalmente`).toBe(false);
  });
}
