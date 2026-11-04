# Motor de prospecção de revendedores TVB — política gratuita

## Decisão de produto

O usuário definiu que esta iniciativa não pode gerar despesas. Portanto, não utilizar:
- APIs pagas, planos por consulta ou cobrança por registro;
- trials que exijam cartão ou possam converter em cobrança;
- DadosAPI, BigDataCorp, Serasa ou fornecedores equivalentes;
- serviços externos pagos para enriquecimento ou agendamento.

Qualquer mudança dessa política exige autorização explícita antes de implementar ou ativar fornecedor.

## Fonte primária

Usar os arquivos públicos do Cadastro Nacional da Pessoa Jurídica disponibilizados pela Receita Federal. A base permite descobrir e segmentar estabelecimentos por situação cadastral, CNAE, UF e município, com dados cadastrais e contatos que eventualmente constem no registro.

O processamento inicial está documentado em `IMPORTADOR_RECEITA.md` e implementado em `scripts/prospeccao/gerar-prospects-rj.py`. O piloto filtra RJ, situação ativa e CNAEs iniciais de vestuário, calçados, artigos de viagem e acessórios. A seleção de CNAEs deve ser validada pelo comercial; CNAE não comprova que a empresa seja uma loja multimarcas adequada.

## Atualização

A rotina deve verificar periodicamente se há nova competência publicada. A base não é tempo real: a atualização dos dados só ocorre quando a Receita publica uma nova competência. Ao importar uma competência:
1. registrar origem, competência e data de processamento;
2. normalizar e validar CNPJ;
3. comparar por CNPJ do estabelecimento;
4. classificar novos, alterados, inativos e sem alteração;
5. preservar histórico e não duplicar leads;
6. exibir contagens e erros para revisão humana.

Essa rotina recorrente ainda não está implementada nem ativada. O processamento deve permanecer fora de requisições web/Vercel e não pode depender de armazenamento ou execução que gere custo adicional.

## Contatos e privacidade

- Telefone e e-mail só podem ser usados quando constarem como dados do estabelecimento na fonte pública; podem estar ausentes ou desatualizados.
- Não coletar dados pessoais de sócios/administradores para tratá-los como contato comercial da loja.
- Não inferir WhatsApp a partir de telefone.
- Não automatizar mensagens ou abordagens.
- Registrar origem e competência; respeitar finalidade, minimização, retenção e pedidos de oposição/supressão.
- Não contornar login, CAPTCHA, limites técnicos ou termos de uso de fontes complementares.

## Qualificação comercial

O score deve medir aderência ao perfil de revendedor TVB (segmento, localização, porte e evidências comerciais públicas). Não misturar score comercial com risco de crédito. A entrada na carteira e qualquer contato dependem de revisão humana.

## Critérios antes de ativar recorrência

- Testar com arquivos oficiais reais de uma competência, incluindo reconciliação entre duas competências.
- Implementar staging/reconciliação por CNPJ e histórico de alterações.
- Resolver importação acima do limite atual de 500 linhas sem sobrecarregar o banco.
- Verificar capacidade de armazenamento e processamento sem custos extras.
- Criar log de execução, integridade dos arquivos, retomada e reprocessamento.
- Confirmar que nenhuma etapa acessa fonte paga ou serviço com cobrança.
- Obter aprovação operacional do piloto RJ.

## Estado atual

Existe uma primeira versão de exportação CSV e testes automatizados de filtros/layout/CNPJ. O CI desses testes passou. Ainda não existe coletor automático, agendamento, reconciliação incremental ou teste com o dump nacional real. O módulo e a migration permanecem na branch de desenvolvimento; nada foi aplicado ao banco de produção ou publicado.


## Agente Radar de Lojas — qualificação ABCD

### Objetivo
Transformar cadastros públicos em uma carteira de revendedores potenciais, identificando nome comercial real, cidade, presença digital e aderência ao mix masculino da TVB. Razão social não é nome de loja e nunca deve ser promovida automaticamente a nome comercial.

### Localização
- A cidade deve ser o nome legível do município, não o código TOM da Receita.
- Guardar o código TOM em `codigoMunicipio` para rastreabilidade.
- A extração consulta a tabela pública `municipios` do mesmo conjunto de dados da Receita para converter o código.
- A atualização da base existente converte os códigos da UF processada; executar uma UF por vez.

### Identidade comercial
- Se a Receita não trouxer nome fantasia, mostrar “Nome comercial a pesquisar”.
- Manter razão social em campo separado, apenas como dado cadastral.
- Instagram, site e nome comercial só são preenchidos quando houver evidência pública coerente com a loja/CNPJ/endereço.
- Não atribuir perfil pessoal de sócio/administrador à empresa por semelhança de nome.
- Cada pesquisa deve registrar URL da evidência, data, confiança e justificativa.

### Grupos de carteira
O grupo só pode ser atribuído após pesquisa comercial. CNAE isolado, porte cadastral, razão social ou e-mail genérico não são suficientes para classificar A/B/C/D.

- **A (80–100):** forte aderência ao público masculino, multimarcas/loja física ou digital comprovada, operação ativa, mix compatível e evidências comerciais recentes.
- **B (65–79):** boa aderência ao vestuário e operação comprovada, mas menor escala, foco masculino parcial ou evidências incompletas.
- **C (40–64):** potencial incerto/limitado, loja pequena ou generalista, pouca evidência do mix masculino ou presença digital fraca.
- **D (0–39):** atividade incompatível, empresa sem evidência de operação varejista ou claramente fora do perfil de revenda TVB.
- **PENDENTE:** pesquisa ainda não concluída; não equivale a grupo C ou D.

O score é comercial, não financeiro nem de crédito. Fatores devem ser explicados e acompanhados da confiança (ALTA/MEDIA/BAIXA). Ausência de Instagram/site reduz confiança, mas não prova que a loja não exista. Toda classificação é recomendação para revisão humana; nenhuma abordagem automática.

### Estado da implementação
- Campos estruturados adicionados no branch para Instagram, score, grupo, justificativa, confiança, verificação do nome comercial e data de pesquisa.
- Painel recebe filtros por UF, cidade e grupo, além de contadores ABCD.
- Ainda não existe agente autônomo que pesquise a web em massa. Esta entrega prepara a estrutura e corrige localização/nome; a pesquisa assistida em lotes será a próxima etapa, respeitando a política de custo zero.
