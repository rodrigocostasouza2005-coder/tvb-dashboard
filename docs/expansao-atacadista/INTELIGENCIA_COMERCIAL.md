# Ciclo de inteligência comercial — prospecção TVB

## Papéis
- **Agentes de prospecção:** descobrem estabelecimentos e entregam registros com nome comercial, cidade, links e evidências públicas.
- **Agente de validação:** confirma identidade/atividade, elimina duplicatas e recomenda grupo A/B/C/D com justificativa e confiança. A ausência de evidência mantém PENDENTE; CNAE isolado nunca classifica.
- **Bruce (assessor de vendas):** recebe oportunidades qualificadas, apoia o relacionamento e registra cada interação, objeção, resposta e avanço. Bruce não é o agente de prospecção e não atribui sozinho o grupo.
- **Agente de inteligência comercial:** lê os resultados estruturados do funil, identifica perfis que convertem e recomenda segmentos semelhantes aos agentes de prospecção.

## Eventos que alimentam o aprendizado
A API aceita resultados: `INTERESSADO`, `SEM_RESPOSTA`, `RECUSOU`, `PEDIU_CATALOGO`, `PEDIU_PRECO`, `NEGOCIANDO`, `PEDIDO_REALIZADO`, `RECOMPRA`, `SEM_ADERENCIA`, `DADOS_INVALIDOS`, `OUTRO`.

Canais: `TELEFONE`, `EMAIL`, `INSTAGRAM`, `WHATSAPP`, `PRESENCIAL`, `OUTRO`. Status: `NOVO`, `EM_QUALIFICACAO`, `QUALIFICADO`, `CONTATADO`, `NEGOCIACAO`, `CONVERTIDO`, `DESCARTADO`.

Uma resposta ou pedido de catálogo não é conversão. Conversão é registrada somente quando o status é `CONVERTIDO` (idealmente após confirmação do primeiro pedido no processo comercial). Recompra fica como evento separado.

## API para Bruce
Base: `/api/gpt/atacado`. Usa o Bearer token já existente no TVB Radar, sem criar credencial paga ou serviço paralelo.

- `GET ?resource=fila&limit=15`: devolve no máximo 25 oportunidades qualificadas/contatadas/em negociação, com as últimas três atividades.
- `POST`: registra uma interação. JSON: `{ prospectId, descricao, resultado?, canal?, status?, etapa? }`.
- `GET ?resource=inteligencia`: mostra padrões por segmento, perfil de loja, faixa de preço e UF. Só sugere perfis com amostra mínima de três registros; não modifica classificação nem cria leads automaticamente.

## Ciclo de melhoria
1. Agentes prospectam e o agente de validação qualifica.
2. Bruce trabalha as oportunidades e registra eventos de forma estruturada.
3. A inteligência calcula taxas de conversão por perfil, separando avanço de compra.
4. Recomendações retornam aos agentes de prospecção como hipóteses para novas buscas.
5. O responsável comercial revisa as recomendações antes de ampliar a coleta.

## Guardrails
- Sem chamadas a LLM/API paga, Serasa, BigDataCorp ou fornecedor de enriquecimento.
- Sem envio automático de mensagens ou contato externo.
- Sem autoalteração silenciosa da rubrica A/B/C/D.
- Amostra mínima de três é apenas um primeiro filtro exploratório, não evidência estatística forte; aumentar o mínimo conforme o histórico crescer.
- Não coletar dados pessoais de sócios/administradores como contatos da loja.
- A API do Bruce é limitada à carteira de prospectos; não expõe vendas, estoque ou cadastro de clientes.
- Não executar migration em produção antes de validar schema, CI e preview.

## Agentes autônomos — primeira versão
- **Captação:** o workflow `.github/workflows/agentes-prospeccao.yml` consulta o dump público da Receita Federal, limitando a primeira onda a estabelecimentos ativos com CNAE principal 4781400, nome fantasia e telefone ou e-mail. A carga é limitada a 500 candidatos por execução e registra a origem do agente.
- **Qualificação cadastral:** `scripts/prospeccao/agente-qualificacao.ts` valida formato/dígitos do CNPJ, presença do CNAE principal, nome fantasia e contato; calcula score de completude cadastral e atribui a fila de validação no Radar.
- **Validação comercial:** continua sendo uma etapa distinta. Receita Federal não comprova que a loja seja multimarcas, venda moda masculina, tenha posicionamento/preço aderente ou esteja aberta. Até haver evidência pública comercial, o grupo A/B/C/D fica PENDENTE e `nomeComercialVerificado=false`.
- **Operação:** execução semanal automática para RJ e execução manual para RJ, SP, ES, PR, SC, RS, BA, SE, AL, PE, PB, RN, CE, PI, MA, PA, AP e MG. O lote de importação é limitado para evitar inundar a carteira.
- **Bruce:** permanece somente no Radar, acompanhando oportunidades e registrando resultados. Não prospecta, não atribui leads e não acessa GPT externo.

O score desta etapa mede completude/consistência cadastral, não potencial de compra nem probabilidade de conversão. O primeiro ciclo de aprendizado comercial só ganha força depois de interações reais registradas pelo Bruce.
