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
- UF RJ;
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
  --uf RJ \
  --competencia 2026-10 \
  --saida /dados/prospects-rj.csv
```

Substitua caminhos e competência pelos arquivos efetivamente baixados. Inclua todas as partições da competência.

## Testes automatizados

A suíte em `scripts/prospeccao/tests/` cobre seleção de estabelecimentos ativos do RJ, CNAE-alvo, validação de CNPJ numérico e do exemplo alfanumérico oficial da Receita, competência inválida e falha para layout curto. O workflow `.github/workflows/prospeccao-python-tests.yml` executa esses testes. CI aprovado não equivale a validação com o dump real da Receita.

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
