"use client";

import { useEffect, useState } from "react";
import { selecionarThumb } from "./selecionar-thumb";

// Coluna de imagem da tabela "Por Anúncio" (refinamento visual da Central Black Friday,
// 2026-11-05) — thumb pequeno (40px) + badge "+N" quando o anúncio tem mais de uma foto
// cadastrada no Meta (getFotosPorNomeAnuncio, meta-ads.ts). Clique abre lightbox com a(s)
// foto(s) em tamanho grande. Sem lib externa — mesmo padrão de overlay de
// analytics-site/foto-galeria.tsx, mas com ESC/botão X além de clique fora (pedido explícito
// desta missão, que a outra tela não tinha).
export function AnuncioFotoCell({ fotos, nome }: { fotos: string[]; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [thumbFalhou, setThumbFalhou] = useState(false);
  const [falharam, setFalharam] = useState<Set<number>>(new Set());
  const { thumb, extras } = selecionarThumb(fotos);

  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aberto]);

  // Sem foto nenhuma (Meta não tem criativo pra esse anúncio — ausência real, não erro) OU a
  // única foto que a gente ia mostrar falhou ao carregar (URL assinada do Meta expirou antes do
  // cache de 12h renovar, ver comentário em foto-galeria.tsx) — nos dois casos é um bloco visual
  // LOCAL (ícone de imagem quebrada via SVG inline), nunca imagem externa/placeholder genérico,
  // e a linha da tabela nunca fica vazia por causa disso.
  if (!thumb || thumbFalhou) {
    return (
      <div
        className="flex h-10 w-10 items-center justify-center rounded border border-[var(--border)] bg-[var(--page-plane)] text-[var(--text-muted)]"
        title={thumbFalhou ? "Foto indisponível agora (link do Meta expirou)" : "Sem foto cadastrada no Meta"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 16l5-5 4 4 3-3 6 6" />
          <circle cx="8.5" cy="8.5" r="1.5" />
        </svg>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-[var(--border)] transition hover:opacity-80"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb} alt={`Criativo de ${nome}`} className="h-full w-full object-cover" onError={() => setThumbFalhou(true)} />
        {extras > 0 && (
          <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px] font-medium leading-tight text-white">
            +{extras}
          </span>
        )}
      </button>
      {aberto && (
        <div
          role="presentation"
          onClick={() => setAberto(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20"
          >
            ✕
          </button>
          <div
            role="dialog"
            aria-label={`Fotos do anúncio ${nome}`}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] max-w-[85vw] flex-wrap items-center justify-center gap-3 overflow-auto"
          >
            {fotos.map((url, idx) =>
              falharam.has(idx) ? null : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={idx}
                  src={url}
                  alt={`Criativo ${idx + 1} de ${nome}`}
                  className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain shadow-xl"
                  onError={() => setFalharam((prev) => new Set(prev).add(idx))}
                />
              )
            )}
            {fotos.every((_, idx) => falharam.has(idx)) && (
              <p className="text-sm text-white">Foto indisponível agora (link do Meta expirou).</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
