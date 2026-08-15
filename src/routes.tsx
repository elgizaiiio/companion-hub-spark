import { lazy } from "react";

/**
 * Route loaders kept in one place so we can both lazily render them and
 * prefetch their chunk on user intent (hover / touchstart on a nav link).
 */
export const routeLoaders: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/MiningPage"),
  "/war": () => import("@/pages/WarPage"),
  "/tasks": () => import("@/pages/TasksPage"),
  "/servers": () => import("@/pages/ServersPage"),
  "/wallet": () => import("@/pages/WalletPage"),
  "/staking": () => import("@/pages/StakingPage"),
  "/101": () => import("@/pages/AdminPage"),
  "/attack-shop": () => import("@/pages/AttackShopPage"),
};

const prefetched = new Set<string>();

export function prefetchRoute(path: string) {
  if (prefetched.has(path)) return;
  const loader = routeLoaders[path];
  if (!loader) return;
  prefetched.add(path);
  void loader();
}

/** Warm the most likely next routes once the app is idle. */
export function prefetchIdleRoutes(paths: string[]) {
  const run = () => paths.forEach(prefetchRoute);
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(run);
  else setTimeout(run, 1500);
}

export const MiningPage = lazy(() => import("@/pages/MiningPage"));
export const WarPage = lazy(() => import("@/pages/WarPage"));
export const TasksPage = lazy(() => import("@/pages/TasksPage"));
export const ServersPage = lazy(() => import("@/pages/ServersPage"));
export const WalletPage = lazy(() => import("@/pages/WalletPage"));
export const StakingPage = lazy(() => import("@/pages/StakingPage"));
export const AdminPage = lazy(() => import("@/pages/AdminPage"));
export const AttackShopPage = lazy(() => import("@/pages/AttackShopPage"));
export const NotFound = lazy(() => import("@/pages/NotFound"));
