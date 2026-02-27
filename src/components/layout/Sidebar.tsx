"use client";

import type { AreaFilter } from "@/hooks/useChat";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  isMobile: boolean;
  sidebarWidth: number;
  onCloseMobile: () => void;
  onNewChat: () => void;
  area: AreaFilter;
  onAreaChange: (a: AreaFilter) => void;
  mode: "normal" | "max-reliability";
  onModeChange: (m: "normal" | "max-reliability") => void;
  historyItems?: { id: string; title: string }[];
  onSelectHistory?: (id: string) => void;
};

const AREAS: AreaFilter[] = [
  "Todas",
  "Laboral",
  "Familia",
  "Inmobiliario",
  "Comercial",
  "Civil",
  "Penal",
  "Constitucional",
];

const MOCK_HISTORY = [
  { id: "1", title: "Derechos en despido injustificado" },
  { id: "2", title: "Requisitos divorcio mutuo acuerdo" },
  { id: "3", title: "Preaviso laboral RD" },
];

export function Sidebar({
  collapsed,
  mobileOpen,
  isMobile,
  sidebarWidth,
  onCloseMobile,
  onNewChat,
  area,
  onAreaChange,
  mode,
  onModeChange,
  historyItems = MOCK_HISTORY,
  onSelectHistory,
}: SidebarProps) {
  const visible = isMobile ? mobileOpen : !collapsed;
  const width = isMobile ? (mobileOpen ? Math.min(sidebarWidth, 280) : 0) : collapsed ? 0 : sidebarWidth;

  return (
    <>
      {isMobile && mobileOpen && (
        <button
          type="button"
          className="chat-sidebar-overlay"
          onClick={onCloseMobile}
          aria-label="Cerrar menú"
        />
      )}
      <aside
        className="chat-sidebar"
        style={{
          width: width ? `${width}px` : undefined,
          minWidth: width ? `${width}px` : undefined,
        }}
        data-visible={visible}
      >
        <div className="chat-sidebar-inner">
          <div className="chat-sidebar-logo font-title">
            <span className="chat-sidebar-logo-mark">⚖️</span>
            <span className="chat-sidebar-logo-text">
              Info<span className="text-sage">Legal</span> RD
            </span>
          </div>

          <button
            type="button"
            className="chat-sidebar-btn-new"
            onClick={onNewChat}
            aria-label="Nueva consulta"
          >
            Nueva consulta
          </button>

          <div className="chat-sidebar-section">
            <div className="chat-sidebar-label font-title">Área legal</div>
            <div className="chat-sidebar-pills">
              {AREAS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`chat-sidebar-pill ${area === a ? "active" : ""}`}
                  onClick={() => onAreaChange(a)}
                  aria-pressed={area === a}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="chat-sidebar-section chat-sidebar-history">
            <div className="chat-sidebar-label font-title">Historial</div>
            <div className="chat-sidebar-list" role="list">
              {historyItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chat-sidebar-history-item"
                  onClick={() => onSelectHistory?.(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </div>

          <div className="chat-sidebar-section chat-sidebar-mode">
            <div className="chat-sidebar-label font-title">Modo</div>
            <div className="chat-sidebar-toggle">
              <button
                type="button"
                className={`chat-sidebar-mode-btn ${mode === "normal" ? "active" : ""}`}
                onClick={() => onModeChange("normal")}
                aria-pressed={mode === "normal"}
              >
                Normal
              </button>
              <button
                type="button"
                className={`chat-sidebar-mode-btn ${mode === "max-reliability" ? "active" : ""}`}
                onClick={() => onModeChange("max-reliability")}
                aria-pressed={mode === "max-reliability"}
              >
                Máxima Confiabilidad
              </button>
            </div>
          </div>

          <div className="chat-sidebar-user">
            <div className="chat-sidebar-avatar" aria-hidden />
            <div className="chat-sidebar-user-info">
              <span className="chat-sidebar-user-name">Usuario</span>
              <span className="chat-sidebar-user-plan">Plan gratuito</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
