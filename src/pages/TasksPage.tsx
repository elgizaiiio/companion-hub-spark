import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { completeTaskForTelegram, getReferralSummaryForTelegram, type ReferralSummary } from "@/lib/game-api";
import SpotlightHero from "@/components/hero/SpotlightHero";
import { swr } from "@/lib/cache";

interface Task {
  id: string;
  title: string;
  reward_amount: number;
  reward_type: string;
  task_type: string;
  link: string | null;
  verification_type: string;
  is_pinned: boolean;
}

const VERIFICATION_LABELS: Record<string, string> = {
  referral_count: "Invite 3 friends to unlock",
  mining_hours: "Complete 3 mining sessions",
  server_purchase: "Buy your first server",
  kill_monster: "Land a killing blow on a monster",
};

const REWARD_TEXT_COLORS: Record<string, string> = {
  ton: "text-primary",
  usdt: "text-primary",
  siri: "text-accent",
};

const REWARD_LABEL: Record<string, string> = {
  ton: "Gram",
  usdt: "USDT",
  siri: "$NOVA",
};

const TasksPage = () => {
  const { user, setUser } = useApp();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [referralSummary, setReferralSummary] = useState<ReferralSummary>({ count: 0, ton_earned: 0, users: [], rewards: [] });

  const referralLink = `https://t.me/Noveaibot/App?startapp=${user.referralCode}`;

  useEffect(() => {
    void Promise.all([loadTasks(), loadCompletedTasks(), loadReferralSummary()]);
  }, [user.profileId]);

  const loadTasks = async () => {
    await swr<Task[]>(
      "tasks",
      async () => {
        const { data } = await supabase
          .from("tasks")
          .select("id, title, description, reward_amount, reward_type, task_type, link, verification_type, is_pinned")
          .eq("is_active", true)
          .order("is_pinned", { ascending: false })
          .order("created_at", { ascending: true });
        return (data || []) as Task[];
      },
      (rows) => {
        setTasks(rows);
        setLoading(false);
      },
      5 * 60 * 1000,
    );
    setLoading(false);
  };

  const loadCompletedTasks = async () => {
    if (!user.profileId) return;
    const { data } = await supabase.from("user_tasks").select("task_id").eq("user_id", user.profileId);
    if (data) setCompletedTaskIds(data.map((t) => t.task_id));
  };

  const loadReferralSummary = async () => {
    const summary = await getReferralSummaryForTelegram(user.telegramUser.id);
    setReferralSummary(summary);
  };

  const handleTask = async (task: Task) => {
    if (completedTaskIds.includes(task.id) || claiming) return;
    setClaiming(task.id);

    // Open the task link immediately so popup blockers don't fire
    if (task.link) {
      try {
        const tg = (window as any).Telegram?.WebApp;
        const isTelegramLink = /^(https?:\/\/)?(t\.me|telegram\.me|telegram\.dog)\//i.test(task.link);
        if (tg?.openTelegramLink && isTelegramLink) {
          tg.openTelegramLink(task.link);
        } else if (tg?.openLink) {
          tg.openLink(task.link, { try_instant_view: false });
        } else {
          window.open(task.link, "_blank", "noopener,noreferrer");
        }
      } catch {
        window.open(task.link, "_blank", "noopener,noreferrer");
      }
    }

    try {
      const result = await completeTaskForTelegram(user.telegramUser.id, task.id);
      if ((result as any).error) {
        const errorMsg = (result as any).error;
        if (errorMsg === 'NEED_3_REFERRALS') {
          toast({ title: "Not yet!", description: `You need 3 referrals (current: ${(result as any).current})`, variant: "destructive" });
        } else if (errorMsg === 'NEED_3_MINING_SESSIONS') {
          toast({ title: "Not yet!", description: `Complete 3 mining sessions (current: ${(result as any).current})`, variant: "destructive" });
        } else if (errorMsg === 'NEED_SERVER_PURCHASE') {
          toast({ title: "Not yet!", description: "Buy a server first!", variant: "destructive" });
        } else if (errorMsg === 'NEED_MONSTER_KILL') {
          toast({ title: "Not yet!", description: "Kill a monster first!", variant: "destructive" });
        } else {
          toast({ title: "Task failed", variant: "destructive" });
        }
        return;
      }
      if (result.alreadyCompleted) return;

      setCompletedTaskIds((prev) => [...prev, task.id]);
      setUser((prev) => ({
        ...prev,
        siriBalance: result.balances.siri,
        tonBalance: result.balances.ton,
        usdtBalance: result.balances.usdt,
      }));
      toast({ title: "Task Completed!", description: `+${result.rewardAmount} ${result.rewardType.toUpperCase()}` });
    } catch {
      toast({ title: "Task failed", variant: "destructive" });
    } finally {
      setClaiming(null);
    }
  };

  const copyReferral = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const shareReferral = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join Nova AI and earn Gram & USDT!")}`);
    } else {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join Nova AI and earn Gram & USDT!")}`, "_blank");
    }
  };

  const availableTasks = tasks.filter((t) => !completedTaskIds.includes(t.id));

  return (
    <div className="min-h-screen pb-28">
      <SpotlightHero title="Tasks">
      <div id="tasks" className="px-5 pt-8">

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList className="w-full glass glass-subtle border border-border rounded-full h-11 mb-6 p-1">
          <TabsTrigger value="tasks" className="flex-1 rounded-full font-display text-xs uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">Tasks</TabsTrigger>
          <TabsTrigger value="referral" className="flex-1 rounded-full font-display text-xs uppercase tracking-widest data-[state=active]:bg-accent data-[state=active]:text-accent-foreground transition-all">Invite</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks">
          {loading ? (
            <div className="text-center text-muted-foreground py-8 animate-pulse">Loading tasks...</div>
          ) : availableTasks.length === 0 ? (
            <motion.div className="text-center py-12" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="text-lg font-display text-foreground mb-1">All Done!</p>
              <p className="text-sm text-muted-foreground">Check back later for new tasks</p>
            </motion.div>
          ) : (
            <div className="space-y-2.5">
              <AnimatePresence>
                {availableTasks.map((task, i) => {
                  const textColor = REWARD_TEXT_COLORS[task.reward_type] || "text-primary";
                  const label = REWARD_LABEL[task.reward_type] || "$NOVA";

                  return (
                    <motion.div key={task.id} layout
                      className="relative rounded-2xl glass glass-panel cursor-pointer active:scale-[0.98] transition-all duration-200 hover:border-primary/40"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1], delay: Math.min(i, 8) * 0.035 }}
                      onClick={() => void handleTask(task)}>
                      <div className="rounded-2xl p-3.5">
                        {task.is_pinned && (
                          <div className="absolute -top-2 right-3 bg-accent text-accent-foreground text-[9px] font-display font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg">
                            PINNED
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{task.title}</p>
                            {task.verification_type !== 'none' && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                {VERIFICATION_LABELS[task.verification_type] || "Complete requirement"}
                              </p>
                            )}
                            {task.verification_type === 'none' && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">Tap to open</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="flex items-center gap-1 justify-end">
                              <p className={`text-base font-display font-bold ${textColor} leading-none`}>+{task.reward_amount}</p>
                            </div>
                            <p className="text-[10px] text-muted-foreground tracking-wider mt-1">{label}</p>
                          </div>
                        </div>
                        {claiming === task.id && (
                          <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                              initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 1.2 }} />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="referral">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <motion.div className="glass rounded-2xl p-4 text-center" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <p className="text-3xl font-display font-bold text-primary">{referralSummary.count}</p>
                <p className="text-xs text-muted-foreground mt-1">Invited Users</p>
              </motion.div>
              <motion.div className="glass rounded-2xl p-4 text-center" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <p className="text-3xl font-display font-bold text-ton-blue">{Number(referralSummary.ton_earned || 0).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-1">Gram Earned</p>
              </motion.div>
            </div>

            <motion.div className="glass rounded-2xl p-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <h3 className="text-sm font-display font-bold text-foreground mb-2">Your Referral Link</h3>
              <div className="glass rounded-xl p-3 mb-3 break-all text-xs text-muted-foreground font-mono">{referralLink}</div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={copyReferral} variant="outline" className="rounded-xl font-display text-xs h-10 gap-2">
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
                <Button onClick={shareReferral} className="rounded-xl font-display text-xs h-10 gap-2 glow-primary">
                  Share
                </Button>
              </div>
            </motion.div>

            <motion.div className="glass rounded-2xl p-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <h3 className="text-sm font-display font-bold text-foreground mb-3">How It Works</h3>
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <p className="text-xs text-muted-foreground">Share your referral link with friends</p>
                </div>
                <div className="flex items-start gap-3">
                  <p className="text-xs text-muted-foreground">They join Nova AI and start playing</p>
                </div>
                <div className="flex items-start gap-3">
                  <p className="text-xs text-muted-foreground">Earn <span className="text-ton-blue font-bold">50%</span> of every Gram purchase they make!</p>
                </div>
              </div>
            </motion.div>

            <motion.div className="glass rounded-2xl p-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <h3 className="text-sm font-display font-bold text-foreground mb-3">Invited Users</h3>
              {referralSummary.users.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground">No referrals yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Share your link to start earning!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {referralSummary.users.map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{member.first_name}</p>
                          <p className="text-xs text-muted-foreground">{member.username ? `@${member.username}` : "Player"}</p>
                        </div>
                      </div>
                      <span className="text-[11px] text-primary font-display">Active</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </TabsContent>
      </Tabs>
      </div>
    </SpotlightHero>
    </div>
  );
};

export default TasksPage;
