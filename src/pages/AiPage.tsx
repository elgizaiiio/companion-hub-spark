import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Plus,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { setNavRevealed, useNavRevealed } from "@/hooks/use-nav-reveal";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Role = "user" | "assistant";
type Kind = "text" | "image" | "video";
type Msg = {
  id: string;
  role: Role;
  content: string;
  kind: Kind;
  url?: string;
  pending?: boolean;
  error?: boolean;
};
type Mode = "chat" | "images" | "videos";

const PLAN_PRICE = 10;

const MODES: { id: Mode; label: string; icon: typeof MessageCircle; placeholder: string }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle, placeholder: "Ask Nova anything…" },
  { id: "images", label: "Images", icon: ImageIcon, placeholder: "Describe the image to create…" },
  { id: "videos", label: "Videos", icon: Video, placeholder: "Describe the video to create…" },
];

const BASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const CHAT_URL = `${BASE_URL}/functions/v1/chat-alibaba`;
const MEDIA_URL = `${BASE_URL}/functions/v1/ai-deapi`;

const ease = [0.22, 1, 0.36, 1] as const;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Soft shimmering placeholder shown while media is being generated. */
const MediaSkeleton = ({ kind }: { kind: "image" | "video" }) => (
  <div
    className={cn(
      "relative w-full overflow-hidden rounded-[1.4rem] border border-border/60 bg-muted/60",
      kind === "image" ? "aspect-square" : "aspect-video",
    )}
  >
    <motion.div
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(100deg, transparent 20%, hsl(var(--primary) / 0.14) 45%, hsl(var(--accent) / 0.12) 55%, transparent 80%)",
      }}
      animate={{ x: ["-60%", "160%"] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
    />
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <span className="text-[12px] text-muted-foreground">
        Creating your {kind}… this can take a moment
      </span>
    </div>
  </div>
);

const TypingDots = () => (
  <div className="flex items-center gap-1.5 py-1">
    {[0, 1, 2].map((i) => (
      <motion.span
        key={i}
        className="h-1.5 w-1.5 rounded-full bg-primary"
        animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
        transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
      />
    ))}
  </div>
);

export default function AiPage() {
  const { user, refreshProfile } = useApp();
  const navRevealed = useNavRevealed();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [busy, setBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [activeUntil, setActiveUntil] = useState<string | null>(null);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const activeMode = useMemo(() => MODES.find((m) => m.id === mode)!, [mode]);
  const empty = messages.length === 0;
  const profileId = (user as { profileId?: string | null })?.profileId ?? null;
  const isPro = !!activeUntil && new Date(activeUntil).getTime() > Date.now();

  const loadSubscription = useCallback(async () => {
    if (!profileId) return;
    const { data } = await (supabase as any).rpc("ai_get_subscription", {
      _profile_id: profileId,
    });
    const row = Array.isArray(data) ? data[0] : data;
    setActiveUntil(row?.status === "active" ? row?.expires_at ?? null : null);
  }, [profileId]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  useEffect(() => () => setNavRevealed(false), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  const patch = (id: string, next: Partial<Msg>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)));

  const subscribe = async () => {
    if (!profileId) {
      toast.error("Profile not ready yet");
      return;
    }
    setBuying(true);
    try {
      const { data, error } = await (supabase as any).rpc("ai_activate_plan", {
        _profile_id: profileId,
        _plan: "unlimited",
        _price: PLAN_PRICE,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setActiveUntil(row?.expires_at ?? null);
      setPlanOpen(false);
      toast.success("Pro activated — unlimited for 30 days");
      void refreshProfile?.();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      toast.error(
        msg.includes("insufficient_balance")
          ? "Not enough USDT balance"
          : "Could not activate the plan",
      );
    } finally {
      setBuying(false);
    }
  };

  const runChat = async (history: Msg[], replyId: string) => {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        messages: history
          .filter((m) => m.kind === "text")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
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
            patch(replyId, { content: acc, pending: false });
          }
        } catch {
          /* keep-alive frames */
        }
      }
    }
    if (!acc) throw new Error("empty");
  };

  const runMedia = async (kind: "image" | "video", prompt: string, replyId: string) => {
    const res = await fetch(MEDIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ kind, prompt, profileId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.url) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    patch(replyId, { url: data.url, pending: false, content: "" });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text, kind: "text" };
    const kind: Kind = mode === "images" ? "image" : mode === "videos" ? "video" : "text";
    const replyId = crypto.randomUUID();
    const history = [...messages, userMsg];

    setMessages([
      ...history,
      { id: replyId, role: "assistant", content: "", kind, pending: true },
    ]);
    setInput("");
    setBusy(true);

    try {
      if (kind === "text") await runChat(history, replyId);
      else await runMedia(kind, text, replyId);
    } catch (e: any) {
      patch(replyId, {
        pending: false,
        error: true,
        kind: "text",
        content:
          String(e?.message) === "empty"
            ? "No response. Please try again."
            : `Couldn't finish that: ${e?.message ?? "unknown error"}`,
      });
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const reset = () => {
    setMessages([]);
    setInput("");
    taRef.current?.focus();
  };

  return (
    <div className="hero-dark relative flex min-h-[100dvh] flex-col">
      {/* soft mint / pink wash matching the rest of the app */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 20% 0%, hsl(var(--primary) / 0.10), transparent 70%), radial-gradient(ellipse 60% 40% at 90% 12%, hsl(var(--accent) / 0.12), transparent 70%)",
        }}
      />

      <header className="relative z-20 flex items-center justify-between px-5 pt-safe pb-3">
        <button type="button" onClick={reset} className="text-left">
          <span className="hero-title block text-[1.9rem] leading-none">
            Nova <span className="hero-title-italic">AI</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className={cn(
            "liquid-press flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-medium",
            isPro
              ? "glass-panel text-foreground"
              : "action-black bg-foreground text-background",
          )}
        >
          {isPro ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          {isPro ? "Pro" : "Upgrade"}
        </button>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-4">
        {empty ? (
          <div className="flex min-h-[42vh] flex-col items-center justify-center px-2 text-center">
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="hero-title text-[2.4rem] leading-[1.05]"
            >
              {greeting()},{" "}
              <span className="hero-title-italic">
                {user?.telegramUser?.first_name || "friend"}
              </span>
            </motion.h2>
            <p className="hero-dim mt-2 max-w-[18rem] text-[14px]">
              Chat, generate images and create videos — all in one place.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-3">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease }}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  {m.role === "user" ? (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-[1.3rem] bg-foreground px-4 py-2.5 text-[15px] leading-relaxed text-background">
                      {m.content}
                    </div>
                  ) : (
                    <div className="w-full max-w-[92%]">
                      {m.kind === "text" ? (
                        m.pending ? (
                          <TypingDots />
                        ) : (
                          <p
                            className={cn(
                              "whitespace-pre-wrap text-[15px] leading-relaxed",
                              m.error ? "text-destructive" : "hero-fg",
                            )}
                          >
                            {m.content}
                          </p>
                        )
                      ) : m.pending ? (
                        <MediaSkeleton kind={m.kind as "image" | "video"} />
                      ) : m.url ? (
                        <div className="glass-panel overflow-hidden p-1.5">
                          {m.kind === "image" ? (
                            <img
                              src={m.url}
                              alt="Generated result"
                              loading="lazy"
                              className="w-full rounded-[1.2rem] object-cover"
                            />
                          ) : (
                            <video
                              src={m.url}
                              controls
                              playsInline
                              className="w-full rounded-[1.2rem]"
                            />
                          )}
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 flex items-center justify-center gap-1.5 py-1.5 text-[12px] text-muted-foreground"
                          >
                            <Download className="h-3.5 w-3.5" /> Open full size
                          </a>
                        </div>
                      ) : null}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={endRef} />
          </div>
        )}
      </main>

      <div
        className={cn(
          "sticky bottom-0 z-20 px-3 pt-2 backdrop-blur-xl",
          navRevealed ? "pb-24" : "pb-3",
        )}
      >
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-2 flex justify-center gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "liquid-press flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] transition-colors",
                    on
                      ? "bg-foreground text-background"
                      : "glass-panel hero-dim",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="glass-panel glass-strong glass-float rounded-[1.6rem] px-3 pb-2.5 pt-2.5">
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
              placeholder={activeMode.placeholder}
              className="relative z-10 w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
            />

            <div className="relative z-10 mt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={reset}
                aria-label="New chat"
                className="liquid-press grid h-9 w-9 place-items-center rounded-full bg-muted/70 text-muted-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || busy}
                aria-label="Send"
                className="liquid-press grid h-9 w-9 place-items-center rounded-full bg-foreground text-background disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setNavRevealed(!navRevealed)}
              className="liquid-press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-muted-foreground"
            >
              {navRevealed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
              {navRevealed ? "Hide menu" : "Show menu"}
            </button>
          </div>
        </div>
      </div>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-sm rounded-[1.8rem]">
          <DialogHeader>
            <DialogTitle className="text-[24px] font-normal">Nova AI Pro</DialogTitle>
            <DialogDescription>
              One plan, everything unlimited for 30 days.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[1.4rem] border border-border bg-secondary/60 p-4">
            <div className="flex items-end gap-1">
              <span className="text-[32px] font-normal leading-none">${PLAN_PRICE}</span>
              <span className="pb-1 text-[13px] text-muted-foreground">/ month</span>
            </div>
            <ul className="mt-3 space-y-2 text-[14px]">
              {["Unlimited chat", "Unlimited images", "Unlimited videos", "Priority speed"].map(
                (f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    {f}
                  </li>
                ),
              )}
            </ul>
          </div>

          <p className="text-center text-[12px] text-muted-foreground">
            Paid from your USDT balance ({Number(user?.usdtBalance ?? 0).toFixed(2)} USDT)
          </p>

          {isPro ? (
            <div className="rounded-full bg-secondary py-3 text-center text-[14px] font-medium">
              Active until {new Date(activeUntil!).toLocaleDateString()}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void subscribe()}
              disabled={buying}
              className="liquid-press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3 text-[15px] font-medium text-background disabled:opacity-60"
            >
              {buying && <Loader2 className="h-4 w-4 animate-spin" />}
              Subscribe for ${PLAN_PRICE}
            </button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
