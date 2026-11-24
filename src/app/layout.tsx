import type { Metadata, Viewport } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { LanguageProvider } from "@/components/providers/language-provider";
import { UserProvider } from "@/components/providers/user-provider";
import { Toaster } from "sonner";
import { isDemoBlocked } from "@/lib/env";

const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Holool His", template: "%s · Holool His" },
  description: "Internal hospital HIS team tracking system",
  // internal system with patient-related data: keep it out of search engines
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Holool His" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (isDemoBlocked()) {
    return (
      <html lang="ar" dir="rtl">
        <body style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 560, margin: "10vh auto", lineHeight: 1.8 }}>
          <h1>الموقع غير مُهيّأ للتشغيل</h1>
          <p>متغيرات Supabase غير مضبوطة على الخادم، ولذلك تم إيقاف الموقع بدل تشغيله بوضع التجربة (Demo). راجع README ← «النشر».</p>
          <p dir="ltr" style={{ textAlign: "left", color: "#555" }}>
            Server is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
            (or NEXT_PUBLIC_ALLOW_DEMO=true for a public demo), then redeploy.
          </p>
        </body>
      </html>
    );
  }
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${arabic.variable} antialiased`}>
        <ThemeProvider>
          <LanguageProvider>
            <UserProvider>
              {children}
              <Toaster richColors position="top-center" />
            </UserProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
