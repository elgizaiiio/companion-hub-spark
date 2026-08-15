import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Image as ImageIcon,
  Loader2,
  Microscope,
  Plus,
  Sparkles,
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
type Msg = { id: string; role: Role; content: string };
type ChipId = "images" | "videos" | "research" | "learn";

const PLAN_PRICE = 10;

const CHIPS: {
  id: ChipId;
  label: string;
  icon: typeof ImageIcon;
  placeholder: string;
  system: string;
}[] = [
  {
    id: "images",
    label: "Images",
    icon: ImageIcon,
    placeholder: "Describe the image you want…",
    system: "The user is in image mode. Help craft and refine detailed visual prompts.",
  },
  {
    id: "videos",
    label: "Videos",
    icon: Video,
    placeholder: "Describe your video idea…",
    system: "The user is in video mode. Help plan shots, scenes and video prompts.",
  },
  {
    id: "research",
    label: "Research",
    icon: Microscope,
    placeholder: "What should I research?",
    system: "Do deep, structured research. Give organized, in-depth answers.",
  },
  {
    id: "learn",
    label: "Learn",
    icon: GraduationCap,
    placeholder: "What do you want to learn?",
    system: "Act as a patient tutor. Explain step by step with short examples.",
  },
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-alibaba`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function AiPage() {
  const { user, refreshProfile } = useApp();
  const navRevealed = useNavRevealed();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [chip, setChip] = useState<ChipId | null>(null);
  const [busy, setBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [activeUntil, setActiveUntil] = useState<string | null>(null);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => CHIPS.find((c) => c.id === chip) ?? null, [chip]);
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
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

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

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    const history: Msg[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: text },
    ];
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
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
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
            /* status / keep-alive frames */
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <button
          type="button"
          onClick={() => {
            setMessages([]);
            setChip(null);
          }}
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
        >
          <Sparkles className="h-4 w-4 text-primary" strokeWidth={2.2} />
          Nova AI
        </button>

        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
            isPro
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          {isPro ? <Check className="h-3.5 w-3.5" /> : null}
          {isPro ? "Pro" : "Upgrade"}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4">
        {empty ? (
          <div className="flex min-h-[46vh] flex-col items-center justify-center text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary">
              <Sparkles className="h-6 w-6 text-primary" strokeWidth={2} />
            </div>
            <h1 className="mt-4 text-[22px] font-semibold tracking-tight">
              {greeting()}, {user?.telegramUser?.first_name || "there"}
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Ask anything — chat, ideas, research and prompts.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-3">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={m.id}
                  className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground"
                >
                  {m.content || (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Thinking…
                    </span>
                  )}
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </main>

      <div
        className={cn(
          "sticky bottom-0 bg-background/95 px-3 pt-2 backdrop-blur-xl",
          navRevealed ? "pb-24" : "pb-4",
        )}
      >
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHIPS.map((c) => {
            const Icon = c.icon;
            const on = chip === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(on ? null : c.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors",
                  on
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-3xl border border-border bg-card px-3 pb-2.5 pt-2.5 shadow-[var(--shadow-glass)]">
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
            placeholder={active ? active.placeholder : "Message Nova AI…"}
            className="w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setChip(null);
                taRef.current?.focus();
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground active:scale-95"
              aria-label="New chat"
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || busy}
              className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground transition disabled:opacity-40"
              aria-label="Send"
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
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground active:scale-95"
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

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[20px]">Nova AI Pro</DialogTitle>
            <DialogDescription>
              One plan, everything unlimited for 30 days.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-2xl border border-border bg-secondary/60 p-4">
            <div className="flex items-end gap-1">
              <span className="text-[30px] font-semibold leading-none">${PLAN_PRICE}</span>
              <span className="pb-0.5 text-[13px] text-muted-foreground">/ month</span>
            </div>
            <ul className="mt-3 space-y-2 text-[14px]">
              {["Unlimited chat & code", "Unlimited images", "Unlimited videos", "Priority speed"].map(
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
            <div className="rounded-full bg-secondary py-3 text-center text-[14px] font-semibold">
              Active until {new Date(activeUntil!).toLocaleDateString()}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void subscribe()}
              disabled={buying}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
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
