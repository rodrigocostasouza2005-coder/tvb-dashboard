import type { NextConfig } from "next";

// @prisma/client empacota por padrão o engine/compiler WASM dos 5 bancos que o driver-adapter
// mode suporta (postgresql, mysql, sqlite, sqlserver, cockroachdb), mesmo quando o schema só usa
// um. Este projeto (prisma/schema.prisma) só declara "postgresql" e usa o engine nativo (não usa
// driverAdapters/edge), então os 4 bancos abaixo nunca são carregados em runtime — excluídos do
// tracing de TODAS as Functions pra reduzir o Function Storage da Vercel. Deliberadamente mantém
// intactos: o engine nativo (.prisma/client/query_engine-*.so.node) e todo arquivo com
// "postgresql" no nome.
const unusedPrismaProviders = ["mysql", "sqlite", "sqlserver", "cockroachdb"];
const prismaEngineExcludes = unusedPrismaProviders.flatMap((provider) => [
  `node_modules/@prisma/client/runtime/query_engine_bg.${provider}.js`,
  `node_modules/@prisma/client/runtime/query_engine_bg.${provider}.mjs`,
  `node_modules/@prisma/client/runtime/query_engine_bg.${provider}.wasm-base64.js`,
  `node_modules/@prisma/client/runtime/query_engine_bg.${provider}.wasm-base64.mjs`,
  `node_modules/@prisma/client/runtime/query_compiler_bg.${provider}.js`,
  `node_modules/@prisma/client/runtime/query_compiler_bg.${provider}.mjs`,
  `node_modules/@prisma/client/runtime/query_compiler_bg.${provider}.wasm-base64.js`,
  `node_modules/@prisma/client/runtime/query_compiler_bg.${provider}.wasm-base64.mjs`,
]);

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": prismaEngineExcludes,
  },
};

export default nextConfig;
