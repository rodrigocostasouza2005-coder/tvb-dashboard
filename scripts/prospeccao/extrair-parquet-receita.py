#!/usr/bin/env python3
"""Extrai candidatos ativos de varejo de moda diretamente do espelho Parquet da Receita. Sem limite por padrão; use --limite apenas em testes.

A leitura é remota via DuckDB/Hugging Face; não baixa nem descompacta o dump nacional.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import duckdb

# Dicionário DOCUMENTAL apenas — a query SQL abaixo (ver `filtrados`) filtra por um único CNAE
# hardcoded ('4781400'), nunca por este dicionário. NÃO adicionar de volta o CNAE de suvenires/
# bijuterias/semijoias/artesanato: é uma categoria de exclusão aprovada pelo motor de qualificação
# (CategoriaBloqueio "JOALHERIA_BIJUTERIA" em src/lib/prospeccao/motor-elegibilidade.ts) e incluí-la
# aqui já causou confusão numa auditoria anterior — se algum dia este dicionário passar a ser
# usado de fato no SQL (hoje não é), bijuterias precisam continuar fora dele (ver teste de
# regressão em scripts/prospeccao/tests/test_extrair_parquet_receita.py).
CNAES = {
    "4781400": "Comércio varejista de artigos do vestuário e acessórios",
    "4782201": "Comércio varejista de calçados",
    "4782202": "Comércio varejista de artigos de viagem",
}
BASE = "hf://datasets/cnpjaberto/cnpj-dados-receita-brasil-{competencia}"
ESTADOS_LITORANEOS = {"AL", "AP", "BA", "CE", "ES", "MA", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RS", "SC", "SE", "SP"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competencia", default="2026-10")
    parser.add_argument("--uf", default=None, help="UF única (compatibilidade)")
    parser.add_argument("--ufs", nargs="+", default=None, help="Uma ou mais UFs litorâneas")
    parser.add_argument("--saida", default="dados/prospects-receita.parquet")
    parser.add_argument("--limite", type=int, default=0, help="limite opcional para testes; 0 = sem limite")
    args = parser.parse_args()

    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", args.competencia):
        parser.error("Competência inválida; use AAAA-MM.")
    ufs = {item.upper() for item in (args.ufs or ([args.uf] if args.uf else ["RJ"]))}
    invalidas = ufs - ESTADOS_LITORANEOS
    if not ufs or invalidas:
        parser.error("Informe somente UFs litorâneas válidas: " + ", ".join(sorted(ESTADOS_LITORANEOS)))
    ufs_sql = ", ".join(chr(39) + uf + chr(39) for uf in sorted(ufs))
    if args.limite < 0:
        parser.error("--limite não pode ser negativo.")
    limit_sql = f"LIMIT {args.limite}" if args.limite else ""
    base = BASE.format(competencia=args.competencia)
    establishments = base + "/estabelecimentos/*.parquet"
    companies = base + "/empresas/*.parquet"
    municipalities = base + "/municipios/*.parquet"

    # Garante que o diretório de saída exista no runner limpo do GitHub Actions.
    Path(args.saida).parent.mkdir(parents=True, exist_ok=True)

    # SQL literal seguro: os únicos valores interpolados já passaram por regex.
    con = duckdb.connect()
    con.execute("SET threads = 4")
    con.execute("SET memory_limit = '5GB'")
    sql = f"""
    COPY (
      WITH filtrados AS (
        SELECT
          s.cnpj_basico, s.cnpj_ordem, s.cnpj_dv, s.nome_fantasia,
          s.cnae_fiscal_principal, s.cnae_fiscal_secundaria,
          s.uf, s.municipio, s.ddd1, s.telefone1, s.ddd2, s.telefone2,
          s.correio_eletronico
        FROM read_parquet('{establishments}') s
        WHERE s.uf IN ({ufs_sql})
          AND s.situacao_cadastral = '02'
          -- Filtro inicial: vestuário como CNAE principal, nome fantasia e contato.
          AND s.cnae_fiscal_principal = '4781400'
          AND trim(coalesce(s.nome_fantasia, '')) <> ''
          AND (
            length(trim(coalesce(s.telefone1, ''))) > 0
            OR length(trim(coalesce(s.telefone2, ''))) > 0
            OR length(trim(coalesce(s.correio_eletronico, ''))) > 0
          )
      )
      SELECT
        coalesce(nullif(trim(f.nome_fantasia), ''), 'NOME COMERCIAL NÃO IDENTIFICADO') AS nome_fantasia,
        coalesce(e.razao_social, '') AS razao_social,
        f.cnpj_basico || f.cnpj_ordem || f.cnpj_dv AS cnpj,
        coalesce(m.descricao, '') AS cidade,
        coalesce(f.municipio, '') AS codigo_municipio,
        f.uf AS uf,
        coalesce(nullif(trim(coalesce(f.ddd1, '') || coalesce(f.telefone1, '')), ''),
                 nullif(trim(coalesce(f.ddd2, '') || coalesce(f.telefone2, '')), ''), '') AS telefone,
        coalesce(f.correio_eletronico, '') AS email,
        '' AS site,
        f.cnae_fiscal_principal AS cnae_principal,
        f.cnae_fiscal_principal AS cnae_correspondente,
        'PRINCIPAL' AS tipo_correspondencia,
        'Comércio varejista de artigos do vestuário e acessórios' AS cnae_descricao,
        coalesce(e.porte_empresa, '') AS porte,
        'receita_federal_dados_abertos' AS origem,
        'https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj' AS evidencia_url,
        '{args.competencia}' AS competencia
      FROM filtrados f
      LEFT JOIN read_parquet('{companies}') e USING (cnpj_basico)
      LEFT JOIN read_parquet('{municipalities}') m
        ON lpad(trim(CAST(f.municipio AS VARCHAR)), 4, '0') = lpad(trim(CAST(m.codigo AS VARCHAR)), 4, '0')
      {limit_sql}
    ) TO '{Path(args.saida).as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD);
    """
    try:
        con.execute(sql)
        output_path = Path(args.saida)
        count = con.execute(
            "SELECT count(*) FROM read_parquet(?)", [str(output_path)]
        ).fetchone()[0]
        hasher = hashlib.sha256()
        with output_path.open("rb") as parquet_file:
            for chunk in iter(lambda: parquet_file.read(8 * 1024 * 1024), b""):
                hasher.update(chunk)
        digest = hasher.hexdigest()
        by_uf = con.execute(
            "SELECT uf, count(*) FROM read_parquet(?) GROUP BY uf ORDER BY uf",
            [str(output_path)],
        ).fetchall()
        manifest = {
            "schema_version": 1,
            "source": "receita_federal_dados_abertos",
            "competencia": args.competencia,
            "ufs": sorted(ufs),
            "rows": count,
            "rows_by_uf": {uf: rows for uf, rows in by_uf},
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sha256": digest,
            "filter": {
                "situacao_cadastral": "02",
                "cnae_principal": "4781400",
                "nome_fantasia_required": True,
                "contact_required": ["telefone", "email"],
                "contact_logic": "telefone OR email"
            },
            "commercially_verified": False,
            "neon_imported": False
        }
        manifest_path = output_path.with_suffix(output_path.suffix + ".manifest.json")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Competência={args.competencia} | UFs={sorted(ufs)} | candidatos={count} | parquet={output_path} | sha256={digest}")
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
