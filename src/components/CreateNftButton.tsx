import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { useTonConnectUI } from "@tonconnect/ui-react";
import { supabase } from "@/integrations/supabase/client";
import { verifyTonOnChain } from "@/lib/game-api";
import { PaymentError, sendTonPayment } from "@/lib/ton";

const TON_ICON = "/images/gram-icon.png";
const PRICE_TON = 4;

const CreateNftButton = ({ onCreated }: { onCreated?: () => void }) => {
  const { user } = useApp();
  const { toast } = useToast();
  const [tonConnectUI] = useTonConnectUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [result, setResult] = useState<string>("");

  const pickFile = (file?: File) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 6MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const create = async () => {
    if (!preview) {
      toast({ title: "Pick a photo first", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      setStep("Confirm in your wallet…");
      const tx = await sendTonPayment(tonConnectUI, {
        amountTon: PRICE_TON,
        comment: `Nova NFT ${name.trim()}`.trim(),
      });

      setStep("Verifying payment on-chain…");
      const verification = await verifyTonOnChain(PRICE_TON, tx.boc);
      if (!verification.verified) {
        toast({ title: "Payment not verified", variant: "destructive" });
        return;
      }

      setStep("Generating your NFT…");
      const { data, error } = await supabase.functions.invoke("generate-nft", {
        body: {
          telegramId: user.telegramUser.id,
          priceTon: PRICE_TON,
          image: preview,
          name: name.trim(),
          txHash: verification.tx_hash || tx.boc,
        },
      });

      if (error || (data as any)?.error) {
        toast({ title: "Generation failed", description: "Please try again", variant: "destructive" });
        return;
      }

      setResult((data as any).nft.image_url);
      toast({ title: "NFT created!", description: "Your custom NFT is ready" });
      onCreated?.();
    } catch (err) {
      if (err instanceof PaymentError) {
        toast({
          title: err.code === "not_connected" ? "Wallet not connected" : "Payment failed",
          description: err.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Something went wrong", description: "Please try again", variant: "destructive" });
      }
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  const reset = () => {
    setPreview("");
    setResult("");
    setName("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-12 w-full rounded-2xl font-display text-sm glow-primary gap-2">
          Create your NFT · 4 Gram
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display">Create your NFT</DialogTitle>
          <DialogDescription>
            Upload a photo and pay 4 Gram directly from your connected wallet. No deposit is required.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <img src={result} alt="Your generated NFT" className="w-full rounded-2xl"  loading="lazy" decoding="async" />
            <Button onClick={() => setOpen(false)} className="h-12 w-full rounded-2xl font-display">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-44 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 text-xs text-muted-foreground"
            >
              {preview ? (
                <img src={preview} alt="Selected photo" className="h-full w-full object-cover"  loading="lazy" decoding="async" />
              ) : (
                "Tap to upload your photo"
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />

            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="NFT name (optional)"
              className="h-12 rounded-2xl"
            />

            <Button
              onClick={create}
              disabled={busy}
              className="h-12 w-full rounded-2xl font-display glow-primary gap-2"
            >
              {busy ? (
                <span className="animate-pulse">{step || "Working…"}</span>
              ) : (
                <>
                  <img src={TON_ICON} alt="Gram" className="h-4 w-4 rounded-full"  loading="lazy" decoding="async" />
                  Pay 4 Gram & Generate
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateNftButton;
