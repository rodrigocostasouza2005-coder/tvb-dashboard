# Motor de prospecção automática de revendedores TVB

## Objetivo operacional

O módulo deve descobrir estabelecimentos potencialmente revendedores sem exigir cadastro manual. O cadastro manual e CSV são ferramentas auxiliares, nunca a fonte principal da carteira.

Fluxo:
1. Descobrir estabelecimentos por CNAE, UF e município.
2. Priorizar estabelecimentos ativos e com pelo menos um canal comercial.
3. Enriquecer nome fantasia, razão social, CNPJ, endereço, telefone e e-mail institucional.
4. Normalizar e deduplicar por CNPJ do estabelecimento.
5. Qualificar aderência ao perfil de revendedor TVB.
6. Persistir origem, data da consulta e qualidade dos campos.
7. Reconsultar contatos vencidos dentro da política de retenção/uso do fornecedor.
8. Exibir fila de leads com telefone/endereço e motivo da classificação.

## Fornecedor em avaliação: DadosAPI

Documentação pública consultada em 03/11/2026:
- Endpoint de busca: POST https://api.dadosapi.com/dados-empresas/busca-empresas
- Autenticação documentada: Authorization: Bearer <API_KEY>
- Filtros documentados: CNAE, UF, município, porte, situação cadastral, somente_com_contato, abertura_apos, pagina e por_pagina.
- Exemplo de retorno contém CNPJ, razão social, nome fantasia, situação, porte, CNAE, endereço (logradouro, número, bairro, município, UF, CEP), telefones e e-mails.
- A página de produto consultada informa preço "a partir de R$ 1,90 por empresa efetivamente retornada", com descontos por volume e primeiras consultas gratuitas. Confirmar a tabela contratual antes de habilitar produção.
- A documentação pública informa solicitação de API key gratuita, mas os termos do site deixam claro que contratação e consumo da API são formalizados em documento próprio. Portanto, não presumir licença de armazenamento, retenção ou prospecção até receber e revisar o contrato/termo específico da API.

Fontes:
- https://dadosapi.com/dados-empresas/busca-empresas
- https://dadosapi.com/termos-de-uso
- https://dadosapi.com/planos

## Alternativas em avaliação

### BigDataCorp
- Possui datasets de cadastro/contatos e preços publicados por consulta (por exemplo, registro R$ 0,140 e telefones R$ 0,060 na primeira faixa).
- A documentação de telefones/e-mails é centrada em consulta por CNPJ. Confirmar qual produto/endpoint permite descoberta de empresas por CNAE e município antes de escolher como fonte de descoberta.
- A empresa exige CNPJ válido do contratante, análise e assinatura de termo de uso; a finalidade e as restrições devem ser verificadas no contrato.

### Bases abertas CNPJ / Receita Federal
- Boa camada de descoberta cadastral e segmentação por CNAE/município, sem custo de licença para os dados públicos da Receita.
- Não resolve, sozinha, o requisito de contatos comerciais confiáveis e atualizados. Deve ser combinada com fonte de contato que permita uso e armazenamento.

## Piloto inicial

- Geografia: municípios do estado do Rio de Janeiro.
- CNAE inicial a validar com o comercial/contábil: 4781-4/00 (comércio varejista de artigos do vestuário e acessórios). Não assumir que todo CNPJ desse CNAE seja loja multimarcas ou revendedor adequado.
- Limite técnico sugerido para o primeiro teste: até 10 empresas por consulta, uma cidade por vez.
- Não agendar nem executar chamadas pagas automaticamente antes de configurar limite financeiro mensal e obter autorização do usuário.
- Métricas: estabelecimentos encontrados; percentual com telefone; percentual com e-mail; percentual com endereço completo; duplicados; ativos; aderência comercial; custo por lead completo.

## Regras de segurança e qualidade

- Não coletar telefone pessoal de sócio/administrador como se fosse telefone da loja. Priorizar telefone institucional/comercial.
- Não inferir WhatsApp a partir de telefone sem validação.
- Não disparar mensagens automaticamente nesta fase.
- Guardar fonte e data da coleta por campo quando possível.
- Implementar lista de supressão/opt-out para impedir novas abordagens após oposição.
- Não usar dados de crédito para pontuar potencial de revenda. Score comercial e análise de crédito são processos separados.
- Não expor chaves em código, logs, frontend ou histórico de atividades. Usar variáveis de ambiente.
- Não realizar scraping que contorne login, CAPTCHA, bloqueios ou termos de uso.

## Bloqueios para ativação

1. Receber chave de API e documentação/contrato específico da DadosAPI.
2. Confirmar por escrito preço por registro, campos de contato, direito de armazenar e atualizar dados e uso para prospecção B2B.
3. Configurar segredo e teto mensal de gastos no ambiente de preview.
4. Implementar adapter, limite por chamada, logs de consumo e botão de execução manual.
5. Validar o primeiro lote do RJ antes de habilitar cron.
6. Só depois ativar coleta recorrente com orçamento aprovado.

## Estado atual

Este documento é a especificação técnica e de contratação. O coletor automático ainda não está ativo e não há chamadas à API, porque não existe chave nem contrato aprovado. A migration e o módulo de prospecção continuam isolados na branch de desenvolvimento.
