#!/usr/bin/env python3
"""Extrai prospects ativos de varejo de moda diretamente do espelho Parquet da Receita.

A leitura é remota via DuckDB/Hugging Face; não baixa nem descompacta o dump nacional.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import duckdb

CNAES = {
    "4781400": "Comércio varejista de artigos do vestuário e acessórios",
    "4782201": "Comércio varejista de calçados",
    "4782202": "Comércio varejista de artigos de viagem",
    "4789001": "Comércio varejista de suvenires, bijuterias e artesanatos",
}
BASE = "hf://datasets/cnpjaberto/cnpj-dados-receita-brasil-{competencia}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competencia", default="2026-10")
    parser.add_argument("--uf", default="RJ")
    parser.add_argument("--saida", default="dados/prospects-rj.csv")
    args = parser.parse_args()

    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", args.competencia):
        parser.error("Competência inválida; use AAAA-MM.")
    uf = args.uf.upper()
    if not re.fullmatch(r"[A-Z]{2}", uf):
        parser.error("UF inválida.")
    base = BASE.format(competencia=args.competencia)
    establishments = base + "/estabelecimentos/*.parquet"
    companies = base + "/empresas/*.parquet"
    municipalities = base + "/municipios/*.parquet"
    cnaes = ", ".join("'" + code + "'" for code in CNAES)

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
        WHERE s.uf = '{uf}'
          AND s.situacao_cadastral = '02'
          -- Piloto estrito: vestuário como CNAE principal, nome fantasia e contato.
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
      ORDER BY
        CASE WHEN length(trim(coalesce(f.telefone1, ''))) > 0 OR length(trim(coalesce(f.telefone2, ''))) > 0 THEN 0 ELSE 1 END,
        CASE WHEN length(trim(coalesce(f.correio_eletronico, ''))) > 0 THEN 0 ELSE 1 END,
        f.cnpj_basico, f.cnpj_ordem
      LIMIT 500
    ) TO '{Path(args.saida).as_posix()}' (HEADER, DELIMITER ';', QUOTE '"', ESCAPE '"');
    """
    try:
        con.execute(sql)
        municipios_saida = str(Path(args.saida).with_name("municipios-receita.csv"))
        con.execute(f"""
          COPY (
            SELECT trim(CAST(codigo AS VARCHAR)) AS codigo,
                   trim(CAST(descricao AS VARCHAR)) AS descricao
            FROM read_parquet('{municipalities}')
          ) TO '{Path(municipios_saida).as_posix()}'
          (HEADER, DELIMITER ';', QUOTE '"', ESCAPE '"');
        """)
        count = con.execute(
            f"SELECT count(*) FROM read_csv('{Path(args.saida).as_posix()}', delim=';', header=true, all_varchar=true)"
        ).fetchone()[0]
        print(f"Competência={args.competencia} | UF={uf} | prospects exportados={count} | arquivo={args.saida}")
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
