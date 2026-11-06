"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";

type Props = {
  uf: string;
  cidade: string;
  status: string;
  cadastro: string;
  statusOptions: Array<[string, string]>;
  cadastroOptions: string[];
  cidades: string[];
};

export function ProspectFilters(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams(window.location.search);
    for (const key of ["uf", "cidade", "status", "cadastro"]) {
      const value = String(form.get(key) ?? "").trim();
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  const inputClass = "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm";
  return (
    <form onSubmit={applyFilters} className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label htmlFor="uf" className="text-xs text-[var(--text-muted)]">UF</label>
      <input id="uf" name="uf" defaultValue={props.uf} placeholder="RJ" maxLength={2} className={`${inputClass} w-14`} />
      <label htmlFor="cidade" className="text-xs text-[var(--text-muted)]">Cidade</label>
      <input id="cidade" name="cidade" list="cidades-prospects" defaultValue={props.cidade} placeholder="Rio de Janeiro" className={`${inputClass} w-40`} />
      <datalist id="cidades-prospects">{props.cidades.map((city) => <option key={city} value={city} />)}</datalist>
      <label htmlFor="status" className="text-xs text-[var(--text-muted)]">Status</label>
      <select id="status" name="status" defaultValue={props.status} className={inputClass}>
        <option value="">Todos</option>
        {props.statusOptions.map(([key, label]) => <option key={key} value={key} disabled={key === "CONVERTIDO"}>{key === "CONVERTIDO" ? "Convertido (confirmação DAPIC)" : label}</option>)}
      </select>
      <label htmlFor="cadastro" className="text-xs text-[var(--text-muted)]">Receita</label>
      <select id="cadastro" name="cadastro" defaultValue={props.cadastro} className={inputClass}>
        <option value="">Todas as situações</option>
        {props.cadastroOptions.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
      </select>
      <button disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50">
        {pending ? "Aplicando..." : "Filtrar"}
      </button>
    </form>
  );
}
