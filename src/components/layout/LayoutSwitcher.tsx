"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";

export function LayoutSwitcher({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return <>{children}</>;
  }

  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
    </>
  );
}
