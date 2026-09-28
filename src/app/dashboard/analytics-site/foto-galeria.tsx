"use client";

import { useState } from "react";

// Clique na miniatura pra ver o criativo em tamanho grande — pedido do Rodrigo em 2026-09-28.
// Overlay simples (sem lib externa), fecha clicando em qualquer lugar.
export function FotoGaleria({ fotos, label }: { fotos: string[]; label: string }) {
  const [aberta, setAberta] = useState<string | null>(null);

  if (fotos.length === 0) {
    return <span className="text-xs text-[var(--text-muted)]">sem foto</span>;
  }

  return (
    <>
      <div className="flex gap-1.5">
        {fotos.map((url, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setAberta(url)}
            className="h-10 w-10 shrink-0 overflow-hidden rounded border border-[var(--border)] transition hover:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Criativo ${idx + 1} de ${label}`} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {aberta && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setAberta(null)}
          onKeyDown={(e) => e.key === "Escape" && setAberta(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={aberta} alt={label} className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-xl" />
        </div>
      )}
    </>
  );
}
