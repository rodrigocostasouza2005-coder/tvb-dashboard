"use client";

import { useMemo, useState } from "react";
import { aprovarCandidatosDescobertosAction } from "./actions";

type Candidate = {
  nomeResultado: string;
  url: string;
  dominio: string;
  trechoBusca: string;
  sinaisMasculino: string[];
  sinaisMultimarcas: string[];
  marcasEncontradas: string[];
  pontuacaoEvidencia: number;
  classificacao: string;
  perfilReferencia: string;
  nomeFantasia: string;
  cnpj: string;
  cidade: string;
  estado: string;
  selecionado: boolean;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
function isSafeHttpUrl(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password; } catch { return false; }
}

function parseList(value: string): string[] {
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

export function RevisaoCandidatosWeb({ defaultUf = "RJ" }: { defaultUf?: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFile(file?: File) {
    setCandidates([]);
    setFileName("");
    setError("");
    if (!file) return;
    if (file.size > 900 * 1024) { setError("Arquivo acima de 900 KB."); return; }
    try {
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      if (rows.length < 2) throw new Error("O CSV não contém candidatos.");
      const headers = rows[0].map((v) => v.trim());
      const index = (name: string) => headers.indexOf(name);
      const required = ["nomeResultado", "url", "dominio", "pontuacaoEvidencia", "sinaisMasculino", "sinaisMultimarcas", "marcasEncontradas"];
      if (required.some((key) => index(key) < 0)) throw new Error("Este não parece ser o CSV do agente de descoberta do Radar.");
      const parsed = rows.slice(1, 101).map((row): Candidate => {
        const get = (key: string) => row[index(key)] ?? "";
        return {
          nomeResultado: get("nomeResultado"),
          url: get("url"),
          dominio: get("dominio"),
          trechoBusca: get("trechoBusca"),
          sinaisMasculino: parseList(get("sinaisMasculino")),
          sinaisMultimarcas: parseList(get("sinaisMultimarcas")),
          marcasEncontradas: parseList(get("marcasEncontradas")),
          pontuacaoEvidencia: Number(get("pontuacaoEvidencia")) || 0,
          classificacao: get("classificacao"),
          perfilReferencia: get("perfilReferencia"),
          nomeFantasia: get("nomeResultado").slice(0, 160),
          cnpj: "",
          cidade: "",
          estado: defaultUf.toUpperCase(),
          selecionado: false,
        };
      }).filter((candidate) => candidate.classificacao === "CANDIDATO_PARA_REVISAO" && isSafeHttpUrl(candidate.url) && candidate.nomeFantasia);
      if (!parsed.length) throw new Error("Nenhum candidato válido para revisão foi encontrado.");
      setCandidates(parsed);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler o CSV.");
    }
  }

  function update(index: number, patch: Partial<Candidate>) {
    setCandidates((current) => current.map((candidate, i) => i === index ? { ...candidate, ...patch } : candidate));
  }

  const selected = useMemo(() => candidates.filter((candidate) => candidate.selecionado), [candidates]);
  const payload = useMemo(() => JSON.stringify(selected.map(({ nomeFantasia, cnpj, cidade, estado, url, trechoBusca, sinaisMasculino, sinaisMultimarcas, marcasEncontradas, perfilReferencia }) => ({
    nomeFantasia, cnpj, cidade, estado, site: url, trechoBusca, sinaisMasculino, sinaisMultimarcas, marcasEncontradas, perfilReferencia,
  }))), [selected]);

  return (
    <section className="border border-[var(--border)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em]">Revisão de descoberta web</div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">Importe o CSV do GitHub Actions. Nada entra na carteira até você selecionar a loja, informar os dados cadastrais e aprovar.</p>
      </div>
      <div className="space-y-3 p-4">
        <label className="block text-xs text-[var(--text-secondary)]">
          Arquivo CSV de candidatos
          <input type="file" accept=".csv,text/csv" onChange={(event) => loadFile(event.target.files?.[0])} className="mt-2 block max-w-full text-xs" />
        </label>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {fileName && <p className="text-[11px] text-[var(--text-muted)]">{fileName} · {candidates.length} candidatos carregados · {selected.length} selecionados</p>}
      </div>
      {candidates.length > 0 && (
        <form action={aprovarCandidatosDescobertosAction} onSubmit={() => setBusy(true)}>
          <input type="hidden" name="candidatos" value={payload} />
          <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {candidates.map((candidate, index) => (
              <article key={candidate.dominio + index} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <input aria-label={`Selecionar ${candidate.nomeFantasia}`} type="checkbox" checked={candidate.selecionado} onChange={(event) => update(index, { selecionado: event.target.checked })} className="mt-1 h-4 w-4 accent-amber-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={candidate.url} target="_blank" rel="noreferrer" className="break-all text-sm font-semibold underline">{candidate.nomeFantasia}</a>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">EVIDÊNCIA {candidate.pontuacaoEvidencia}/100</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">{candidate.dominio} · {candidate.perfilReferencia}</p>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">{candidate.trechoBusca}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {candidate.sinaisMasculino.map((signal) => <span key={signal} className="border border-[var(--border)] px-2 py-1 text-[10px]">{signal}</span>)}
                      {candidate.sinaisMultimarcas.map((signal) => <span key={signal} className="border border-[var(--border)] px-2 py-1 text-[10px]">{signal}</span>)}
                      {candidate.marcasEncontradas.map((brand) => <span key={brand} className="border border-amber-500/30 px-2 py-1 text-[10px]">{brand}</span>)}
                    </div>
                  </div>
                </div>
                {candidate.selecionado && (
                  <div className="grid gap-2 pl-7 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-[10px] text-[var(--text-muted)] sm:col-span-2">Nome comercial confirmado
                      <input required value={candidate.nomeFantasia} onChange={(event) => update(index, { nomeFantasia: event.target.value })} maxLength={160} className="mt-1 w-full border border-[var(--border)] bg-transparent px-2 py-2 text-xs text-[var(--text-primary)]" />
                    </label>
                    <label className="text-[10px] text-[var(--text-muted)]">CNPJ (obrigatório)
                      <input required value={candidate.cnpj} onChange={(event) => update(index, { cnpj: event.target.value })} placeholder="00.000.000/0000-00" maxLength={18} className="mt-1 w-full border border-[var(--border)] bg-transparent px-2 py-2 text-xs text-[var(--text-primary)]" />
                    </label>
                    <label className="text-[10px] text-[var(--text-muted)]">Cidade
                      <input required value={candidate.cidade} onChange={(event) => update(index, { cidade: event.target.value })} maxLength={100} className="mt-1 w-full border border-[var(--border)] bg-transparent px-2 py-2 text-xs text-[var(--text-primary)]" />
                    </label>
                    <label className="text-[10px] text-[var(--text-muted)]">UF
                      <input required value={candidate.estado} onChange={(event) => update(index, { estado: event.target.value.toUpperCase().slice(0, 2) })} maxLength={2} className="mt-1 w-full border border-[var(--border)] bg-transparent px-2 py-2 text-xs uppercase text-[var(--text-primary)]" />
                    </label>
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
            <p className="text-[10px] text-[var(--text-muted)]">CNPJ precisa passar nos dígitos verificadores. Isso não substitui consulta oficial de situação cadastral na Receita Federal.</p>
            <button type="submit" disabled={!selected.length || busy} className="border border-amber-500 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-700 disabled:opacity-40">{busy ? "Enviando..." : `Aprovar ${selected.length} para qualificação`}</button>
          </div>
        </form>
      )}
    </section>
  );
}
