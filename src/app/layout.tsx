import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { SupabaseProvider } from "@/components/providers/SupabaseProvider";
import { Header } from "@/components/layout/Header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InfoLegal RD – Información legal general República Dominicana",
  description:
    "Información legal general y orientativa para República Dominicana. Siempre consulta a un abogado colegiado para tu caso específico.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`} suppressHydrationWarning>
      <body className={`${GeistSans.className} antialiased min-h-screen font-sans`}>
        <SupabaseProvider>
          <Header />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
        </SupabaseProvider>
      </body>
    </html>
  );
}
