# Importador gratuito da Receita Federal — piloto RJ

## Decisão de arquitetura

- Fonte primária: arquivos públicos do Cadastro Nacional da Pessoa Jurídica (CNPJ), publicados pela Receita Federal.
- Sem chave, API paga, assinatura, trial ou cobrança por consulta.
- O processamento é offline/em lote. Não roda em Server Action, rota HTTP ou função Vercel.
- O CSV gerado passa pela tela de prévia/importação já existente em `/dashboard/atacado-prospeccao`.
- Não gravar a base nacional inteira no Neon. Só candidatos revisados entram na carteira.
- Não importar dados de sócios/administradores nem inferir WhatsApp. Telefone/e-mail são os campos comerciais públicos que constarem no cadastro, sujeitos a desatualização.

## Arquivos e layout

A Receita publica arquivos ZIP sem cabeçalho, CSV separado por ponto e vírgula, codificação Latin-1. Para montar os campos do estabelecimento, o layout relevante é:
- `Estabelecimentos`: 30 colunas; contém CNPJ completo, nome fantasia, situação, CNAEs, endereço, UF, município, telefones e e-mail.
- `Empresas`: 7 colunas; contém raiz do CNPJ e razão social/porte.
- `Municipios`: código e descrição.

Use arquivos da MESMA competência. O importador valida o número mínimo de colunas e falha fechado se o layout não corresponder.

Fonte e dicionário oficial: https://www.gov.br/receitafederal/dados e https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf

## Piloto

O script `scripts/prospeccao/gerar-prospects-rj.py` filtra:
- UF RJ;
- situação cadastral ativa;
- CNAEs iniciais de vestuário, calçados, artigos de viagem e bijuterias/acessórios.

A lista de CNAEs é uma hipótese inicial de prospecção, não uma definição final de ICP. Validar com a equipe comercial antes de ampliar para outros segmentos/UFs. O script exporta CSV compatível com o importador do dashboard.

## Execução manual controlada

1. Baixe a competência mais recente diretamente do repositório oficial da Receita.
2. Extraia localmente apenas os ZIPs necessários de Empresas, Estabelecimentos e Municipios.
3. Execute o script passando todos os arquivos particionados de Estabelecimentos e Empresas daquela competência.
4. Substitua `PREENCHER_AAAA-MM` pela competência real no CSV exportado.
5. Revise a amostra e os totais. Não importe sem validar competência, UF, situação e CNAE.
6. Use a prévia CSV do dashboard e confirme a importação.
7. Registre a competência e a data da carga no controle operacional.

Exemplo:

```bash
python scripts/prospeccao/gerar-prospects-rj.py \
  --estabelecimentos /dados/Estabelecimentos0.csv /dados/Estabelecimentos1.csv \
  --empresas /dados/Empresas0.csv /dados/Empresas1.csv \
  --municipios /dados/Municipios.csv \
  --uf RJ \
  --saida /dados/prospects-rj.csv
```

O comando acima é ilustrativo: inclua todas as partições disponibilizadas para a competência escolhida.

## Limitações conhecidas

- O cadastro é um retrato da competência, não um feed em tempo real.
- A Receita não garante que telefone/e-mail estejam presentes ou atualizados.
- O piloto não faz enriquecimento por sites, redes sociais ou diretórios.
- O script gera candidatos, não decide sozinho quem é bom revendedor. Porte, CNAE e localização ajudam a triagem, mas não substituem análise comercial.
- O importador atual do dashboard trata CNPJ duplicado como ignorado; ele não atualiza dados de um prospecto existente nem registra mudanças históricas automaticamente.
- O arquivo CSV atual do dashboard tem limite de 500 linhas. Para listas maiores, dividir em lotes ou ampliar o importador após testes.

## Atualização recorrente — ainda não ativada

A automação não deve ser ligada até existir:
1. detecção confiável da nova competência no repositório oficial;
2. download retomável/verificação de integridade;
3. armazenamento temporário com espaço suficiente;
4. execução fora da Vercel com custo zero comprovado;
5. staging e reconciliação por CNPJ (novo, alterado, inativo), sem duplicar CRM;
6. log de competência, contagens, erros e reprocessamento;
7. aprovação operacional do piloto.

Uma verificação semanal pode procurar competência nova, mas só haverá dados novos quando a Receita publicar uma carga. Não prometer atualização semanal da própria base.
