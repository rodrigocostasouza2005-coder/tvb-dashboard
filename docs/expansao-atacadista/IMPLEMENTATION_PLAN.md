# Expansão Atacadista — plano de implementação

## Objetivo

Adicionar ao Radar da TVB um módulo de prospecção e gestão de potenciais revendedores, reutilizando a aplicação, autenticação, banco e infraestrutura existentes. Não criar aplicação paralela.

## Escopo inicial

- Brasil: municípios dos 17 estados litorâneos e polos comerciais próximos.
- Segmentos prioritários: lojas de moda masculina, multimarcas, boutiques e varejistas de vestuário com aderência ao posicionamento da TVB.
- Serasa: integração futura e opcional. Nenhum fluxo pode depender dela.
- O agente recomenda e organiza; aprovação, concessão de prazo e decisão de crédito permanecem humanas.

## Princípios

1. Separar descoberta de empresas, enriquecimento cadastral, qualificação comercial e análise de crédito.
2. Não confundir score comercial próprio com score de crédito.
3. Registrar fonte, URL, data de coleta e nível de confiança de cada dado.
4. Deduplicar por CNPJ normalizado; quando não houver CNPJ, usar combinação conservadora de nome, telefone e endereço.
5. Não inventar contatos ou completar campos com inferências apresentadas como fatos.
6. Respeitar termos de uso, LGPD, bases legais aplicáveis, limites de acesso e políticas das fontes. Não contornar login, CAPTCHA ou bloqueios.
7. Não disparar mensagens em massa nem abordar contatos automaticamente na primeira versão.
8. Não executar migrations nem operações destrutivas em produção durante desenvolvimento.

## Fluxo funcional

1. **Descoberta:** importar leads por CSV e conectar fontes de descoberta por adaptadores independentes. A fonte de descoberta deve ser explícita; APIs cadastrais não descobrem lojas por si só.
2. **Normalização:** padronizar CNPJ, razão/nome fantasia, município/UF, telefone, domínio e endereço.
3. **Validação cadastral:** consultar fontes públicas permitidas para situação cadastral, CNAE, município e data de abertura; guardar data e origem. Ausência de dado não equivale a reprovação.
4. **Deduplicação:** localizar registros existentes e consolidar evidências sem apagar histórico.
5. **Qualificação comercial:** estimar aderência ao perfil TVB usando critérios explicáveis: segmento, evidência de operação, posicionamento, presença digital, localização e cobertura regional.
6. **Fila humana:** permitir revisar, aprovar, rejeitar, marcar duplicado, atribuir responsável e registrar próximo passo.
7. **CRM leve:** histórico de interações, status, observações, tarefas e exportação.
8. **Crédito futuro:** interface de provedor desacoplada; Serasa será um adaptador opcional ativado somente após confirmação contratual e credenciais.

## Score comercial (não é score de crédito)

Começar com pontuação transparente e baseada apenas em evidências disponíveis. Exibir fatores positivos, negativos, dados ausentes e confiança. Não inferir capacidade financeira, inadimplência ou risco de crédito a partir de presença digital ou porte aparente. A pontuação nunca aprova automaticamente um revendedor.

## Fases de entrega

### Fase 0 — auditoria e desenho
- Mapear rotas, navegação, permissões, padrões de API e modelos Prisma existentes.
- Identificar possíveis funcionalidades de atacado/cliente já implementadas para evitar duplicação.
- Definir entidades e índices após a auditoria.

### Fase 1 — fundação segura
- Criar modelos para lead empresarial, evidências/fontes, execução de prospecção e histórico de atividades, reutilizando entidades existentes quando adequado.
- Criar APIs autenticadas e autorizadas.
- Adicionar testes de normalização, deduplicação, scoring e permissões.
- Criar página inicial do módulo com métricas reais e estados vazios honestos.

### Fase 2 — entrada e enriquecimento
- Importação CSV com prévia, validação e relatório de erros.
- Adaptadores de consulta cadastral com cache, rate limit, timeout e trilha de auditoria.
- Nunca depender de um único fornecedor.

### Fase 3 — descoberta regional
- Conectar fonte(s) de descoberta com custo e termos avaliados antes da ativação.
- Busca por UF, município, segmento e palavras-chave; limites e orçamento por execução.
- Piloto controlado no RJ antes da expansão nacional.

### Fase 4 — qualificação e CRM
- Filtros, mapa/ranking, fila de revisão, atribuição e histórico comercial.
- Exportação e relatórios de cobertura/qualidade.

### Fase 5 — crédito opcional
- Adaptador Serasa isolado, com consentimento/permissão e contrato verificados, controle de custo por consulta e logs.
- Nunca misturar dados de crédito com score de potencial comercial.

## Critérios de aceite do MVP

- Um usuário autorizado consegue importar uma planilha, visualizar erros antes de confirmar e salvar leads válidos.
- CNPJs são normalizados e duplicidades são sinalizadas sem perda de histórico.
- Cada campo enriquecido mostra fonte e data.
- O score explica os fatores e não se apresenta como análise de crédito.
- A fila permite revisão humana e histórico de decisões.
- Nenhuma consulta Serasa é feita; nenhuma credencial é exigida.
- Testes automatizados cobrem validação, deduplicação, scoring e autorização.
- Build, lint e testes passam; nenhuma alteração é aplicada diretamente em produção.

## Riscos e decisões pendentes

- Descoberta nacional de lojas exige uma fonte própria de leads; BrasilAPI/Receita cadastral validam CNPJ, mas não substituem um diretório de estabelecimentos.
- Avaliar custos, cobertura, licença de uso e LGPD de qualquer fonte de descoberta antes de integrar.
- Confirmar no código atual os modelos/rotas de clientes, atacado e permissões antes de criar schema novo.
