"use client";

// global-error replaces the root layout when an error bubbles to the root,
// so it must render its own <html> and <body>. Inline styles are used because
// the app's stylesheet may not be available in this fallback.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#020617", color: "#f1f5f9", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            textAlign: "center",
            padding: "1.5rem",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: 0 }}>An unexpected error occurred.</p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: "0.5rem",
              background: "#10b981",
              color: "#020617",
              fontWeight: 700,
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
