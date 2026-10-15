@AGENTS.md

# Ambiente de banco de dados (Neon)

- **Neon production**: banco de produção, usado pela Vercel (deploy real). Host atual: `ep-green-dew-axlg84qg...neon.tech`.
- **Neon dev**: branch exclusiva para desenvolvimento/local. Host atual: `ep-super-paper-axg87hqn...neon.tech`.
- `.env.local` deve sempre apontar `DATABASE_URL` para o Neon dev, nunca para production.
- **Nunca** alterar `.env.local` para apontar para production.
- **Nunca** executar migration, `UPDATE`, `DELETE`, `DROP` ou qualquer operação destrutiva em production durante desenvolvimento.
- Antes de qualquer alteração de banco (schema, dado, migration), confirmar que o ambiente atual é o dev — ex: `grep DATABASE_URL .env.local` e checar o host, sem nunca imprimir a connection string completa.
- **Armadilha real (2026-10-15)**: existe TAMBÉM um arquivo `.env` (além do `.env.local`). O Next.js (`next dev`/`next build`) prioriza `.env.local`, mas um script rodado direto (`npx tsx scripts/...`, fora do Next) cai no carregamento padrão do Prisma, que lê `.env` — e nessa época `.env` tinha a URL de **produção**. Resultado: scripts/auditorias que pareciam seguras ("só estou lendo/testando no dev") foram sem querer direto pra produção. Já corrigido (`.env` agora tem a mesma URL de dev que `.env.local`) — mas ao checar o ambiente antes de rodar um script solto, sempre conferir **os dois arquivos** (`grep DATABASE_URL .env .env.local`, comparando os hosts), não só `.env.local`.
