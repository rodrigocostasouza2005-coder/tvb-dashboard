import unittest
from unittest.mock import patch

from scripts.prospeccao import baixar_receita_cnpj as downloader


class ReceitaDownloaderTests(unittest.TestCase):
    def test_matches_only_requested_official_zip_families(self):
        names = [
            "Estabelecimentos0.zip", "Estabelecimentos9.zip",
            "Empresas0.zip", "Municipios.zip", "Socios0.zip",
            "Estabelecimentos.csv", "Leiaute.zip",
        ]
        selected = [
            name for name in names
            if any(pattern.fullmatch(name) for pattern in downloader.FAMILY_PATTERNS.values())
        ]
        self.assertEqual(
            selected,
            ["Estabelecimentos0.zip", "Estabelecimentos9.zip", "Empresas0.zip", "Municipios.zip"],
        )

    @patch("scripts.prospeccao.baixar_receita_cnpj.list_directory")
    def test_discovers_latest_competence(self, list_directory):
        list_directory.return_value = [
            {"name": "2026-08", "directory": True},
            {"name": "2026-10", "directory": True},
            {"name": "2026-09", "directory": True},
            {"name": "arquivo.txt", "directory": False},
        ]
        competence, url = downloader.discover_competence("token", "Dados/CNPJ")
        self.assertEqual(competence, "2026-10")
        self.assertTrue(url.endswith("/2026-10/"))

    def test_rejects_non_zip_names_and_unrelated_files(self):
        for name in ["Estabelecimentos.zip", "Estabelecimentos10.csv", "Empresas.zip", "Socios0.zip"]:
            self.assertFalse(any(pattern.fullmatch(name) for pattern in downloader.FAMILY_PATTERNS.values()))


if __name__ == "__main__":
    unittest.main()
