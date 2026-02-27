"use client";

type TopbarProps = {
  onMenuClick: () => void;
  title: string;
  modeLabel: string;
};

export function Topbar({ onMenuClick, title, modeLabel }: TopbarProps) {
  return (
    <header className="chat-topbar">
      <button
        type="button"
        className="chat-topbar-menu"
        onClick={onMenuClick}
        aria-label="Abrir o cerrar menú"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <h1 className="chat-topbar-title">{title}</h1>
      <span className="chat-topbar-badge">{modeLabel}</span>
    </header>
  );
}
