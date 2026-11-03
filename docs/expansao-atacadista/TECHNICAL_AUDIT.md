# Auditoria técnica — Expansão Atacadista

Data: 2026-11-03
Branch: `feature/expansao-atacadista`

## O que foi implementado

- Nova aba `/dashboard/atacado-prospeccao`, integrada ao grupo Atacado e protegida por sessão e `requireTabAccess`.
- Modelos Prisma separados `AtacadoProspect` e `AtacadoProspectActivity`; prospectos não são misturados com `ClienteCadastro`, sincronizado pelo DAPIC.
- Cadastro manual, atualização de status com histórico e importação CSV com prévia no navegador.
- Limites atuais do CSV: 500 linhas e 900 KB. Duplicados por CNPJ são ignorados; a importação não reconcilia alterações.
- Importador offline em Python para arquivos públicos da Receita, com filtro inicial RJ/CNAEs, validação de CNPJ numérico e alfanumérico (regra oficial módulo 11) e exportação CSV.
- Testes automatizados Python no GitHub Actions.

## Validação observada

- O importador passou a aceitar CNPJ alfanumérico no formato oficial (12 caracteres alfanuméricos + 2 dígitos verificadores), com teste baseado no exemplo publicado pela Receita Federal. A alteração está em revisão na PR específica; ainda aguarda CI e validação com dump real.

- Workflow `Prospecting importer tests`: sucesso no commit `c25edaa4aa06abe5af7d30cc493b88cf62668995`.
- Check Vercel da PR: sucesso no mesmo commit.
- Não há aprovação de revisão registrada nem threads de revisão abertas.
- O check Python cobre o importador e seus casos de teste; não substitui validação funcional com os arquivos reais da Receita.
- O check Vercel indica que o pipeline de preview terminou com sucesso, mas não valida a migration no banco de produção.

## Pendências antes de liberar em produção

1. Aplicar a migration `20261103190000_add_atacado_prospects` no banco correto, após backup/verificação e confirmação de ambiente. Ela cria tabelas novas; não foi aplicada até esta auditoria.
2. Confirmar quais usuários têm `allowedTabs` explícito. Usuários com lista explícita só verão a aba se a chave `atacado-prospeccao` estiver nela; listas vazias usam o padrão por perfil.
3. Testar a tela autenticada após migration: cadastro, alteração de status, CSV válido, CSV inválido e duplicidade.
4. Testar o importador com um dump oficial real e confirmar layout/competência antes de usar os leads.
5. Definir tratamento de listas acima de 500 registros e reconciliação por competência antes de qualquer rotina recorrente.
6. Não ativar cron, scraping, serviços pagos, consultas Serasa ou mensagens automáticas. A política atual é custo zero e revisão humana.

## Limites conhecidos do MVP

- A prospecção automática recorrente ainda não existe; o script é executado manualmente e offline.
- O CSV aceita até 500 linhas por carga e não suporta campos entre aspas que contenham quebras de linha.
- A deduplicação operacional é por CNPJ; não há reconciliação de dados já importados.
- O score comercial, mapa/ranking e qualificação automatizada ainda não foram implementados.
- A situação atual não comprova que telefone/e-mail estejam atualizados nem que o estabelecimento seja um revendedor aderente ao perfil TVB.

## Segurança de implantação

O merge para `main` pode disparar o deploy de produção pela integração Vercel. Não abrir a rota para uso real antes de aplicar a migration e validar permissões. Nenhuma migration foi executada e nenhum dado de prospecto foi gravado em produção durante esta implementação.
