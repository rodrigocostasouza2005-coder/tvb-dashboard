"use client";

import { useMemo, useState } from "react";
import { createMinimumRulesBatchAction } from "./actions";

type StoreOption = { id: string; name: string };
type ExistingRule = { storeId: string; grupo: string; tamanho: string; colecao: string | null; valorMinimo: number };

const selectClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

// Mesma lógica de "regra mais específica ganha" usada em metrics.ts (matchMinimumRule) — só
// que aqui é pra pré-preencher o valor atual em cada linha, não pra calcular reposição.
function matchExisting(rules: ExistingRule[], storeId: string, grupo: string, tamanho: string, colecao: string | null) {
  const exact = rules.find(
    (r) => r.storeId === storeId && r.grupo === grupo && r.tamanho === tamanho && r.colecao === colecao
  );
  if (exact) return exact.valorMinimo;
  const generic = rules.find(
    (r) => r.storeId === storeId && r.grupo === grupo && r.tamanho === tamanho && r.colecao === null
  );
  return generic?.valorMinimo ?? null;
}

// Escolhe Loja + Coleção + Grupo e a tela abre uma linha por tamanho que aquele grupo
// realmente tem (camisa não tem 42, Classic não tem G/UNICO) — cada linha já vem preenchida
// com o mínimo atual, se existir. Deixar uma linha em branco = não mexe naquele tamanho.
export function NovaRegraForm({
  stores,
  colecoes,
  grupos,
  tamanhosPorGrupo,
  existingRules,
}: {
  stores: StoreOption[];
  colecoes: string[];
  grupos: string[];
  tamanhosPorGrupo: Record<string, string[]>;
  existingRules: ExistingRule[];
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [colecao, setColecao] = useState("");
  const [grupo, setGrupo] = useState(grupos[0] ?? "");

  const tamanhos = tamanhosPorGrupo[grupo] ?? [];

  const defaults = useMemo(
    () => tamanhos.map((t) => matchExisting(existingRules, storeId, grupo, t, colecao === "" ? null : colecao)),
    [tamanhos, existingRules, storeId, grupo, colecao]
  );

  return (
    <form action={createMinimumRulesBatchAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]" htmlFor="storeId">
            Loja
          </label>
          <select
            id="storeId"
            name="storeId"
            required
            className={selectClass}
            style={{ colorScheme: "light dark" }}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
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
            onChange={(e) => setColecao(e.target.value)}
          >
            <option value="">Todas</option>
            {colecoes.map((c) => (
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
            onChange={(e) => setGrupo(e.target.value)}
          >
            {grupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {tamanhos.map((t, i) => (
          // Key inclui loja/coleção/grupo pra forçar remontar o input (e reaplicar defaultValue)
          // sempre que qualquer um deles mudar — senão o React reaproveita o DOM node e o campo
          // fica mostrando o valor da combinação anterior.
          <div key={`${storeId}-${colecao}-${grupo}-${t}`} className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]" htmlFor={`minimo-${t}`}>
              Tamanho {t}
            </label>
            <input type="hidden" name="tamanho" value={t} />
            <input
              id={`minimo-${t}`}
              name="valorMinimo"
              type="number"
              min={0}
              placeholder="—"
              defaultValue={defaults[i] ?? ""}
              className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            />
          </div>
        ))}
        {tamanhos.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Esse grupo não tem tamanho no estoque.</p>
        )}
      </div>

      <div>
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white">
          Salvar tudo
        </button>
      </div>
    </form>
  );
}
