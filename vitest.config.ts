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
    //
    // .claude/worktrees/** — achado na auditoria de 2026-11-12: cada worktree de agente é um
    // checkout completo do repo (node_modules incluso), e QUALQUER um que tenha um spec e2e/*
    // próprio (ex: feat/distribuicao-estoque-cd-site, que ainda está em PR aberto, não é lixo
    // órfão) faz o Vitest tentar coletar aquele spec de dentro do worktree e travar o processo
    // inteiro ("Worker exited unexpectedly") — não só quando há worktree órfão, mesmo um worktree
    // ativo de PR legítimo já é suficiente. Limpar worktrees órfãos ajuda, mas não é a correção
    // real: a causa é o Vitest nunca ter sido instruído a ignorar `.claude/worktrees/` por
    // padrão, igual já faz com `e2e/`.
    exclude: [...configDefaults.exclude, "e2e/**", "**/.claude/worktrees/**"],
  },
});
