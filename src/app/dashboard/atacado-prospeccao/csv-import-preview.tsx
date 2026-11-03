"use client";

import { useState } from "react";
import { importarProspectosCsvAction } from "./actions";

function parseLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      result.push(value.trim()); value = "";
    } else value += char;
  }
  result.push(value.trim());
  return result;
}

export function CsvImportPreview() {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState("");

  async function inspect(selected: File | null) {
    setFile(selected);
    setHeaders([]);
    setRows([]);
    setError("");
    if (!selected) return;
    if (selected.size > 900 * 1024) { setError("Arquivo acima do limite de 900 KB."); return; }
    const text = (await selected.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) { setError("A planilha precisa ter cabeçalho e pelo menos uma linha."); return; }
    if (lines.length > 501) { setError("Limite de 500 lojas por arquivo."); return; }
    const delimiter = (lines[0].match(/;/g) ?? []).length > (lines[0].match(/,/g) ?? []).length ? ";" : ",";
    const parsedHeaders = parseLine(lines[0], delimiter);
    if (!parsedHeaders.some((h) => h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "") === "nomefantasia" || ["nome", "loja", "empresa", "nomeloja"].includes(h.toLowerCase()))) {
      setError("Não encontrei a coluna obrigatória nome_fantasia (ou nome/loja/empresa).");
      return;
    }
    setHeaders(parsedHeaders);
    setRows(lines.slice(1, 6).map((line) => parseLine(line, delimiter)));
  }

  return (
    <div>
      <form action={importarProspectosCsvAction} className="mt-3 space-y-3">
        <input required type="file" name="arquivo" accept=".csv,text/csv" onChange={(event) => inspect(event.target.files?.[0] ?? null)} className="max-w-full text-xs text-[var(--text-secondary)]" />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {headers.length > 0 && file && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)]">{file.name} · {(file.size / 1024).toFixed(1)} KB · prévia das primeiras {rows.length} linhas (de até 500).</p>
            <div className="overflow-x-auto rounded border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead><tr>{headers.map((h, i) => <th key={i} className="whitespace-nowrap border-b border-[var(--border)] px-2 py-2">{h}</th>)}</tr></thead>
                <tbody>{rows.map((row, i) => <tr key={i}>{headers.map((_, j) => <td key={j} className="max-w-48 truncate border-b border-[var(--border)] px-2 py-2">{row[j] ?? ""}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium">Confirmar importação</button>
          </div>
        )}
      </form>
    </div>
  );
}
