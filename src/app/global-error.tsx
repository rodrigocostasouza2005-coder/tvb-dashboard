"use client";

// Só dispara se o próprio RootLayout (src/app/layout.tsx) quebrar — quase nunca, já que ele não
// faz nenhuma chamada a banco/API, só monta a fonte e o <html>. Precisa definir <html>/<body>
// própria porque substitui o layout raiz inteiro; por isso estilo inline em vez de depender das
// classes do globals.css.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0d0d0d",
          color: "#ffffff",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <div style={{ fontSize: "2rem" }}>⚠️</div>
        <h1 style={{ fontSize: "0.9rem", fontWeight: 600, margin: 0 }}>O TVB Radar não carregou</h1>
        <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#c3c2b7", margin: 0 }}>
          Erro inesperado ao iniciar a página. Tenta recarregar.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: "0.5rem",
            borderRadius: "6px",
            background: "#3987e5",
            color: "#ffffff",
            border: "none",
            padding: "0.4rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
