import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  GraduationCap,
  Image as ImageIcon,
  Microscope,
  PanelLeft,
  Plus,
  Video,
  X,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant";
type Msg = { id: string; role: Role; content: string };

type ChipId = "images" | "videos" | "research" | "learn";

const CHIPS: { id: ChipId; label: string; icon: typeof ImageIcon; placeholder: string; system: string }[] = [
  {
    id: "images",
    label: "Images",
    icon: ImageIcon,
    placeholder: "Describe the image you want to create...",
    system: "The user is in image mode. Help them craft and refine detailed visual prompts.",
  },
  {
    id: "videos",
    label: "Videos",
    icon: Video,
    placeholder: "Start your next project with one idea...",
    system: "The user is in video mode. Help them plan shots, scenes and video prompts.",
  },
  {
    id: "research",
    label: "Deep Research",
    icon: Microscope,
    placeholder: "What should I research for you?",
    system: "Do deep, structured research. Give sourced, organized, in-depth answers.",
  },
  {
    id: "learn",
    label: "Learn",
    icon: GraduationCap,
    placeholder: "What do you want to learn today?",
    system: "Act as a patient tutor. Explain step by step with examples and short checks.",
  },
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-alibaba`;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor" aria-hidden="true">
      <path d="M50 0c3 26 21 44 50 50-29 6-47 24-50 50-3-26-21-44-50-50C29 44 47 26 50 0Z" />
    </svg>
  );
}

export default function AiPage() {
  const { user } = useApp();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [chip, setChip] = useState<ChipId | null>(null);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => CHIPS.find((c) => c.id === chip) ?? null, [chip]);
  const empty = messages.length === 0;

  useEffect(() => {
    taRef.current?.focus();
  }, [chip]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { id: crypto.randomUUID(), role: "user" as Role, content: text }];
    const replyId = crypto.randomUUID();
    setMessages([...history, { id: replyId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const payload = [
        ...(active ? [{ role: "system", content: active.system }] : []),
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ];
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ messages: payload }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              acc += delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === replyId ? { ...m, content: acc } : m)),
              );
            }
          } catch {
            /* ignore keep-alive / status frames */
          }
        }
      }

      if (!acc) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId ? { ...m, content: "No response. Please try again." } : m,
          ),
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === replyId
            ? { ...m, content: "Something went wrong. Please try again." }
            : m,
        ),
      );
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      {/* Header */}
      <header className="flex items-center gap-4 px-4 pt-4 pb-2">
        <button
          type="button"
          onClick={() => {
            setMessages([]);
            setChip(null);
          }}
          className="grid h-9 w-9 place-items-center rounded-lg text-white/80 active:scale-95"
          aria-label="New chat"
        >
          <PanelLeft className="h-6 w-6" />
        </button>
        <span className="text-lg font-semibold">
          {active ? (active.id === "videos" ? "Hailuo Pro" : "Megsy 3.9") : "Megsy 3.9"}
        </span>
      </header>

      {/* Conversation */}
      <main className="flex-1 overflow-y-auto px-4 pb-2">
        {empty ? (
          <div className="flex min-h-[52vh] flex-col items-center justify-center">
            <Star className="h-20 w-20 text-white" />
            <h1 className="mt-5 font-serif text-[26px] leading-tight text-white">
              {greeting()}, {user?.first_name || "there"}
            </h1>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-white/10 px-4 py-2.5 text-[15px] leading-relaxed text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={m.id}
                  className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90"
                >
                  {m.content || (
                    <span className="animate-pulse text-white/50">Thinking...</span>
                  )}
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="sticky bottom-0 bg-black px-3 pb-24 pt-2">
        {/* Chips */}
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHIPS.map((c) => {
            const Icon = c.icon;
            const on = chip === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(on ? null : c.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-[15px] transition-colors",
                  on ? "bg-white text-black" : "bg-white/10 text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-3xl bg-white/[0.08] px-4 pb-3 pt-3">
          {active && (
            <div className="mb-1 flex items-center gap-2 text-[13px] font-medium uppercase tracking-wide text-white/85">
              <active.icon className="h-4 w-4" />
              {active.label}
              <button
                type="button"
                onClick={() => setChip(null)}
                className="text-white/60"
                aria-label="Clear mode"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={active ? active.placeholder : "Type a question and let's get started"}
            className="w-full resize-none bg-transparent py-1 text-[16px] text-white placeholder:text-white/45 focus:outline-none"
          />

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => taRef.current?.focus()}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.06] text-emerald-400 active:scale-95"
              aria-label="Add"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || busy}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-black transition disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
