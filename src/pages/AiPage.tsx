import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  Code2,
  Crown,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Upload,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import {
  AI_PLANS,
  generateAiMedia,
  getAiSubscription,
  sendAiChat,
  subscribeAiPlan,
  type AiMode,
  type AiPlanId,
  type AiSubscription,
  type ChatMessage,
  type MediaResult,
} from "@/lib/ai-api";
import { IMAGE_MODELS, VIDEO_MODELS, type MediaModel } from "@/lib/ai-models";

const ease = [0.22, 1, 0.36, 1] as const;

const HERO_VIDEO =
  "https://pollen-batch-41236914.figma.site/_components/v2/f0ee2dae7671c170c34f12e31c4cb41418976c98/769c564298c132f7919405cd9f17c1b1231f341d.769c5642.mp4";

const TABS: { id: AiMode; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "code", label: "Code", icon: Code2 },
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Video },
];

const HEADLINES: Record<AiMode, { title: string; sub: string; sample: string }> = {
  chat: {
    title: "What do you want to know?",
    sub: "Ask anything — research, ideas, translations. Answers in seconds.",
    sample: "Explain how staking rewards work, in simple words....",
  },
  code: {
    title: "What should we build?",
    sub: "Describe a component, a script or a fix and get working code back.",
    sample: "Build me a React countdown timer with a circular progress ring....",
  },
  image: {
    title: "What will you create?",
    sub: "Describe the shot, pick a model, and get a finished image.",
    sample: "A misty mountain village at sunrise, cinematic light, ultra detailed....",
  },
  video: {
    title: "What will you film?",
    sub: "Describe the scene and we'll generate a short cinematic clip.",
    sample: "Slow drone shot over neon Tokyo streets in the rain, night, 5 seconds....",
  },
};

const AiPage = () => {
  const { user } = useApp();
  const { toast } = useToast();
  const [mode, setMode] = useState<AiMode>("chat");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Record<"chat" | "code", ChatMessage[]>>({
    chat: [],
    code: [],
  });
  const [media, setMedia] = useState<MediaResult[]>([]);
  const [model, setModel] = useState<Record<"image" | "video", string>>({
    image: IMAGE_MODELS[0].id,
    video: VIDEO_MODELS[0].id,
  });
  const [sub, setSub] = useState<AiSubscription | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const [payingPlan, setPayingPlan] = useState<AiPlanId | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const isChatMode = mode === "chat" || mode === "code";
  const mediaKind = mode === "video" ? "video" : "image";
  const models: MediaModel[] = mediaKind === "video" ? VIDEO_MODELS : IMAGE_MODELS;
  const activeModel = models.find((m) => m.id === model[mediaKind]) ?? models[0];
  const isPro = sub?.status === "active" && sub.plan !== "free";
  const copy = HEADLINES[mode];

  const loadSub = useCallback(async () => {
    try {
      setSub(await getAiSubscription(user.profileId));
    } catch {
      setSub(null);
    }
  }, [user.profileId]);

  useEffect(() => {
    void loadSub();
  }, [loadSub]);

  useEffect(() => {
    if (messages.chat.length || messages.code.length || media.length) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, media, busy]);

  const thread = isChatMode ? messages[mode as "chat" | "code"] : [];
  const hasResults = isChatMode ? thread.length > 0 : media.length > 0;

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;

    if (!isChatMode && activeModel.premium && !isPro) {
      setPlansOpen(true);
      return;
    }

    setBusy(true);
    setPrompt("");

    try {
      if (isChatMode) {
        const key = mode as "chat" | "code";
        const next: ChatMessage[] = [...messages[key], { role: "user", content: text }];
        setMessages((m) => ({ ...m, [key]: next }));
        const res = await sendAiChat({ profileId: user.profileId, mode: key, messages: next });
        setMessages((m) => ({
          ...m,
          [key]: [...next, { role: "assistant", content: res.reply }],
        }));
      } else {
        const res = await generateAiMedia({
          profileId: user.profileId,
          kind: mediaKind,
          prompt: text,
          model: activeModel.id,
        });
        setMedia((prev) => [res, ...prev]);
        void loadSub();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (/limit|quota|subscription|upgrade/i.test(msg)) setPlansOpen(true);
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const pay = async (plan: AiPlanId) => {
    setPayingPlan(plan);
    try {
      const res = await subscribeAiPlan({ profileId: user.profileId, plan });
      setSub(res);
      setPlansOpen(false);
      toast({ title: "Subscription active", description: "Unlimited plan is now active." });
    } catch (e) {
      toast({
        title: "Payment failed",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setPayingPlan(null);
    }
  };

  const placeholder = useMemo(() => copy.sample, [copy.sample]);

  return (
    <div className="min-h-[100dvh] bg-background pb-28 font-geist">
      <section className="relative min-h-svh w-full overflow-hidden">
        <video
          src={HERO_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 z-0 h-full w-full object-cover"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[687px]"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)",
          }}
        />

        <div className="relative z-[2] mx-auto max-w-[1360px]">
          <nav className="relative flex items-center justify-between px-6 pb-4 pt-5">
            <span className="select-none font-typewriter text-[32px] leading-none text-wandor-dark">
              nova ai
            </span>
            <button
              onClick={() => setPlansOpen(true)}
              className="cursor-pointer rounded-full border-none bg-wandor-dark px-5 py-3 font-geist text-[13px] font-medium uppercase tracking-[0.04em] text-[#fafafa] transition-all hover:bg-[#333] active:scale-95"
            >
              {isPro ? "Unlimited" : "Go Unlimited"}
            </button>
          </nav>

          <div className="flex flex-col items-center px-6 pb-16 pt-10 text-center">
            <h1 className="mb-4 max-w-[820px] font-geist text-[clamp(34px,9vw,68px)] font-medium leading-[1.05] tracking-[-0.04em] text-wandor-text">
              {copy.title}
            </h1>
            <p className="mb-8 max-w-[500px] font-geist text-[15px] font-medium leading-relaxed text-wandor-muted">
              {copy.sub}
            </p>

            <div className="mb-6 flex w-full max-w-[701px] items-center gap-1 rounded-full border border-white/70 bg-white/50 p-1.5 backdrop-blur-[14px]">
              {TABS.map((t) => {
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setMode(t.id)}
                    className={cn(
                      "relative flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border-none bg-transparent font-geist text-[12px] font-medium uppercase tracking-[0.04em] transition-opacity",
                      active ? "text-[#fafafa]" : "text-wandor-text hover:opacity-55"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="ai-tab"
                        className="absolute inset-0 rounded-full bg-wandor-dark"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative flex items-center gap-1.5">
                      <t.icon className="h-4 w-4" strokeWidth={2} />
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative min-h-[208px] w-[701px] max-w-full overflow-hidden rounded-[44px] border-[3px] border-white bg-white/[0.06] shadow-[0_0_4px_0_rgba(0,0,0,0.15)] backdrop-blur-[20px]">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={placeholder}
                rows={3}
                className="min-h-[104px] resize-none border-0 bg-transparent px-7 pb-2 pt-7 text-left font-geist text-[17px] font-medium leading-relaxed text-wandor-prompt shadow-none placeholder:text-wandor-prompt/70 focus-visible:ring-0"
              />

              <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" />

              <div className="flex items-center justify-between px-[21px] pb-[21px] pt-1">
                <button
                  aria-label="Upload inspiration"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/70 bg-transparent backdrop-blur-[14px] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Upload className="h-[18px] w-[18px] shrink-0 text-wandor-text" />
                </button>

                <button
                  onClick={() => void submit()}
                  disabled={busy || !prompt.trim()}
                  className="flex h-14 w-[156px] cursor-pointer items-center justify-center gap-2 rounded-[44px] border-none bg-black font-geist text-base font-medium uppercase tracking-[0.02em] text-[#fafafa] shadow-[0_0_2px_0_rgba(0,0,0,0.05)] transition-all hover:bg-[#333] active:scale-95 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Generate
                      <ArrowUp className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {!isChatMode && (
              <div className="mt-5 flex w-full max-w-[701px] flex-wrap justify-center gap-2">
                {models.map((m) => {
                  const active = activeModel.id === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setModel((s) => ({ ...s, [mediaKind]: m.id }))}
                      className={cn(
                        "cursor-pointer rounded-full border px-4 py-2.5 font-geist text-[12px] font-medium uppercase tracking-[0.04em] transition-all active:scale-95",
                        active
                          ? "border-transparent bg-wandor-dark text-[#fafafa]"
                          : "border-white/70 bg-white/50 text-wandor-text backdrop-blur-[14px] hover:opacity-70"
                      )}
                    >
                      {m.name}
                      {m.premium && <Crown className="ml-1.5 inline h-3 w-3" strokeWidth={2.4} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <div ref={resultsRef} className="mx-auto max-w-[701px] space-y-3 px-6 pt-8">
        {busy && (
          <div className="flex items-center gap-2 rounded-3xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {isChatMode ? "Thinking…" : `Generating ${mediaKind}… this can take a moment`}
          </div>
        )}

        {isChatMode &&
          thread.map((m, i) => (
            <motion.div
              key={`${m.role}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease }}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-3xl px-4 py-3 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "bg-wandor-dark text-[#fafafa]"
                    : "border border-border bg-card text-foreground"
                )}
              >
                {m.content}
              </div>
            </motion.div>
          ))}

        {!isChatMode &&
          media.map((m) => (
            <motion.div
              key={m.url + m.created_at}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease }}
              className="overflow-hidden rounded-3xl border border-border bg-card p-2"
            >
              {m.kind === "video" ? (
                <video src={m.url} controls playsInline className="w-full rounded-2xl" />
              ) : (
                <img src={m.url} alt="Generated result" loading="lazy" className="w-full rounded-2xl" />
              )}
              <div className="flex items-center justify-between px-2 py-2 text-[11px] text-muted-foreground">
                <span>{m.model}</span>
                <a href={m.url} target="_blank" rel="noreferrer" className="font-semibold text-primary">
                  Open
                </a>
              </div>
            </motion.div>
          ))}

        {!hasResults && !busy && (
          <p className="text-center font-geist text-[12px] text-wandor-muted">
            {isPro
              ? "Unlimited plan active — create as much as you like."
              : "One plan · $10 / month · unlimited chat, code, images & video."}
          </p>
        )}
      </div>

      <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto rounded-[28px] font-geist">
          <DialogHeader>
            <DialogTitle className="font-typewriter text-3xl">Unlimited</DialogTitle>
            <DialogDescription className="text-[12px]">
              One plan. Everything unlimited. Paid monthly from your in-app balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {AI_PLANS.map((p) => {
              const current = sub?.plan === p.id && sub.status === "active";
              return (
                <div key={p.id} className="rounded-3xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold tracking-tight">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.tagline}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-typewriter text-3xl leading-none">${p.priceUsd}</p>
                      <p className="text-[10px] text-muted-foreground">per month</p>
                    </div>
                  </div>

                  <ul className="mt-4 space-y-1.5">
                    {p.perks.map((perk) => (
                      <li key={perk} className="flex items-center gap-2 text-[12px]">
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
                        {perk}
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => void pay(p.id)}
                    disabled={current || payingPlan !== null}
                    className="mt-5 h-12 w-full rounded-full bg-wandor-dark text-[#fafafa] hover:bg-[#333]"
                  >
                    {payingPlan === p.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : current ? (
                      "Current plan"
                    ) : (
                      `Subscribe · $${p.priceUsd}`
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AiPage;
