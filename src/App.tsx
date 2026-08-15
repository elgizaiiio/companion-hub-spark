import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { AppProvider } from "@/context/AppContext";
import BottomNav from "@/components/BottomNav";
import PrizeModal from "@/components/PrizeModal";
import StarryBackground from "@/components/StarryBackground";
import { Suspense, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import PageTransition from "@/components/PageTransition";
import {
  MiningPage,
  WarPage,
  TasksPage,
  ServersPage,
  WalletPage,
  StakingPage,
  AdminPage,
  AttackShopPage,
  NotFound,
  prefetchIdleRoutes,
} from "@/routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Telegram back button handler
const TelegramBackButton = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    if (location.pathname !== "/") {
      tg.BackButton?.show();
      const handler = () => navigate(-1);
      tg.BackButton?.onClick(handler);
      return () => {
        tg.BackButton?.offClick(handler);
        tg.BackButton?.hide();
      };
    } else {
      tg.BackButton?.hide();
    }
  }, [location.pathname, navigate]);

  return null;
};

const RouteFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

const AnimatedRoutes = () => {
  const location = useLocation();

  useEffect(() => {
    prefetchIdleRoutes(["/", "/tasks", "/servers", "/wallet", "/staking"]);
  }, []);

  return (
    <Suspense fallback={<RouteFallback />}>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageTransition><MiningPage /></PageTransition>} />
          <Route path="/war" element={<PageTransition><WarPage /></PageTransition>} />
          <Route path="/tasks" element={<PageTransition><TasksPage /></PageTransition>} />
          <Route path="/servers" element={<PageTransition><ServersPage /></PageTransition>} />
          <Route path="/wallet" element={<PageTransition><WalletPage /></PageTransition>} />
          <Route path="/101" element={<PageTransition><AdminPage /></PageTransition>} />
          <Route path="/staking" element={<PageTransition><StakingPage /></PageTransition>} />
          <Route path="/attack-shop" element={<PageTransition><AttackShopPage /></PageTransition>} />
          <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
};

const App = () => (
  <TonConnectUIProvider manifestUrl="https://nova.megsyai.com/tonconnect-manifest.json">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner position="top-center" />
        <Toaster />

        <AppProvider>
          <BrowserRouter>
            <StarryBackground />
            <TelegramBackButton />
            <PrizeModal />
            <div className="max-w-lg mx-auto relative z-10">
              <AnimatedRoutes />
              <BottomNav />
            </div>
          </BrowserRouter>
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </TonConnectUIProvider>
);

export default App;
