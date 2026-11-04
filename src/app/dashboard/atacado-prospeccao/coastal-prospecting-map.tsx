"use client";

import { useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ESTADOS_BRASIL } from "@/lib/prospeccao/estados-litoraneos";

type Props = { selectedUf: string; selectedCity: string; cities: string[]; stateCounts: Record<string, number> };

export function CoastalProspectingMap({ selectedUf, selectedCity, cities, stateCounts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [city, setCity] = useState(selectedCity);
  const [pending, startTransition] = useTransition();
  const coastal = ESTADOS_BRASIL.filter((state) => state.litoraneo);
  const selected = coastal.find((state) => state.uf === selectedUf);
  const total = coastal.reduce((sum, state) => sum + (stateCounts[state.uf] ?? 0), 0);
  function apply(uf: string, cityName = "") {
    const params = new URLSearchParams(window.location.search);
    params.set("uf", uf);
    if (cityName.trim()) params.set("cidade", cityName.trim()); else params.delete("cidade");
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedUf) apply(selectedUf, city);
  }
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div><h2 className="text-sm font-semibold">Prospecção por região · litoral brasileiro</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Clique em um estado litorâneo e escolha a cidade para filtrar os lojistas.</p></div>
        <div className="text-right"><div className="text-xl font-semibold tabular-nums">{total.toLocaleString("pt-BR")}</div><div className="text-[10px] text-[var(--text-muted)]">lojistas cadastrados no litoral</div></div>
      </header>
      <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-[var(--text-muted)]"><span>■ Estados litorâneos</span><span>■ Estado selecionado</span><span>■ Demais estados</span></div>
          <svg viewBox="0 0 613 639" role="group" aria-label="Mapa interativo dos estados brasileiros" className="mx-auto block max-h-[470px] w-full max-w-[470px]">
            {ESTADOS_BRASIL.map((state) => {
              const active = state.uf === selectedUf;
              const count = stateCounts[state.uf] ?? 0;
              return <path key={state.uf} d={state.path} fill={active ? "var(--series-1)" : state.litoraneo ? "var(--series-2)" : "var(--surface-2)"} fillOpacity={active || state.litoraneo ? 0.9 : 0.55} stroke="var(--surface-1)" strokeWidth={active ? 2.8 : 1.4} strokeLinejoin="round" className={state.litoraneo ? "cursor-pointer hover:opacity-70" : ""} role={state.litoraneo ? "button" : undefined} tabIndex={state.litoraneo ? 0 : -1} aria-label={`${state.nome}: ${count} lojistas`} aria-pressed={state.litoraneo ? active : undefined} onClick={state.litoraneo ? () => { setCity(""); apply(state.uf); } : undefined}><title>{state.nome}{state.litoraneo ? ` · ${count} lojistas` : ""}</title></path>;
            })}
          </svg>
          <p className="mt-1 text-center text-[9px] text-[var(--text-muted)]">Geometria: @svg-maps/brazil · CC BY 4.0 · MapSVG</p>
        </div>
        <div className="flex flex-col gap-3">
          <div><div className="mb-2 text-xs font-semibold">Estados litorâneos · 17 estados</div><div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {coastal.map((state) => <button key={state.uf} type="button" onClick={() => { setCity(""); apply(state.uf); }} aria-pressed={state.uf === selectedUf} className={`rounded-md border px-2 py-2 text-left ${state.uf === selectedUf ? "border-[var(--series-1)] bg-[var(--series-1)]/10" : "border-[var(--border)]"}`}><span className="flex justify-between text-xs font-semibold">{state.uf}<span className="text-[10px] font-normal text-[var(--text-muted)]">{(stateCounts[state.uf] ?? 0).toLocaleString("pt-BR")}</span></span><span className="mt-0.5 block truncate text-[9px] text-[var(--text-muted)]">{state.nome}</span></button>)}
          </div></div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            {selected ? <><div className="flex items-center justify-between"><div><div className="text-[10px] text-[var(--text-muted)]">Estado selecionado</div><div className="font-semibold">{selected.nome} ({selected.uf})</div></div><div className="text-right"><div className="text-lg font-semibold">{(stateCounts[selected.uf] ?? 0).toLocaleString("pt-BR")}</div><div className="text-[9px] text-[var(--text-muted)]">lojistas no Radar</div></div></div>
              <form onSubmit={submit} className="mt-3 space-y-2" aria-busy={pending}><label htmlFor="radar-city" className="block text-xs">Escolha ou digite uma cidade</label><input id="radar-city" list="radar-city-options" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ex.: Niterói" maxLength={100} className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm" /><datalist id="radar-city-options">{cities.map((name) => <option key={name} value={name} />)}</datalist><div className="flex flex-wrap gap-2"><button type="submit" disabled={pending} className="rounded-md bg-[var(--series-1)] px-3 py-2 text-xs font-semibold text-white">{pending ? "Aplicando..." : "Ver lojistas da cidade"}</button><button type="button" disabled={pending} onClick={() => { setCity(""); apply(selected.uf); }} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs">Todas as cidades</button></div></form>
              <p className="mt-3 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--text-muted)]">{selectedCity ? `Filtro atual: ${selectedCity}` : "Sem cidade selecionada: mostrando todo o estado."}</p></> : <p className="py-5 text-center text-xs text-[var(--text-muted)]">Selecione um estado litorâneo no mapa.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
