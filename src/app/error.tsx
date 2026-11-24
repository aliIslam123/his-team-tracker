"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Last-resort boundary for runtime errors inside a page: shows a friendly message instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-bold">حصل خطأ غير متوقع · Something went wrong</h1>
      <p className="text-muted-foreground">جرّب مرة أخرى، ولو استمر الخطأ بلّغ المسؤول. / Please try again; if it persists, contact your administrator.</p>
      {error.digest && <p dir="ltr" className="text-xs text-muted-foreground">ref: {error.digest}</p>}
      <Button onClick={reset}>إعادة المحاولة · Try again</Button>
    </div>
  );
}
