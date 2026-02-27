"use client";

import { useSidebar } from "@/hooks/useSidebar";
import { useChat } from "@/hooks/useChat";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ChatArea } from "@/components/chat/ChatArea";
import { ChatInput } from "@/components/input/ChatInput";
import { useSupabase } from "@/components/providers/SupabaseProvider";
import { useAuth } from "@/hooks/useAuth";

const DEFAULT_TITLE = "InfoLegal RD — Asistente Legal";

function truncateTopic(text: string, max = 48) {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + "…";
}

export function ChatLayout() {
  const sidebar = useSidebar();
  const supabase = useSupabase();
  const { user } = useAuth(supabase);
  const chat = useChat(user?.id ?? null);

  const chatTitle =
    chat.messages.length > 0
      ? truncateTopic(
          chat.messages.find((m) => m.role === "user")?.content ?? ""
        )
      : DEFAULT_TITLE;

  const modeLabel =
    chat.mode === "max-reliability" ? "Máxima Confiabilidad" : "Normal";

  return (
    <div className="chat-layout-v3">
      <Sidebar
        collapsed={sidebar.collapsed}
        mobileOpen={sidebar.mobileOpen}
        isMobile={sidebar.isMobile}
        sidebarWidth={sidebar.sidebarWidth}
        onCloseMobile={sidebar.closeMobile}
        onNewChat={chat.resetChat}
        area={chat.area}
        onAreaChange={chat.setArea}
        mode={chat.mode}
        onModeChange={chat.setMode}
      />
      <div className="chat-main">
        <Topbar
          onMenuClick={sidebar.toggle}
          title={chatTitle}
          modeLabel={modeLabel}
        />
        <ChatArea
          messages={chat.messages}
          isTyping={chat.isTyping}
          onSuggestion={chat.sendMessage}
        />
        <ChatInput
          onSend={chat.sendMessage}
          disabled={chat.isTyping}
          placeholder="Escribe tu consulta legal…"
        />
      </div>
    </div>
  );
}
