# Importador gratuito da Receita Federal — piloto RJ

## Decisão de arquitetura

- Fonte primária: arquivos públicos do Cadastro Nacional da Pessoa Jurídica (CNPJ), publicados pela Receita Federal.
- Sem chave, API paga, assinatura, trial ou cobrança por consulta.
- O processamento é offline/em lote. Não roda em Server Action, rota HTTP ou função Vercel.
- O CSV gerado pode ser revisado e importado em `/dashboard/atacado-prospeccao`.
- Não gravar a base nacional inteira no Neon. Só candidatos revisados entram na carteira.
- Não importar dados de sócios/administradores nem inferir WhatsApp. Telefone/e-mail só são aproveitados quando constarem no cadastro público e podem estar desatualizados.

## Arquivos e layout

O script espera arquivos extraídos da mesma competência, sem cabeçalho, separados por ponto e vírgula e codificados em Latin-1:
- `Estabelecimentos`: ao menos 30 colunas;
- `Empresas`: ao menos 7 colunas;
- `Municipios`: código e descrição.

O script falha se encontrar linhas com menos colunas que o layout esperado. Fonte e dicionário: https://www.gov.br/receitafederal/dados e https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf.

## Piloto

O script `scripts/prospeccao/gerar-prospects-rj.py` filtra:
- Uma UF com `--uf RJ` (compatibilidade) ou várias UFs com `--ufs RJ ES SP ...`;
- UFs solicitadas, situação cadastral ativa;
- situação cadastral ativa;
- CNAEs iniciais de vestuário, calçados, artigos de viagem e bijuterias/acessórios.

A lista de CNAEs é uma hipótese inicial, não uma definição final do perfil de revendedor TVB. Validar com a equipe comercial antes de ampliar segmentos ou estados. O validador aceita CNPJ numérico legado e alfanumérico no formato oficial (12 posições alfanuméricas + 2 DVs numéricos).

## Execução manual controlada

1. Baixe a competência mais recente diretamente do repositório oficial da Receita.
2. Extraia localmente os arquivos de Empresas, Estabelecimentos e Municípios da mesma competência.
3. Passe todas as partições necessárias de Estabelecimentos e Empresas.
4. Informe a competência real no formato `AAAA-MM`.
5. Revise amostra e totais antes de importar.

Exemplo:

```bash
python scripts/prospeccao/gerar-prospects-rj.py \
  --estabelecimentos /dados/Estabelecimentos0.csv /dados/Estabelecimentos1.csv \
  --empresas /dados/Empresas0.csv /dados/Empresas1.csv \
  --municipios /dados/Municipios.csv \
  --ufs RJ ES SP \
  --competencia 2026-10 \
  --saida /dados/prospects-rj.csv
```

Substitua caminhos e competência pelos arquivos efetivamente baixados. Inclua todas as partições da competência.

## Testes automatizados

A suíte em `scripts/prospeccao/tests/` cobre seleção de estabelecimentos ativos do RJ, CNAE-alvo, validação de CNPJ numérico e do exemplo alfanumérico oficial da Receita, competência inválida e falha para layout curto. O workflow `.github/workflows/prospeccao-python-tests.yml` executa esses testes. CI aprovado não equivale a validação com o dump real da Receita.

## Situação cadastral sem Serpro (nov/2026)

O piloto real do RJ revelou que o critério EXISTENCIA do motor de qualificação
(`src/lib/prospeccao/motor-elegibilidade.ts`) só sai de `INCONCLUSIVO` quando o prospect tem
`situacaoCadastral` preenchido — e até esta mudança só a consulta oficial Serpro
(`scripts/prospeccao/consultar-cnpj-serpro.ts`) preenchia esse campo. Como o Rodrigo decidiu não
contratar o Serpro, nenhum prospect avançava além de `EM_INVESTIGACAO`/`REPROVADO`.

A extração (`scripts/prospeccao/extrair-parquet-receita.py`) já filtra por situação cadastral
ativa (`'02'`) direto na fonte antes de gerar qualquer candidato — esse dado só não era exportado.
Agora o script também exporta a coluna `situacao_cadastral` (código bruto de 2 dígitos da Receita),
e `scripts/prospeccao/importar-receita.ts` decodifica esse código via
`mapearSituacaoCadastralReceita` (em `src/lib/prospeccao/importador-receita.ts`) e grava
`situacaoCadastral`/`situacaoCadastralCodigo` no prospect — sem chamar o Serpro.

**Limitação conhecida:** esse dado é um retrato (snapshot) mensal da Receita Federal — a
competência exportada pelo script —, não uma verificação em tempo real como a consulta Serpro
seria. Para não inflar a confiança desse dado, ele é gravado com
`confiancaPesquisa = "CADASTRAL_RECEITA_SNAPSHOT"` (nunca `"CADASTRAL_OFICIAL"`, reservado ao
Serpro) e a observação do prospect registra explicitamente a competência de origem. O schema não
tem um campo de confiança dedicado à identidade cadastral (`confiancaPesquisa` é texto livre
reaproveitado para múltiplos sentidos ao longo do pipeline); criar um campo novo exigiria
migration, fora do escopo desta mudança — ver o código para o detalhe completo do porquê.

O caminho Serpro continua existindo e intacto como opção futura (ex.: para confirmar cadastros que
a extração não cobre, ou reverificar em tempo real); só deixou de ser a única fonte possível desse
critério.

## Limitações conhecidas

- O cadastro é um retrato da competência, não um feed em tempo real.
- Telefone/e-mail podem estar ausentes ou desatualizados.
- O piloto não faz enriquecimento por sites, redes sociais ou diretórios.
- CNPJs alfanuméricos seguem o cálculo oficial módulo 11 com valores ASCII menos 48; o script ainda precisa ser validado com dump oficial real pós-implantação.
- O importador do dashboard ignora CNPJ duplicado; não atualiza dados existentes nem mantém histórico de mudanças.
- O CSV do dashboard tem limite de 500 linhas. Para listas maiores, dividir em lotes até existir um fluxo de staging/reconciliação testado.

## Atualização recorrente — ainda não ativada

A automação não deve ser ligada até existir:
1. detecção confiável de nova competência;
2. download retomável e verificação de integridade;
3. armazenamento temporário com espaço suficiente;
4. execução fora da Vercel com custo zero comprovado;
5. staging e reconciliação por CNPJ;
6. logs, contagens, erros e reprocessamento;
7. aprovação operacional do piloto.

A base só muda quando a Receita publica uma nova competência. Não prometer atualização semanal dos próprios dados.


## Downloader retomável da Receita

O script `scripts/prospeccao/baixar_receita_cnpj.py` consulta o diretório público da Receita via WebDAV/Nextcloud, identifica a competência mais recente e lista os ZIPs das famílias selecionadas. Ele não extrai os arquivos.

Prévia segura (padrão; não baixa nada):

```bash
python scripts/prospeccao/baixar_receita_cnpj.py --dry-run
```

Baixar os arquivos de estabelecimentos e empresas, com limite de 12 GiB:

```bash
python scripts/prospeccao/baixar_receita_cnpj.py --familias estabelecimentos empresas --limite-gb 12 --download
```

Para baixar também municípios:

```bash
python scripts/prospeccao/baixar_receita_cnpj.py --familias estabelecimentos empresas municipios --limite-gb 12 --download
```

Os arquivos são salvos em `dados/receita-cnpj/AAAA-MM`. O download usa arquivo temporário `.part`, tenta retomar via HTTP Range, valida tamanho informado pelo servidor e testa CRC do ZIP antes de renomear para o nome final. Arquivos já íntegros são reaproveitados. Se o servidor não suportar retomada, o download reinicia do começo.

**Atenção:** o layout público da Receita pode mudar. A primeira execução deve ser feita em `--dry-run` para confirmar competência, nomes e tamanhos exibidos. O downloader não é executado no GitHub Actions/Vercel e não envia dados ao Neon. O caminho remoto padrão e o token público são configuráveis por `--remote-path` e `--token`. O limite é uma proteção operacional, não estimativa do tamanho futuro da base.


## Importação da base gerada para o painel

Após gerar o CSV com `gerar-prospects-rj.py`, execute primeiro a prévia (não grava dados):

```bash
npm run prospeccao:importar-receita -- --arquivo dados/prospects.csv --competencia 2026-10
```

Para gravar explicitamente no banco apontado por `DATABASE_URL`, acrescente `--apply`:

```bash
npm run prospeccao:importar-receita -- --arquivo dados/prospects.csv --competencia 2026-10 --apply
```

O importador exige nome fantasia, CNPJ e UF; remove CNPJs repetidos no próprio arquivo; grava em lotes de 400; ignora CNPJs já existentes sem atualizar cadastros revisados. Competência, CNAE e porte são preservados em observações. A origem fica marcada como `receita_federal_dados_abertos`. O modo padrão é prévia; `--apply` é obrigatório para gravar.

**Atenção:** confirme que `DATABASE_URL` aponta para o ambiente desejado. Este comando não baixa nem extrai os arquivos da Receita e não comprova que o estabelecimento é uma multimarcas adequada à TVB.


## Classificação de aderência comercial (nov/2026)

A extração Parquet diferencia explicitamente:
- `cnae_principal`: atividade principal cadastrada no CNPJ;
- `cnae_correspondente`: CNAE de vestuário/acessórios encontrado na atividade principal ou secundária;
- `tipo_correspondencia`: `PRINCIPAL` ou `SECUNDARIO`.

A classificação exibida no painel é **preliminar e baseada apenas no CNAE**, não comprova que a empresa seja uma multimarcas masculina nem que tenha interesse em comprar da TVB:
- Alta aderência: CNAE 4781400 como atividade principal;
- Complementar: calçados ou artigos de viagem como atividade principal;
- Baixa aderência: bijuterias/suvenires como atividade principal;
- Revisar: CNAE de moda encontrado somente entre atividades secundárias;
- Não classificado: cadastro manual ou sem CNAE registrado.

Não usar a etiqueta como decisão automática de contato. A próxima etapa comercial deve validar nome fantasia, presença digital, mix masculino e operação real da loja antes de promover o lead para qualificado.
