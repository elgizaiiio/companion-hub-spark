import SpotlightHero from "@/components/hero/SpotlightHero";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/context/AppContext";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { useToast } from "@/hooks/use-toast";
import ServerArtwork from "@/components/ServerArtwork";
import CreateNftButton from "@/components/CreateNftButton";
import { purchaseServerForTelegram, verifyTonOnChain } from "@/lib/game-api";
import { swr } from "@/lib/cache";
import CachedImage from "@/components/CachedImage";
import { PaymentError, sendTonPayment } from "@/lib/ton";


const TON_ICON = "/images/gram-icon.png";
const USDT_ICON = "/images/usdt.png";

interface Server {
  id: string;
  name: string;
  image_url: string;
  price_ton: number;
  rarity: string;
  mining_boost: number | null;
  attack_boost: number | null;
  ton_mining_rate: number | null;
  usdt_mining_rate: number | null;
}


const ServersPage = () => {
  const { user, refreshProfile } = useApp();
  const { toast } = useToast();
  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [myNfts, setMyNfts] = useState<{ id: string; name: string; image_url: string }[]>([]);

  useEffect(() => { void loadServers(); void loadMyNfts(); }, []);

  const loadServers = async () => {
    await swr<Server[]>(
      "servers",
      async () => {
        const { data } = await supabase.from("servers").select("*").eq("is_active", true).order("price_ton", { ascending: true });
        return (data || []) as Server[];
      },
      (rows) => {
        setServers(rows);
        setLoading(false);
      },
      10 * 60 * 1000,
    );
    setLoading(false);
  };

  const loadMyNfts = async () => {
    const { data } = await supabase
      .from("user_nfts")
      .select("id, name, image_url")
      .eq("telegram_id", user.telegramUser.id)
      .order("created_at", { ascending: false });
    if (data) setMyNfts(data);
  };


  const handleBuy = async (server: Server) => {
    const priceTon = Number(server.price_ton);

    try {
      // Step 1: Send Gram transaction to the treasury
      const transaction = await sendTonPayment(tonConnectUI, {
        amountTon: priceTon,
        comment: `Nova ${server.name}`,
      });

      // Step 2: Verify on-chain (strict - blocks until confirmed)
      setVerifying(server.id);
      toast({ title: "Verifying payment...", description: "Checking blockchain confirmation" });

      const verification = await verifyTonOnChain(priceTon, transaction.boc);

      if (!verification.verified) {
        setVerifying(null);
        toast({ title: "Verification failed", description: "Transaction not found on the blockchain.", variant: "destructive" });
        return;
      }

      // Step 3: Only grant items AFTER on-chain verification
      await purchaseServerForTelegram({
        telegramId: user.telegramUser.id,
        serverId: server.id,
        tonPaid: priceTon,
        walletAddress,
        txHash: verification.tx_hash || transaction.boc,
      });

      await refreshProfile();
      setVerifying(null);
      toast({ title: "Purchase complete", description: `${server.name} added successfully` });
    } catch (err) {
      setVerifying(null);
      if (err instanceof PaymentError) {
        toast({
          title: err.code === "not_connected" ? "Wallet not connected" : "Payment failed",
          description: err.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Purchase failed", description: "Please try again", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-gradient-dark flex items-center justify-center"><div className="text-muted-foreground font-display animate-pulse">Loading...</div></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-dark pb-24">
      <SpotlightHero title="NFTs">
      <div className="px-4 pt-8">

      <div className="mb-4">
        <CreateNftButton onCreated={() => void loadMyNfts()} />
      </div>

      {myNfts.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-xs font-display uppercase tracking-widest text-muted-foreground">Your Creations</h2>
          <div className="grid grid-cols-2 gap-3">
            {myNfts.map((n) => (
              <div key={n.id} className="glass rounded-2xl p-3">
                <CachedImage src={n.image_url} alt={n.name} className="mb-2 w-full rounded-xl object-cover" />
                <p className="text-center text-xs font-display font-bold text-foreground">{n.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}


      {servers.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">No servers available</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {servers.map((server, i) => (
            <motion.div key={server.id} className="glass rounded-2xl p-3 flex flex-col"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <ServerArtwork name={server.name} imageUrl={server.image_url} rarity={server.rarity} className="my-3" />
              <h3 className="text-xs font-display font-bold text-foreground text-center mb-2">{server.name}</h3>
              <div className="space-y-1 mb-3 text-[10px]">
                <div className="flex justify-between text-muted-foreground">
                  <span>Mining +{server.mining_boost || 0}%</span>
                  <span>Atk +{server.attack_boost || 0}%</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span className="text-ton-blue flex items-center gap-0.5">
                    <img src={TON_ICON} alt="Gram" className="w-3 h-3 rounded-full"  loading="lazy" decoding="async" />
                    +{server.ton_mining_rate || 0}/d
                  </span>
                  <span className="text-neon-green flex items-center gap-0.5">
                    <img src={USDT_ICON} alt="USDT" className="w-3 h-3"  loading="lazy" decoding="async" />
                    +{server.usdt_mining_rate || 0}/d
                  </span>
                </div>
              </div>
              <Button size="sm" className="w-full rounded-xl font-display text-xs glow-primary mt-auto"
                onClick={() => handleBuy(server)} disabled={verifying === server.id}>
                {verifying === server.id ? (
                  <span className="animate-pulse">Verifying...</span>
                ) : tonConnectUI.connected ? (
                  <span className="flex items-center gap-1">
                    <img src={TON_ICON} alt="Gram" className="w-3 h-3 rounded-full"  loading="lazy" decoding="async" />
                    {Number(server.price_ton)} Gram
                  </span>
                ) : "Connect Wallet"}
              </Button>
            </motion.div>
          ))}
        </div>
      )}
      </div>
      </SpotlightHero>
    </div>
  );
};

export default ServersPage;
