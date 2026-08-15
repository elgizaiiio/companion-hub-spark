import SpotlightHero from "@/components/hero/SpotlightHero";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Power, Lock, TrendingUp, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PaymentError, sendTonPayment, TON_FEE_BUFFER } from "@/lib/ton";
import { createTransaction, isWalletVerified } from "@/lib/game-api";

import NOVA_ICON from "@/assets/nova-coin.png";


const TON_ICON = "/images/gram-icon.png";
const USDT_ICON = "/images/usdt.png";
const VERIFY_AMOUNT = 3;
const NFT_MIN_GRAM = 4;
const STAKE_MIN_GRAM = 15;
const TON_USD = 3.5;
const REQUIRED_ATTACKS = 50;

const WalletPage = () => {
  const { user } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawCurrency, setWithdrawCurrency] = useState<"ton" | "usdt">("ton");
  const [depositAmount, setDepositAmount] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState<"nft" | "stake" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [hasServer, setHasServer] = useState(false);
  const [hasNft, setHasNft] = useState(false);
  const [stakedTon, setStakedTon] = useState(0);
  const [attacksBought, setAttacksBought] = useState(0);
  const [hasKill, setHasKill] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!user.profileId) return;
      const [verified, srvRes, invRes, killRes, nftRes, ownNftRes, stakeRes] = await Promise.all([
        isWalletVerified(user.telegramUser.id),
        supabase.from("user_servers").select("id").eq("user_id", user.profileId).limit(1),
        supabase.from("battle_inventory").select("total_purchased").eq("user_id", user.profileId).eq("category", "attack"),
        supabase.from("attacks").select("id").eq("user_id", user.profileId).eq("is_killing_blow", true).limit(1),
        supabase.from("user_servers").select("id").eq("user_id", user.profileId).gte("ton_paid", NFT_MIN_GRAM).limit(1),
        supabase.from("user_nfts").select("id").eq("telegram_id", user.telegramUser.id).gte("price_ton", NFT_MIN_GRAM).limit(1),
        supabase.from("stakes").select("amount").eq("profile_id", user.profileId).eq("currency", "ton").eq("status", "active"),
      ]);
      setIsVerified(Boolean(verified));
      setHasServer(!!srvRes.data && srvRes.data.length > 0);
      setAttacksBought((invRes.data ?? []).reduce((s, r: any) => s + (r.total_purchased ?? 0), 0));
      setHasKill(!!killRes.data && killRes.data.length > 0);
      setHasNft(((nftRes.data ?? []).length + (ownNftRes.data ?? []).length) > 0);
      setStakedTon((stakeRes.data ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0));
    };
    void check();
  }, [user.profileId, user.telegramUser.id]);

  // Withdrawal gate: verification first, then the remaining requirements.
  const openWithdrawFlow = () => {
    if (!isVerified) {
      setWhyOpen(false);
      setVerifyOpen(true);
      return;
    }
    if (!hasNft) {
      setReqOpen("nft");
      return;
    }
    if (stakedTon < STAKE_MIN_GRAM) {
      setReqOpen("stake");
      return;
    }
    setWithdrawCurrency("ton");
    setWithdrawOpen(true);
  };

  const handleConnectWallet = async () => {
    try { await tonConnectUI.openModal(); } catch {}
  };

  if (!tonConnectUI.connected) {
    return (
      <div className="min-h-screen pb-28">
        <SpotlightHero title="Wallet">
        <div className="px-5 pt-8 pb-10 flex flex-col items-center justify-center">
        <motion.div
          className="rounded-3xl glass glass-panel p-8 text-center max-w-sm w-full"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <div className="mx-auto mb-5 rounded-full bg-foreground/[0.06] px-5 py-2">
            <p className="text-[10px] uppercase tracking-[0.34em] text-muted-foreground">Wallet</p>
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-2">Connect Wallet</h1>
          <p className="text-sm text-muted-foreground mb-6">Connect your TON wallet to access deposits and withdrawals</p>
          <Button onClick={handleConnectWallet} className="w-full h-12 rounded-2xl font-display glow-primary">Connect TON Wallet</Button>
          <p className="text-[11px] text-muted-foreground mt-4 tracking-wider uppercase">Min. withdrawal · 1 Gram</p>
        </motion.div>
        </div>
        </SpotlightHero>
      </div>
    );
  }

  const balances = [
    { symbol: "$NOVA", balance: user.siriBalance, color: "text-primary", icon: null, usd: 0 },
    { symbol: "Gram", balance: user.tonBalance, color: "text-ton-blue", icon: TON_ICON, usd: user.tonBalance * TON_USD },
    { symbol: "USDT", balance: user.usdtBalance, color: "text-neon-green", icon: USDT_ICON, usd: user.usdtBalance },
  ];

  const handleDisconnect = async () => {
    await tonConnectUI.disconnect();
    toast({ title: "Disconnected" });
  };

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) { toast({ title: "Invalid Amount", variant: "destructive" }); return; }
    try {
      await sendTonPayment(tonConnectUI, { amountTon: amount, comment: "Nova deposit" });
      await createTransaction({ telegramId: user.telegramUser.id, type: "deposit", amount, currency: "ton", walletAddress: address });
      toast({ title: "Deposit Sent", description: `${amount} Gram submitted` });
      setDepositOpen(false);
      setDepositAmount("");
    } catch (err) {
      if (err instanceof PaymentError) {
        toast({
          title: err.code === "not_connected" ? "Wallet not connected" : "Deposit failed",
          description: err.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Deposit failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    const min = 1;
    if (!amount || amount < min) {
      toast({ title: `Minimum ${min} ${withdrawCurrency.toUpperCase()}`, variant: "destructive" });
      return;
    }
    await createTransaction({ telegramId: user.telegramUser.id, type: "withdrawal", amount, currency: withdrawCurrency, walletAddress: address });
    toast({ title: "Withdrawal Requested", description: `${amount} ${withdrawCurrency.toUpperCase()} submitted` });
    setWithdrawOpen(false);
    setWithdrawAmount("");
  };


  const handleVerifyWallet = async () => {
    setVerifying(true);
    try {
      const tx = await sendTonPayment(tonConnectUI, {
        amountTon: VERIFY_AMOUNT,
        comment: "Nova wallet verification",
      });
      await createTransaction({
        telegramId: user.telegramUser.id,
        type: "wallet_verification",
        amount: VERIFY_AMOUNT,
        currency: "ton",
        walletAddress: address,
        txHash: tx.boc || null,
        status: "completed",
      });
      setIsVerified(true);
      setVerifyOpen(false);
      toast({ title: "Wallet verified", description: "Your wallet ownership is confirmed" });
      if (!hasNft) setReqOpen("nft");
      else if (stakedTon < STAKE_MIN_GRAM) setReqOpen("stake");
      else {
        setWithdrawCurrency("ton");
        setWithdrawOpen(true);
      }
    } catch (err) {
      if (err instanceof PaymentError) {
        toast({
          title: err.code === "not_connected" ? "Wallet not connected" : "Verification failed",
          description: err.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Verification failed", description: "Please try again", variant: "destructive" });
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen pb-28">
      <SpotlightHero title="Wallet">
      <div className="px-5 pt-8">


      {/* Total balance hero */}
      <motion.div
        className="rounded-3xl glass glass-panel p-6 mb-5"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2 text-center">Total Equivalent</p>
        <h2 className="text-4xl font-display font-bold text-center text-gradient-primary mb-6">
          ${(user.tonBalance * 3.5 + user.usdtBalance + Number(user.rewardBalance ?? 0)).toFixed(2)}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => setDepositOpen(true)}
            className="h-12 rounded-2xl font-display text-sm glow-primary"
          >
            Deposit
          </Button>
          <Button
            onClick={openWithdrawFlow}
            variant="outline"
            className="h-12 rounded-2xl font-display text-sm border-border bg-card/40"
          >
            Withdraw
          </Button>
        </div>
      </motion.div>

      {/* Staking entry */}
      <motion.button
        onClick={() => navigate("/staking")}
        className="mb-5 w-full rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 to-accent/10 backdrop-blur-xl p-4 flex items-center justify-between"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-foreground">Staking & Bonds</p>
            <p className="text-[11px] text-muted-foreground">Lock Gram or $NOVA · earn daily yield</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </motion.button>

      {/* Asset list */}
      <div className="space-y-2.5 mb-6">
        {Number(user.rewardBalance ?? 0) > 0 && (
          <motion.div
            className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 to-accent/10 backdrop-blur-xl p-4 flex items-center justify-between"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Locked USDT</p>
                <p className="text-[11px] text-muted-foreground">Prize reward</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-display font-bold text-primary">
                {Number(user.rewardBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                ≈ ${Number(user.rewardBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
            </div>
          </motion.div>
        )}
        {balances.map((b, i) => (
          <motion.div
            key={b.symbol}
            className="rounded-2xl glass glass-panel p-4 flex items-center justify-between"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center">
                {b.icon ? <img src={b.icon} alt={b.symbol} className="w-6 h-6 rounded-full" loading="lazy" /> : <img src={NOVA_ICON} alt="NOVA" className="w-7 h-7" loading="lazy" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{b.symbol}</p>
                <p className="text-[11px] text-muted-foreground">Available</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-lg font-display font-bold ${b.color}`}>
                {b.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </p>
              {b.symbol !== "$NOVA" && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  ≈ ${b.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Connection footer */}
      <motion.div
        className="rounded-2xl glass glass-panel p-4 flex items-center justify-between"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Connected</p>
          <p className="text-xs font-mono text-foreground truncate">
            {address ? `${address.slice(0, 6)}...${address.slice(-6)}` : ""}
          </p>
        </div>
        <Button
          onClick={handleDisconnect}
          variant="outline"
          size="sm"
          className="rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5"
        >
          <Power className="w-3.5 h-3.5" /> Disconnect
        </Button>
      </motion.div>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="fixed bottom-auto left-1/2 right-auto top-1/2 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[32px] border-0 bg-transparent p-0 shadow-none sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div
            className="relative w-full overflow-hidden rounded-[32px] px-7 pb-8 pt-9 text-center"
            style={{
              background: "hsl(0 0% 100% / 0.85)",
              backdropFilter: "blur(32px) saturate(180%)",
              WebkitBackdropFilter: "blur(32px) saturate(180%)",
              border: "1px solid hsl(160 18% 90%)",
              boxShadow: "0 24px 70px -20px rgba(0,0,0,0.6), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-[32px] opacity-40"
              style={{
                background:
                  "linear-gradient(180deg, hsl(0 0% 100% / 0.16) 0%, hsl(0 0% 100% / 0.05) 45%, transparent 100%)",
              }}
            />
            <DialogHeader className="relative z-10">
              <DialogTitle className="text-center text-[10px] font-normal uppercase tracking-[0.34em] text-muted-foreground">
                Deposit Gram
              </DialogTitle>
              <DialogDescription className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
                Send Gram from your connected wallet
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Amount in Gram"
              type="number"
              className="relative z-10 mt-6 h-12 rounded-2xl border-0 bg-foreground/[0.06] text-center text-[16px]"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
            <Button
              onClick={handleDeposit}
              className="relative z-10 mt-4 h-12 w-full rounded-2xl font-display text-[15px] font-medium glow-primary"
            >
              Send deposit
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="fixed bottom-auto left-1/2 right-auto top-1/2 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[32px] border-0 bg-transparent p-0 shadow-none sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div
            className="relative rounded-[32px] px-7 pb-8 pt-9 text-center"
            style={{
              background: "hsl(0 0% 100% / 0.85)",
              backdropFilter: "blur(32px) saturate(180%)",
              WebkitBackdropFilter: "blur(32px) saturate(180%)",
              border: "1px solid hsl(160 18% 90%)",
              boxShadow: "0 24px 70px -20px rgba(0,0,0,0.6), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-[32px] opacity-40"
              style={{
                background:
                  "linear-gradient(180deg, hsl(0 0% 100% / 0.16) 0%, hsl(0 0% 100% / 0.05) 45%, transparent 100%)",
              }}
            />
            <DialogHeader className="relative z-10">
              <DialogTitle className="text-center text-[10px] font-normal uppercase tracking-[0.34em] text-muted-foreground">
                Withdraw
              </DialogTitle>
              <DialogDescription className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
                Choose a currency and amount
              </DialogDescription>
            </DialogHeader>
            <div className="relative z-10 mt-6 grid grid-cols-2 gap-1.5 rounded-2xl bg-foreground/[0.06] p-1.5">
              {(["ton", "usdt"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setWithdrawCurrency(c)}
                  className={`h-11 rounded-xl font-display text-[14px] transition-all ${
                    withdrawCurrency === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {c === "ton" ? "Gram" : "USDT"}
                </button>
              ))}
            </div>
            <Input
              placeholder={`Amount in ${withdrawCurrency === "ton" ? "Gram" : "USDT"}`}
              type="number"
              className="relative z-10 mt-4 h-12 rounded-2xl border-0 bg-foreground/[0.06] text-center text-[16px]"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />
            <Button
              onClick={handleWithdraw}
              className="relative z-10 mt-4 h-12 w-full rounded-2xl font-display text-[15px] font-medium glow-primary"
            >
              Request withdrawal
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="fixed bottom-auto left-1/2 right-auto top-1/2 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[32px] border-0 bg-transparent p-0 shadow-none sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div
            className="relative rounded-[32px] px-7 pb-8 pt-9 text-center"
            style={{
              background: "hsl(0 0% 100% / 0.85)",
              backdropFilter: "blur(32px) saturate(180%)",
              WebkitBackdropFilter: "blur(32px) saturate(180%)",
              border: "1px solid hsl(160 18% 90%)",
              boxShadow: "0 24px 70px -20px rgba(0,0,0,0.6), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-[32px] opacity-40"
              style={{
                background:
                  "linear-gradient(180deg, hsl(0 0% 100% / 0.16) 0%, hsl(0 0% 100% / 0.05) 45%, transparent 100%)",
              }}
            />
            <DialogHeader className="relative z-10">
              <DialogTitle className="text-[10px] font-normal uppercase tracking-[0.34em] text-muted-foreground">
                Wallet verification
              </DialogTitle>
              <DialogDescription className="sr-only">One-time wallet verification fee</DialogDescription>
            </DialogHeader>
            <div className="relative z-10 mt-6 rounded-[28px] border border-white/[0.08] bg-foreground/[0.05] px-5 py-6">
              <p className="text-[38px] font-display font-medium leading-none text-gradient-primary">
                {VERIFY_AMOUNT} Gram
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">One-time fee</p>
            </div>
            <p className="relative z-10 mt-5 text-[12px] leading-relaxed text-muted-foreground">
              Verify wallet ownership to unlock withdrawals. This is required once.
            </p>
            <p className="relative z-10 mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Keep at least {(VERIFY_AMOUNT + TON_FEE_BUFFER).toFixed(2)} Gram in your wallet so the network fee is
              covered.
            </p>
            <button
              onClick={() => setWhyOpen((v) => !v)}
              className="relative z-10 mt-4 text-[11px] uppercase tracking-[0.2em] text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
            >
              Why do we verify?
            </button>
            {whyOpen && (
              <p className="relative z-10 mt-4 rounded-[24px] border border-white/[0.08] bg-foreground/[0.05] p-4 text-left text-[12px] leading-relaxed text-muted-foreground">
                We have many investors, so every account must be proven real and not fake — the prize must never go
                to a fake account. The verification fee proves wallet ownership, protects everyone's funds, and
                unlocks all future withdrawals.
              </p>
            )}
            <Button
              onClick={handleVerifyWallet}
              disabled={verifying}
              className="relative z-10 mt-6 h-12 w-full rounded-2xl font-display text-[15px] font-medium glow-primary"
            >
              {verifying ? "Verifying" : `Pay ${VERIFY_AMOUNT} Gram and verify`}
            </Button>
            <button
              onClick={() => setVerifyOpen(false)}
              className="relative z-10 mt-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reqOpen !== null} onOpenChange={(o) => !o && setReqOpen(null)}>
        <DialogContent className="fixed bottom-auto left-1/2 right-auto top-1/2 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[32px] border-0 bg-transparent p-0 shadow-none sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div
            className="relative rounded-[32px] px-7 pb-8 pt-9 text-center"
            style={{
              background: "hsl(0 0% 100% / 0.85)",
              backdropFilter: "blur(32px) saturate(180%)",
              WebkitBackdropFilter: "blur(32px) saturate(180%)",
              border: "1px solid hsl(160 18% 90%)",
              boxShadow: "0 24px 70px -20px rgba(0,0,0,0.6), inset 0 1px 0 hsl(0 0% 100% / 0.12)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-[32px] opacity-40"
              style={{
                background:
                  "linear-gradient(180deg, hsl(0 0% 100% / 0.16) 0%, hsl(0 0% 100% / 0.05) 45%, transparent 100%)",
              }}
            />
            <DialogHeader className="relative z-10">
              <DialogTitle className="text-[10px] font-normal uppercase tracking-[0.34em] text-muted-foreground">
                Withdrawal requirement
              </DialogTitle>
              <DialogDescription className="sr-only">Requirement details</DialogDescription>
            </DialogHeader>
            <div className="relative z-10 mt-6 rounded-[28px] border border-white/[0.08] bg-foreground/[0.05] px-5 py-6">
              <p className="text-[38px] font-display font-medium leading-none text-gradient-primary">
                {reqOpen === "nft" ? NFT_MIN_GRAM : STAKE_MIN_GRAM} Gram
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {reqOpen === "nft" ? "Minimum NFT value" : "Minimum stake"}
              </p>
            </div>
            <p className="relative z-10 mt-5 text-[12px] leading-relaxed text-muted-foreground">
              {reqOpen === "nft"
                ? `Own an NFT worth at least ${NFT_MIN_GRAM} Gram to unlock withdrawals. This confirms the account is active and real before the prize is released.`
                : `Stake at least ${STAKE_MIN_GRAM} Gram on the Bonds page to unlock withdrawals. You currently have ${stakedTon.toLocaleString("en-US", { maximumFractionDigits: 2 })} Gram staked.`}
            </p>
            <Button
              onClick={() => {
                const to = reqOpen === "nft" ? "/servers" : "/staking";
                setReqOpen(null);
                navigate(to);
              }}
              className="relative z-10 mt-6 h-12 w-full rounded-2xl font-display text-[15px] font-medium glow-primary"
            >
              {reqOpen === "nft" ? "Buy NFT" : "Go to staking"}
            </Button>
            <button
              onClick={() => setReqOpen(null)}
              className="relative z-10 mt-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Later
            </button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
      </SpotlightHero>
    </div>
  );
};

export default WalletPage;
