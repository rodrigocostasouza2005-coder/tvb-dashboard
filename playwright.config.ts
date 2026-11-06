import { defineConfig } from "@playwright/test";

// Config mínima, escopada só pra validar visualmente o banner de Black Friday num navegador
// real (CLAUDE.md/histórico do projeto: vitest não basta pra provar comportamento visual/animado
// de DOM). webServer sobe o `next dev` já existente contra o .env.local (Neon dev).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
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
