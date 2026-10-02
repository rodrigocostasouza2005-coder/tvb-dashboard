@AGENTS.md

# Ambiente de banco de dados (Neon)

- **Neon production**: banco de produção, usado pela Vercel (deploy real). Host atual: `ep-green-dew-axlg84qg...neon.tech`.
- **Neon dev**: branch exclusiva para desenvolvimento/local. Host atual: `ep-super-paper-axg87hqn...neon.tech`.
- `.env.local` deve sempre apontar `DATABASE_URL` para o Neon dev, nunca para production.
- **Nunca** alterar `.env.local` para apontar para production.
- **Nunca** executar migration, `UPDATE`, `DELETE`, `DROP` ou qualquer operação destrutiva em production durante desenvolvimento.
- Antes de qualquer alteração de banco (schema, dado, migration), confirmar que o ambiente atual é o dev — ex: `grep DATABASE_URL .env.local` e checar o host, sem nunca imprimir a connection string completa.
