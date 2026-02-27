"use client";

import { useState, useCallback, useEffect } from "react";

const SIDEBAR_WIDTH = 260;
const MOBILE_BREAKPOINT = 768;

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const m = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(m);
      if (m && mobileOpen) setMobileOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [mobileOpen]);

  const toggle = useCallback(() => {
    if (isMobile) {
      setMobileOpen((o) => !o);
    } else {
      setCollapsed((c) => !c);
    }
  }, [isMobile]);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  return {
    collapsed,
    mobileOpen,
    isMobile,
    toggle,
    closeMobile,
    sidebarWidth: SIDEBAR_WIDTH,
  };
}
