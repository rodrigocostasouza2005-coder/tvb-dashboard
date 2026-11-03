# Auditoria técnica — Expansão Atacadista

Data: 2026-11-03
Branch: `feature/expansao-atacadista`

## 1. Estrutura existente confirmada

- Aplicação: Next.js 16.3, App Router, TypeScript.
- Persistência: Prisma 6.19 + PostgreSQL, conexão por `DATABASE_URL`.
- Deploy informado pelo projeto: Vercel; banco PostgreSQL gerenciado (Neon conforme arquitetura já utilizada pelo TVB).
- Testes: Vitest (`npm test`); lint via ESLint; build via `next build`.
- Navegação: `src/lib/tabs.ts`, com grupos e controle de acesso por usuário.
- Layout autenticado: `src/app/dashboard/layout.tsx`.
- Prisma schema atual: `prisma/schema.prisma`.

## 2. Atacado já existente — não duplicar

Já existem as rotas:
- `/dashboard/atacado`: visão de vendas B2B, receita, pedidos, unidades, clientes e produtos.
- `/dashboard/atacado-clientes`: clientes existentes, retenção, CMV estimado e margem.
- `/dashboard/atacado-cidades`: cidades/estados atendidos e mapa.
- `/dashboard/inadimplencia`: parcelas em aberto, com filtro de atacado pelo plano de contas.

Essas rotas já usam sessão, permissões, filtros e funções de métricas do Radar. A nova frente deve ser uma aba irmã dentro do grupo Atacado, sem substituir essas páginas.

## 3. Dados existentes que podem ser reaproveitados

- `ClienteCadastro`: cadastro sincronizado do DAPIC, com nome, telefone, celular, e-mail e CPF/CNPJ; possui `dapicId` único.
- `Sale`: histórico de vendas, com cliente, cidade, estado, produto, quantidade e valores.
- `Parcela`: dados financeiros/parcelas, incluindo pessoa, valor em aberto e plano de contas.
- `ContatoMarcado`: marcação de contatos de CRM já existentes; não representa um pipeline completo de prospecção.
- `VendaHistoricaExterna`: histórico anterior do e-commerce, não é cadastro de leads.

## 4. Lacuna confirmada

Não foi encontrada entidade dedicada a prospectos/lojas ainda não clientes, nem pipeline comercial com:
- origem e evidência de descoberta;
- status de qualificação e responsável;
- histórico de tentativas/interações;
- deduplicação por CNPJ e por identidade comercial;
- motivo de descarte e trilha de auditoria.

Não reutilizar `ClienteCadastro` para leads: ele representa cadastro sincronizado do DAPIC e tem semântica diferente. Não reutilizar `ContatoMarcado` como CRM de prospecção: seu modelo atual foi desenhado para marcar contatos de clientes existentes.

## 5. Decisão de arquitetura recomendada

Criar módulo `/dashboard/atacado-prospeccao` dentro do grupo Atacado, protegido por sessão e `requireTabAccess`.

Criar entidades próprias e enxutas, após validar os campos com os padrões atuais do schema:
- `AtacadoProspect`: empresa/loja, CNPJ normalizado opcional, nome fantasia/razão social, cidade/UF, site, telefone/e-mail públicos, origem, URL de evidência, data da evidência, status, responsável, notas, timestamps.
- `AtacadoProspectActivity`: histórico append-only de ações e alterações relevantes (contato tentado, resposta, qualificação, mudança de status, descarte), ligado ao prospect.

Índices/constraints:
- CNPJ normalizado único quando não nulo (índice único parcial via migration SQL, caso o padrão Prisma não expresse a condição).
- Índices por UF/cidade, status e updatedAt.
- Deduplicação adicional por domínio/site e combinação nome+cidade, sempre com revisão humana quando ambígua.

## 6. Limites do MVP

- Importação CSV com prévia, validação e relatório de erros.
- Cadastro manual de prospect.
- Lista, filtros por UF/cidade/status e fila de revisão.
- Score de aderência comercial explicável, baseado somente em critérios observáveis de compatibilidade com o canal/segmento; nunca chamar isso de score de crédito.
- Origem, URL e data da evidência visíveis em cada lead.
- Histórico de atividades e aprovação humana antes de converter em cliente/negociar prazo.
- Sem consultas Serasa no MVP.
- Sem scraping que contorne login, CAPTCHA, bloqueios ou termos de uso.
- Sem disparo automático de mensagens em massa.
- Nenhuma migração aplicada em produção nesta etapa.

## 7. Próximos passos de implementação

1. Confirmar a navegação e os padrões de formulário/tabela existentes; adicionar a aba irmã com controle de acesso.
2. Definir migration Prisma para prospect e atividades, incluindo índices e unicidade segura de CNPJ.
3. Implementar validação/normalização e importação CSV idempotente com prévia.
4. Implementar CRUD, filtros, fila de revisão e histórico.
5. Cobrir regras críticas com testes Vitest e validar lint/build.
6. Abrir PR em draft para revisão; não fazer merge/deploy nem executar migration em produção sem autorização.

## 8. Pontos ainda não verificados

- Região física configurada no projeto Vercel e região do projeto Neon.
- Permissões/escopo de fontes externas de descoberta e custo de acesso.
- Contrato/entitlements da assinatura Serasa de R$124 e disponibilidade de API.
- Acesso a variáveis de ambiente e execução de testes/build neste ambiente remoto.

