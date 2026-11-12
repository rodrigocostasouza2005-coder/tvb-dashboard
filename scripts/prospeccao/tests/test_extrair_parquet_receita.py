"""Regressão pontual (D4 da faxina pós-auditoria, 2026-11): o CNAE 4789001 (suvenires/
bijuterias/semijoias/artesanato) nunca pode voltar a aparecer em extrair-parquet-receita.py.

Bijuteria/semijoia é uma categoria de exclusão aprovada pelo motor de qualificação
(CategoriaBloqueio "JOALHERIA_BIJUTERIA" em src/lib/prospeccao/motor-elegibilidade.ts). O script
tinha esse CNAE só documentado no dicionário CNAES (nunca usado pela query SQL real, que filtra
`cnae_fiscal_principal = '4781400'` hardcoded) — uma armadilha: se alguém um dia "corrigir" a query
pra usar o dicionário completo em vez do literal, bijuterias entrariam automaticamente na base.

Este teste não importa o módulo (ele exige `duckdb` e acesso de rede a um dataset remoto no
Hugging Face, fora do escopo de um teste unitário) — inspeciona o código-fonte como texto, o que é
suficiente pra travar a regressão específica sem precisar de rede nem dependência pesada.
"""
import re
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "extrair-parquet-receita.py"


class CnaeBijuteriaRegressionTests(unittest.TestCase):
    def setUp(self):
        self.source = SCRIPT.read_text(encoding="utf-8")

    def test_cnae_bijuterias_nao_aparece_em_lugar_nenhum_do_arquivo(self):
        self.assertNotIn(
            "4789001",
            self.source,
            "CNAE de bijuterias/semijoias/artesanato (4789001) voltou a aparecer em "
            f"{SCRIPT.name} — essa categoria é excluída pelo motor de qualificação "
            "(JOALHERIA_BIJUTERIA); não deve existir nem como entrada documental no dicionário "
            "CNAES, e muito menos no filtro SQL ativo.",
        )

    def test_filtro_sql_ativo_usa_somente_4781400(self):
        match = re.search(r"cnae_fiscal_principal\s*=\s*'([0-9]+)'", self.source)
        self.assertIsNotNone(match, "Não encontrei o filtro de CNAE principal na query SQL ativa.")
        self.assertEqual(
            match.group(1),
            "4781400",
            "O filtro de CNAE principal na query SQL ativa mudou — confirme que nenhum CNAE de "
            "categoria excluída (ex.: 4789001, bijuterias) foi incluído no lugar de um literal "
            "único.",
        )


class SituacaoCadastralExportadaTests(unittest.TestCase):
    """Melhoria 1 (piloto RJ, nov/2026): o motor de qualificação (EXISTENCIA) só sai de
    INCONCLUSIVO com `situacaoCadastral` preenchido, e o Rodrigo decidiu não pagar Serpro. A
    extração já filtra por situação ativa ('02') direto na fonte — este teste garante que esse
    dado passa a ser EXPORTADO (não só usado como filtro interno) para o importador poder
    propagar `situacaoCadastral` sem depender do Serpro.
    """

    def setUp(self):
        self.source = SCRIPT.read_text(encoding="utf-8")

    def test_situacao_cadastral_e_selecionada_na_cte_de_filtrados(self):
        self.assertIn(
            "s.situacao_cadastral",
            self.source,
            "A coluna situacao_cadastral do estabelecimento precisa ser selecionada na CTE "
            "`filtrados` para poder ser exportada depois.",
        )

    def test_situacao_cadastral_e_exportada_na_selecao_final(self):
        self.assertIn(
            "f.situacao_cadastral AS situacao_cadastral",
            self.source,
            "A coluna situacao_cadastral precisa aparecer na SELECT final (saída do COPY) para "
            "chegar ao CSV/parquet consumido pelo importador.",
        )

    def test_manifesto_documenta_que_e_snapshot_mensal_nao_tempo_real(self):
        self.assertIn('"situacao_cadastral_fonte"', self.source)
        self.assertIn('"situacao_cadastral_tempo_real": False', self.source)


if __name__ == "__main__":
    unittest.main()
