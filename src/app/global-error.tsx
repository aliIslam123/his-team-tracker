"use client";

/** Boundary for errors in the root layout itself (it replaces the whole document, so it has no providers). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>حصل خطأ غير متوقع · Something went wrong</h1>
        <button onClick={reset} style={{ padding: "0.5rem 1rem", marginTop: "1rem" }}>إعادة المحاولة · Try again</button>
      </body>
    </html>
  );
}
