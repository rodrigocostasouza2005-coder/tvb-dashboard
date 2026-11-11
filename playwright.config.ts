import { defineConfig } from "@playwright/test";

// Config mínima, escopada só pra validar visualmente o banner de Black Friday num navegador
// real (CLAUDE.md/histórico do projeto: vitest não basta pra provar comportamento visual/animado
// de DOM). webServer sobe o `next dev` já existente contra o .env.local (Neon dev).
export default defineConfig({
  testDir: "./e2e",
  // 120s (era 60s): as telas de inteligência de estoque agregam o catálogo inteiro (2.6k SKUs ×
  // 4 posições) e, no `next dev` (compilação sob demanda, sem build otimizado), a PRIMEIRA abertura
  // de cada rota passava de 60s — não é lentidão em produção, é o custo do dev server. É um teto,
  // não uma espera: teste rápido continua terminando rápido.
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
