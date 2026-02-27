import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Playfair_Display, Outfit, Syne, Mulish } from "next/font/google";
import "./globals.css";
import { SupabaseProvider } from "@/components/providers/SupabaseProvider";
import { Header } from "@/components/layout/Header";
import { LayoutSwitcher } from "@/components/layout/LayoutSwitcher";

const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const syne = Syne({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-syne", display: "swap" });
const mulish = Mulish({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mulish", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InfoLegal RD – Consulta Legal Inteligente",
  description:
    "Información legal general y orientativa para República Dominicana. Siempre consulta a un abogado colegiado para tu caso específico.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} ${playfair.variable} ${outfit.variable} ${syne.variable} ${mulish.variable} antialiased`} suppressHydrationWarning>
      <body className={`${GeistSans.className} ${syne.variable} ${mulish.variable} antialiased min-h-screen font-sans`}>
        <SupabaseProvider>
          <LayoutSwitcher>{children}</LayoutSwitcher>
        </SupabaseProvider>
      </body>
    </html>
  );
}
