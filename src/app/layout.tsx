import type { Metadata } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { LanguageProvider } from "@/components/providers/language-provider";
import { UserProvider } from "@/components/providers/user-provider";
import { Toaster } from "sonner";

const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "حلول كامل", template: "%s · حلول كامل" },
  description: "Internal hospital HIS team tracking system",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
