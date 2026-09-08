"use client";

import { useRef, useState } from "react";

// Fixa a lâmina no tema claro na hora de exportar, independente do tema que a pessoa está usando
// no navegador — é um documento pra compartilhar fora do dashboard (mensagem, e-mail, impressão),
// não faz sentido sair escura só porque quem gerou estava no modo escuro. Valores copiados de
// :root em globals.css.
const LIGHT_THEME_VARS: Record<string, string> = {
  "--surface-1": "#fcfcfb",
  "--page-plane": "#f9f9f7",
  "--text-primary": "#0b0b0b",
  "--text-secondary": "#52514e",
  "--text-muted": "#898781",
  "--gridline": "#e1e0d9",
  "--border": "rgba(11, 11, 11, 0.1)",
  "--series-1": "#2a78d6",
  "--series-2": "#eb6834",
  "--status-good": "#0ca30c",
  "--status-warning": "#fab219",
  "--status-critical": "#d03b3b",
};

export function LaminaExport({ children, filename }: { children: React.ReactNode; filename: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [open, setOpen] = useState(false);

  async function capturar() {
    if (!ref.current) return null;
    const { toPng } = await import("html-to-image");
    // pixelRatio 2 pra sair nítido em tela grande/impressão, mesmo a lâmina sendo compacta.
    return toPng(ref.current, { pixelRatio: 2, backgroundColor: "#fcfcfb" });
  }

  async function baixarPng() {
    setBusy("png");
    try {
      const dataUrl = await capturar();
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${filename}.png`;
      a.click();
    } finally {
      setBusy(null);
      setOpen(false);
    }
  }

  async function baixarPdf() {
    setBusy("pdf");
    try {
      const dataUrl = await capturar();
      if (!dataUrl || !ref.current) return;
      const { jsPDF } = await import("jspdf");
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve) => { img.onload = resolve; });
      // PDF do tamanho exato da imagem (em pt, 1px = 1pt a 72dpi) — sem margem, sem sobra de
      // página em branco, a lâmina inteira cabe numa página só.
      const pdf = new jsPDF({
        orientation: img.width >= img.height ? "landscape" : "portrait",
        unit: "px",
        format: [img.width, img.height],
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, img.width, img.height);
      pdf.save(`${filename}.pdf`);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  }

  return (
    <>
      <div className="relative mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-md border border-[var(--series-1)] bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy === "png" ? "Gerando imagem…" : busy === "pdf" ? "Gerando PDF…" : "Baixar ▾"}
        </button>
        {open && busy === null && (
          <div className="absolute right-0 z-20 mt-1 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1 shadow-lg">
            <button
              type="button"
              onClick={baixarPng}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            >
              Baixar como imagem (PNG)
            </button>
            <button
              type="button"
              onClick={baixarPdf}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            >
              Baixar como PDF
            </button>
          </div>
        )}
      </div>
      <div ref={ref} style={LIGHT_THEME_VARS as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}
