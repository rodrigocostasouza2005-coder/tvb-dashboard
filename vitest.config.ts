import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // e2e/ são specs do Playwright (navegador real), não do vitest — sem isso, "npm test"
    // (vitest) também tentava coletar e2e/*.spec.ts e quebrava com "test.afterEach() did not
    // expect to be called here" (API do Playwright chamada fora do runner dele). Achado na
    // CI do PR do banner de Black Friday em 2026-11-06.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
