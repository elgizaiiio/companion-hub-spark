import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Check,
  Code2,
  Crown,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Sparkles,
  Video,
} from "lucide-react";
import SpotlightHero from "@/components/hero/SpotlightHero";
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

const TABS: { id: AiMode; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "code", label: "Code", icon: Code2 },
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Video },
];

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const isChatMode = mode === "chat" || mode === "code";
  const mediaKind = mode === "video" ? "video" : "image";
  const models: MediaModel[] = mediaKind === "video" ? VIDEO_MODELS : IMAGE_MODELS;
  const activeModel = models.find((m) => m.id === model[mediaKind]) ?? models[0];
  const isPro = sub?.status === "active" && sub.plan !== "free";

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mode, busy]);

  const thread = isChatMode ? messages[mode as "chat" | "code"] : [];

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
      toast({ title: "Subscription active", description: `You are now on the ${plan} plan.` });
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

  const placeholder = useMemo(() => {
    if (mode === "chat") return "Ask anything…";
    if (mode === "code") return "Describe the code you need…";
    if (mode === "image") return "Describe the image you want to create…";
    return "Describe the video scene…";
  }, [mode]);

  return (
    <div className="min-h-[100dvh] pb-32">
      <SpotlightHero title="Studio">
        <p className="relative z-20 -mt-1 px-6 text-center text-sm hero-dim">
          Chat, code, images and video — in one place.
        </p>

        <div className="mt-5 px-4">
          <div className="nv-card flex items-center gap-1 p-1.5">
            {TABS.map((t) => {
              const active = mode === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setMode(t.id)}
                  className={cn(
                    "relative flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold tracking-tight transition-colors",
                    active ? "text-primary-foreground" : "text-muted-foreground"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="ai-tab"
                      className="absolute inset-0 rounded-full action-black"
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
        </div>
      </SpotlightHero>

      <div className="px-4">
        <button
          onClick={() => setPlansOpen(true)}
          className="nv-card mt-4 flex w-full items-center gap-3 p-3 text-left liquid-press"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
            <Crown className="h-4 w-4 text-primary" strokeWidth={2} />
          </span>
          <span className="flex-1">
            <span className="block text-[13px] font-semibold tracking-tight">
              {isPro ? `${sub?.plan?.toUpperCase()} plan active` : "Unlock premium models"}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {isPro
                ? sub?.expires_at
                  ? `Renews ${new Date(sub.expires_at).toLocaleDateString()}`
                  : "Unlimited generations"
                : "Plans from $5 / month · unlimited images & video"}
            </span>
          </span>
          <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} />
        </button>

        {!isChatMode && (
          <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {models.map((m) => {
              const active = activeModel.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setModel((s) => ({ ...s, [mediaKind]: m.id }))}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-2 text-[11px] font-semibold tracking-tight transition-colors",
                    active
                      ? "border-transparent action-black text-primary-foreground"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {m.name}
                  {m.premium && (
                    <Crown
                      className={cn(
                        "ml-1 inline h-3 w-3",
                        active ? "text-primary-foreground" : "text-accent"
                      )}
                      strokeWidth={2.4}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="mt-4 space-y-3 px-4">
        {isChatMode && thread.length === 0 && !busy && (
          <div className="nv-card p-6 text-center">
            <p className="font-display text-2xl">
              {mode === "chat" ? "Start a conversation" : "Build something"}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {mode === "chat"
                ? "Ask questions, brainstorm, summarise, translate."
                : "Ask for a component, a script, a fix, or an explanation."}
            </p>
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
                    ? "action-black text-primary-foreground"
                    : "nv-card text-foreground"
                )}
              >
                {m.content}
              </div>
            </motion.div>
          ))}

        {!isChatMode && media.length === 0 && !busy && (
          <div className="nv-card p-6 text-center">
            <p className="font-display text-2xl">
              {mediaKind === "video" ? "Create a video" : "Create an image"}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Describe it below and pick a model. Premium models need a plan.
            </p>
          </div>
        )}

        {!isChatMode &&
          media.map((m) => (
            <motion.div
              key={m.url + m.created_at}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease }}
              className="nv-card overflow-hidden p-2"
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

        {busy && (
          <div className="nv-card flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {isChatMode ? "Thinking…" : `Generating ${mediaKind}… this can take a moment`}
          </div>
        )}
      </div>

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.6rem)] left-0 right-0 z-40 px-4">
        <div className="mx-auto flex max-w-lg items-end gap-2 rounded-[28px] border border-border/70 bg-background/85 p-2 backdrop-blur-2xl shadow-[0_10px_30px_-16px_rgba(16,46,38,0.28)]">
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
            rows={1}
            className="max-h-32 min-h-[44px] resize-none border-0 bg-transparent text-[13px] shadow-none focus-visible:ring-0"
          />
          <Button
            size="icon"
            onClick={() => void submit()}
            disabled={busy || !prompt.trim()}
            className="h-11 w-11 shrink-0 rounded-full action-black"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto rounded-[28px]">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Plans</DialogTitle>
            <DialogDescription className="text-[12px]">
              Paid monthly from your in-app balance. Cancel anytime.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {AI_PLANS.map((p) => {
              const current = sub?.plan === p.id && sub.status === "active";
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-3xl border p-4",
                    p.highlight ? "border-primary bg-secondary" : "border-border bg-card"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold tracking-tight">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.tagline}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-2xl leading-none">${p.priceUsd}</p>
                      <p className="text-[10px] text-muted-foreground">per month</p>
                    </div>
                  </div>

                  {p.highlight && (
                    <span className="mt-3 inline-flex rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                      Most popular
                    </span>
                  )}

                  <ul className="mt-3 space-y-1.5">
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
                    className="mt-4 h-11 w-full rounded-full action-black"
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

      <AnimatePresence />
    </div>
  );
};

export default AiPage;
