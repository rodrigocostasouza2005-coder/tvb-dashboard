import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "gerar-prospects-rj.py"


def establishment(cnpj="11222333000181", uf="RJ", status="02", cnae="4781400"):
    row = [""] * 30
    row[0], row[1], row[2] = cnpj[:8], cnpj[8:12], cnpj[12:]
    row[4] = "LOJA TESTE"
    row[5] = status
    row[11] = cnae
    row[12] = ""
    row[19] = uf
    row[20] = "6001"
    row[21], row[22] = "21", "22223333"
    row[27] = "CONTATO@EXEMPLO.COM"
    return row


class ReceitaProspectorTests(unittest.TestCase):
    def run_script(self, root, rows, competence="2026-10", ufs=None):
        establishments = root / "Estabelecimentos.csv"
        companies = root / "Empresas.csv"
        municipalities = root / "Municipios.csv"
        output = root / "saida.csv"
        with establishments.open("w", encoding="latin-1", newline="") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerows(rows)
        with companies.open("w", encoding="latin-1", newline="") as f:
            csv.writer(f, delimiter=";").writerow(
                ["11222333", "EMPRESA TESTE LTDA", "2062", "49", "10000,00", "03", ""]
            )
        with municipalities.open("w", encoding="latin-1", newline="") as f:
            csv.writer(f, delimiter=";").writerow(["6001", "RIO DE JANEIRO"])
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--estabelecimentos", str(establishments),
             "--empresas", str(companies), "--municipios", str(municipalities),
             "--saida", str(output), "--competencia", competence,
             *(["--ufs", *ufs] if ufs else ["--uf", "RJ"])],
            capture_output=True, text=True,
        )
        return result, output

    def test_exports_only_active_rj_target_cnae_with_valid_cnpj(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                establishment(),
                establishment("11222333000181", status="01"),
                establishment("11222333000181", uf="SP"),
                establishment("11222333000181", cnae="4711301"),
                establishment("11222333000180"),  # dígito verificador inválido
            ]
            result, output = self.run_script(root, rows)
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8-sig", newline="") as f:
                data = list(csv.DictReader(f, delimiter=";"))
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["cnpj"], "11222333000181")
            self.assertEqual(data[0]["cidade"], "RIO DE JANEIRO")
            self.assertEqual(data[0]["telefone"], "2122223333")
            self.assertEqual(data[0]["competencia"], "2026-10")

    def test_multi_uf_keeps_only_selected_company_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            establishments = root / "Estabelecimentos.csv"
            companies = root / "Empresas.csv"
            municipalities = root / "Municipios.csv"
            output = root / "saida.csv"
            rows = [establishment(uf="RJ"), establishment("12ABC34501DE35", uf="ES")]
            with establishments.open("w", encoding="latin-1", newline="") as f:
                csv.writer(f, delimiter=";").writerows(rows)
            with companies.open("w", encoding="latin-1", newline="") as f:
                writer = csv.writer(f, delimiter=";")
                writer.writerow(["11222333", "EMPRESA RJ", "2062", "49", "10000,00", "03", ""])
                writer.writerow(["99999999", "EMPRESA NÃO SELECIONADA", "2062", "49", "10000,00", "03", ""])
                writer.writerow(["12ABC345", "EMPRESA ES", "2062", "49", "10000,00", "03", ""])
            with municipalities.open("w", encoding="latin-1", newline="") as f:
                csv.writer(f, delimiter=";").writerow(["6001", "RIO DE JANEIRO"])
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--estabelecimentos", str(establishments),
                 "--empresas", str(companies), "--municipios", str(municipalities),
                 "--saida", str(output), "--ufs", "RJ", "ES", "--competencia", "2026-10"],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8-sig", newline="") as f:
                data = list(csv.DictReader(f, delimiter=";"))
            self.assertEqual({row["razao_social"] for row in data}, {"EMPRESA RJ", "EMPRESA ES"})
            self.assertIn("ativos examinados=2", result.stderr)
            self.assertIn("com CNAE-alvo=2", result.stderr)

    def test_ignores_vestuario_only_as_secondary_cnae(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            row = establishment(cnae="5611201")  # restaurante como atividade principal
            row[12] = "4781400"  # vestuário apenas como atividade secundária
            result, output = self.run_script(root, [row])
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8-sig", newline="") as f:
                data = list(csv.DictReader(f, delimiter=";"))
            self.assertEqual(data, [])

    def test_deduplicates_repeated_cnpj(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result, output = self.run_script(
                root, [establishment(), establishment()]
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8-sig", newline="") as f:
                data = list(csv.DictReader(f, delimiter=";"))
            self.assertEqual(len(data), 1)

    def test_collects_multiple_coastal_states_in_one_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [establishment("11222333000181", uf="RJ"),
                    establishment("12ABC34501DE35", uf="ES")]
            result, output = self.run_script(root, rows, ufs=["RJ", "ES"])
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8-sig", newline="") as f:
                data = list(csv.DictReader(f, delimiter=";"))
            self.assertEqual({row["uf"] for row in data}, {"RJ", "ES"})
            self.assertEqual(len(data), 2)

    def test_accepts_official_alphanumeric_cnpj(self):
        # Exemplo publicado pela Receita Federal: 12.ABC.345/01DE-35.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            row = establishment("12ABC34501DE35")
            result, output = self.run_script(root, [row])
            self.assertEqual(result.returncode, 0, result.stderr)
            with output.open(encoding="utf-8-sig", newline="") as f:
                data = list(csv.DictReader(f, delimiter=";"))
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["cnpj"], "12ABC34501DE35")

    def test_rejects_invalid_competence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result, _ = self.run_script(root, [establishment()], "2026-13")
            self.assertNotEqual(result.returncode, 0)

    def test_fails_on_wrong_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result, _ = self.run_script(root, [["too", "short"]])
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("esperado", result.stderr)


if __name__ == "__main__":
    unittest.main()
