import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/context/AppContext";
import { Progress } from "@/components/ui/progress";
import SpotlightHero from "@/components/hero/SpotlightHero";


const TON_ICON = "/images/gram-icon.png";
const USDT_ICON = "/images/usdt.png";

const MiningPage = () => {
  const { user, startMining, getMiningTimeLeft, getMiningProgress } = useApp();
  const [timeLeft, setTimeLeft] = useState("00:00:00");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(getMiningTimeLeft());
      setProgress(getMiningProgress());
    }, 1000);
    return () => clearInterval(interval);
  }, [getMiningTimeLeft, getMiningProgress]);

  return (
    <SpotlightHero title="NOVA AI" center>
      <div className="flex w-full flex-col px-5 pb-28 pt-2">

        {/* Bottom glass stack */}
        <motion.div
          className="nv-card ze-reveal ze-d2 p-5"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <p className="nv-eyebrow block text-center">$NOVA Balance</p>
          <p className="hero-title mt-1 text-center text-5xl leading-none">
            {user.siriBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </p>

          {user.isMining && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="hero-dim text-[10px] uppercase tracking-widest">Mining</span>
                <span className="hero-fg text-[11px] font-display">{progress.toFixed(1)}%</span>
              </div>
              <Progress value={progress} className="h-1 bg-white/15" />
            </div>
          )}

          <button
            onClick={user.isMining ? undefined : startMining}
            disabled={user.isMining}
            className="nv-pill mt-5 w-full"
          >
            {user.isMining ? timeLeft : "Start Mining"}
          </button>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              { label: "Gram", value: user.tonBalance, icon: TON_ICON },
              { label: "USDT", value: user.usdtBalance, icon: USDT_ICON },
            ].map((s) => (
              <div key={s.label} className="nv-card ze-reveal ze-d4 p-3.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <img src={s.icon} alt={s.label} className="h-4 w-4 rounded-full"  loading="lazy" decoding="async" />
                  <p className="nv-eyebrow">{s.label}</p>
                </div>
                <p className="nv-stat-num">
                  {Number(s.value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </SpotlightHero>
  );
};

export default MiningPage;
