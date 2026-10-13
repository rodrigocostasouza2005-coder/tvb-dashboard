"use client";

import { useState } from "react";

// Clique na miniatura pra ver o criativo em tamanho grande — pedido do Rodrigo em 2026-09-28.
// Overlay simples (sem lib externa), fecha clicando em qualquer lugar.
export function FotoGaleria({ fotos, label }: { fotos: string[]; label: string }) {
  const [aberta, setAberta] = useState<string | null>(null);
  // As URLs do Meta (thumbnail_url etc.) são assinadas e têm prazo de validade (parâmetro "oe" na
  // query string) — não é garantido que continuem válidas pelo tempo que o cache de 12h guarda o
  // dado (ver meta-ads.ts). onError marca a foto como falha de carregamento, SEM contar como "sem
  // foto" (mensagens diferentes: o Meta tinha a foto, só a URL parou de funcionar agora).
  const [falharam, setFalharam] = useState<Set<number>>(new Set());

  if (fotos.length === 0) {
    return <span className="text-xs text-[var(--text-muted)]">sem foto</span>;
  }
  if (fotos.every((_, idx) => falharam.has(idx))) {
    return <span className="text-xs text-[var(--text-muted)]">foto indisponível</span>;
  }

  return (
    <>
      <div className="flex max-w-xs flex-wrap gap-1.5">
        {fotos.map((url, idx) =>
          falharam.has(idx) ? null : (
            <button
              key={idx}
              type="button"
              onClick={() => setAberta(url)}
              className="h-10 w-10 shrink-0 overflow-hidden rounded border border-[var(--border)] transition hover:opacity-80"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Criativo ${idx + 1} de ${label}`}
                className="h-full w-full object-cover"
                onError={() => setFalharam((prev) => new Set(prev).add(idx))}
              />
            </button>
          )
        )}
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
