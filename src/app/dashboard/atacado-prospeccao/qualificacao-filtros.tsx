"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";

// Filtros da seção "Qualificação B2B" — params próprios (qEstado/qMunicipio/qCapital/qClasse)
// pra não colidir com uf/cidade/status já usados pelo pipeline manual mais abaixo na
// mesma página. Mesmo padrão de controle inline de ProspectFilters (replace de URL, sem reload).
type Props = {
  estado: string;
  municipio: string;
  capital: string;
  classificacao: string;
  municipios: string[];
};

export function QualificacaoFiltros({ estado, municipio, capital, classificacao, municipios }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams(window.location.search);
    for (const [param, field] of [
      ["qEstado", "qEstado"],
      ["qMunicipio", "qMunicipio"],
      ["qCapital", "qCapital"],
      ["qClasse", "qClasse"],
    ] as const) {
      const value = String(form.get(field) ?? "").trim();
      if (value) params.set(param, value);
      else params.delete(param);
    }
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  const inputClass = "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm";
  return (
    <form onSubmit={applyFilters} className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label htmlFor="qEstado" className="text-xs text-[var(--text-muted)]">UF</label>
      <input id="qEstado" name="qEstado" defaultValue={estado} placeholder="RJ" maxLength={2} className={`${inputClass} w-14 uppercase`} />
      <label htmlFor="qMunicipio" className="text-xs text-[var(--text-muted)]">Município</label>
      <input id="qMunicipio" name="qMunicipio" list="qualificacao-municipios" defaultValue={municipio} placeholder="Rio de Janeiro" className={`${inputClass} w-40`} />
      <datalist id="qualificacao-municipios">{municipios.map((city) => <option key={city} value={city} />)}</datalist>
      <label htmlFor="qCapital" className="text-xs text-[var(--text-muted)]">Capital/interior</label>
      <select id="qCapital" name="qCapital" defaultValue={capital} className={inputClass}>
        <option value="">Todos</option>
        <option value="capital">Só capitais</option>
        <option value="interior">Só interior</option>
      </select>
      <label htmlFor="qClasse" className="text-xs text-[var(--text-muted)]">Classificação</label>
      <select id="qClasse" name="qClasse" defaultValue={classificacao} className={inputClass}>
        <option value="">Todas</option>
        <option value="ALTA_PRIORIDADE">Alta prioridade</option>
        <option value="QUALIFICADO">Qualificado</option>
      </select>
      <button disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
        {pending ? "Aplicando..." : "Filtrar"}
      </button>
    </form>
  );
}
