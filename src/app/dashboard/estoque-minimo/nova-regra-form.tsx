"use client";

import { useMemo, useState } from "react";
import { createMinimumRuleAction } from "./actions";

type Combo = { colecao: string | null; grupo: string; tamanho: string };
type StoreOption = { id: string; name: string };

const selectClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

// "" (Todas) = regra genérica, sem coleção — createMinimumRuleAction já trata string vazia
// como colecao null, igual o campo de texto opcional de antes.
export function NovaRegraForm({ stores, combos }: { stores: StoreOption[]; combos: Combo[] }) {
  const [colecao, setColecao] = useState("");
  const [grupo, setGrupo] = useState("");
  const [tamanho, setTamanho] = useState("");

  const colecaoOptions = useMemo(
    () => [...new Set(combos.map((c) => c.colecao).filter((c): c is string => c !== null))].sort(),
    [combos]
  );

  const gruposFiltrados = useMemo(() => {
    const pool = colecao === "" ? combos : combos.filter((c) => c.colecao === colecao);
    return [...new Set(pool.map((c) => c.grupo))].sort();
  }, [combos, colecao]);

  const tamanhosFiltrados = useMemo(() => {
    if (!grupo) return [];
    const pool = combos.filter((c) => c.grupo === grupo && (colecao === "" || c.colecao === colecao));
    return [...new Set(pool.map((c) => c.tamanho))].sort();
  }, [combos, grupo, colecao]);

  return (
    <form action={createMinimumRuleAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="storeId">
          Loja
        </label>
        <select id="storeId" name="storeId" required className={selectClass} style={{ colorScheme: "light dark" }}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="colecao">
          Coleção
        </label>
        <select
          id="colecao"
          name="colecao"
          className={selectClass}
          style={{ colorScheme: "light dark" }}
          value={colecao}
          onChange={(e) => {
            setColecao(e.target.value);
            setGrupo("");
            setTamanho("");
          }}
        >
          <option value="">Todas</option>
          {colecaoOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="grupo">
          Grupo
        </label>
        <select
          id="grupo"
          name="grupo"
          required
          className={selectClass}
          style={{ colorScheme: "light dark" }}
          value={grupo}
          onChange={(e) => {
            setGrupo(e.target.value);
            setTamanho("");
          }}
        >
          <option value="" disabled>
            Selecione...
          </option>
          {gruposFiltrados.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="tamanho">
          Tamanho
        </label>
        <select
          id="tamanho"
          name="tamanho"
          required
          disabled={!grupo}
          className={selectClass}
          style={{ colorScheme: "light dark" }}
          value={tamanho}
          onChange={(e) => setTamanho(e.target.value)}
        >
          <option value="" disabled>
            {grupo ? "Selecione..." : "Escolha um grupo primeiro"}
          </option>
          {tamanhosFiltrados.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="valorMinimo">
          Estoque mínimo
        </label>
        <input
          id="valorMinimo"
          name="valorMinimo"
          type="number"
          min={0}
          required
          className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
          style={{ colorScheme: "light dark" }}
        />
      </div>

      <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white">
        Salvar
      </button>
    </form>
  );
}
