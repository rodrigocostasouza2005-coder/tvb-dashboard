#!/usr/bin/env python3
"""Gera candidatos B2B a partir dos CSVs públicos da Receita Federal.

Uso:
  python scripts/prospeccao/gerar-prospects-rj.py \
    --estabelecimentos /dados/Estabelecimentos0.csv /dados/Estabelecimentos1.csv \
    --empresas /dados/Empresas0.csv /dados/Empresas1.csv \
    --municipios /dados/Municipios.csv \
    --saida /dados/prospects-rj.csv

Os arquivos devem estar extraídos da MESMA competência. O script só lê
estabelecimentos do RJ, situação cadastral ativa e CNAEs de varejo de moda.
Não consulta APIs externas e não envia dados para terceiros.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

# Layout oficial: estabelecimentos tem 30 colunas; empresas tem 7.
# Foco TVB: somente comércio varejista de artigos do vestuário como CNAE principal.
CNAES_ALVO = {"4781400": "Comércio varejista de artigos do vestuário e acessórios"}
SITUACAO_ATIVA = "02"


def read_csv(paths: list[str], expected_min_columns: int):
    for filename in paths:
        with Path(filename).open("r", encoding="latin-1", newline="") as stream:
            reader = csv.reader(stream, delimiter=";", quotechar='"')
            for line_number, row in enumerate(reader, 1):
                if not row or all(not cell.strip() for cell in row):
                    continue
                if len(row) < expected_min_columns:
                    raise ValueError(
                        f"{filename}:{line_number}: esperado >= {expected_min_columns} "
                        f"campos, recebido {len(row)}. Confira a competência e o layout."
                    )
                yield filename, line_number, row


def digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")



def normalize_cnpj(value: str) -> str:
    """Remove pontuação e padroniza CNPJ numérico ou alfanumérico."""
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def valid_cnpj(value: str) -> bool:
    """Valida CNPJ numérico ou alfanumérico conforme regra oficial (ASCII - 48)."""
    number = normalize_cnpj(value)
    if not re.fullmatch(r"[A-Z0-9]{12}[0-9]{2}", number):
        return False
    if len(set(number)) == 1:
        return False

    def calculate(base: str, weights: tuple[int, ...]) -> str:
        total = sum((ord(char) - 48) * weight for char, weight in zip(base, weights))
        remainder = total % 11
        return str(0 if remainder < 2 else 11 - remainder)

    first = calculate(number[:12], (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    second = calculate(number[:12] + first, (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    return number[-2:] == first + second


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--estabelecimentos", nargs="+", required=True)
    parser.add_argument("--empresas", nargs="+", required=True)
    parser.add_argument("--municipios", required=True)
    parser.add_argument("--saida", required=True)
    parser.add_argument("--uf", default=None, help="UF única (compatibilidade)")
    parser.add_argument("--ufs", nargs="+", default=None, help="Lista de UFs para prospecção em lote")
    parser.add_argument("--competencia", required=True, help="Competência dos arquivos no formato AAAA-MM")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", args.competencia):
        parser.error("--competencia deve estar no formato AAAA-MM")

    ufs = {uf.upper() for uf in (args.ufs or ([args.uf] if args.uf else ["RJ"]))}
    if not ufs or any(not re.fullmatch(r"[A-Z]{2}", uf) for uf in ufs):
        parser.error("Informe UFs válidas com --uf ou --ufs")

    # Domínio de municípios: código;descrição. Arquivos da Receita não têm cabeçalho.
    municipios = {}
    for _, _, row in read_csv([args.municipios], 2):
        municipios[row[0].strip()] = row[1].strip()

    # Primeira passagem: descobrir somente as raízes de empresas que podem
    # virar prospect. Evita carregar milhões de empresas sem relação com o filtro.
    wanted_roots: set[str] = set()
    count_active = 0
    count_cnae = 0
    for _, _, row in read_csv(args.estabelecimentos, 30):
        uf = row[19].strip().upper()
        if uf not in ufs or row[5].strip() != SITUACAO_ATIVA:
            continue
        count_active += 1
        principal = digits(row[11])
        # CNAE secundário não qualifica a empresa: evita incluir negócios de outro ramo.
        if principal == "4781400":
            count_cnae += 1
            wanted_roots.add(row[0].strip())

    # Empresas: carregar apenas as raízes identificadas na primeira passagem.
    empresas = {}
    for _, _, row in read_csv(args.empresas, 7):
        root = row[0].strip()
        if root in wanted_roots:
            empresas[root] = {
                "razao_social": row[1].strip(),
                "porte": row[5].strip(),
            }

    output = Path(args.saida)
    output.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    count_written = 0

    # Estabelecimento (30 campos): raiz/ordem/DV; fantasia; situação; CNAEs;
    # endereço; UF/município; DDD/telefone; e-mail.
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=[
            "nome_fantasia", "razao_social", "cnpj", "cidade", "uf",
            "telefone", "email", "site", "cnae_principal", "cnae_descricao",
            "porte", "origem", "evidencia_url", "competencia",
        ], delimiter=";")
        writer.writeheader()

        for filename, line_number, row in read_csv(args.estabelecimentos, 30):
            uf = row[19].strip().upper()
            if uf not in ufs or row[5].strip() != SITUACAO_ATIVA:
                continue
            principal = digits(row[11])
            # Só entra quando vestuário é a atividade principal do estabelecimento.
            if principal != "4781400":
                continue

            raiz, ordem, dv = row[0].strip(), row[1].strip(), row[2].strip()
            cnpj = raiz + ordem + dv
            if not valid_cnpj(cnpj) or cnpj in seen:
                continue
            seen.add(cnpj)
            company = empresas.get(raiz, {})
            fantasy = row[4].strip() or company.get("razao_social") or "Estabelecimento sem nome fantasia"
            municipio_code = row[20].strip()
            cidade = municipios.get(municipio_code, municipio_code)
            ddd1, tel1, ddd2, tel2 = (row[i].strip() for i in (21, 22, 23, 24))
            phone = "".join(digits(x) for x in (ddd1, tel1)) or "".join(digits(x) for x in (ddd2, tel2))
            email = row[27].strip().lower() or ""
            cnae = principal
            writer.writerow({
                "nome_fantasia": fantasy[:160],
                "razao_social": company.get("razao_social", ""),
                "cnpj": cnpj,
                "cidade": cidade,
                "uf": uf,
                "telefone": phone,
                "email": email,
                "site": "",
                "cnae_principal": principal,
                "cnae_descricao": CNAES_ALVO.get(cnae, ""),
                "porte": company.get("porte", ""),
                "origem": "receita_federal_dados_abertos",
                "evidencia_url": "https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj",
                "competencia": args.competencia,
            })
            count_written += 1

    print(
        f"UFs={','.join(sorted(ufs))} | ativos examinados={count_active} | "
        f"com CNAE-alvo={count_cnae} | exportados={count_written} | arquivo={output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, csv.Error) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(2)
