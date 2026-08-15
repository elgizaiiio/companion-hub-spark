import type { TonConnectUI } from "@tonconnect/ui-react";

/** Single source of truth for the project treasury wallet. */
export const TREASURY_ADDRESS = "UQAp1QxnLJ2z44IooUovvtVShw7hJBEdxCRV3RlbCYC3D8qj";

/** Estimated fee shown in payment guidance. The connected wallet calculates the exact fee. */
export const TON_FEE_BUFFER = 0.05;

export type PaymentErrorCode =
  | "not_connected"
  | "wrong_network"
  | "invalid_amount"
  | "balance_unavailable"
  | "insufficient_funds"
  | "cancelled"
  | "failed";

export class PaymentError extends Error {
  code: PaymentErrorCode;
  constructor(code: PaymentErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PaymentError";
  }
}

const toNano = (amountTon: number) => {
  const [whole = "0", fraction = ""] = amountTon.toFixed(9).split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
};

/** Reads the on-chain balance (in Gram/TON) of an address. Returns null when unavailable. */
export const fetchTonBalance = async (address: string): Promise<number | null> => {
  if (!address) return null;
  const endpoints = [
    `https://tonapi.io/v2/accounts/${address}`,
    `https://toncenter.com/api/v2/getAddressInformation?address=${encodeURIComponent(address)}`,
  ];
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const json: any = await res.json();
      const raw = json?.balance ?? json?.result?.balance;
      if (raw === undefined || raw === null) continue;
      const nano = Number(raw);
      if (!Number.isFinite(nano)) continue;
      return nano / 1e9;
    } catch {
      /* try next endpoint */
    }
  }
  return null;
};

const isCancellation = (err: unknown) => {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("reject") ||
    msg.includes("cancel") ||
    msg.includes("declin") ||
    msg.includes("aborted") ||
    msg.includes("user")
  );
};

/**
 * Opens the wallet modal and resolves once the user is connected (or times out).
 * Without this the first tap on a pay button did nothing visible.
 */
const ensureConnected = async (tonConnectUI: TonConnectUI): Promise<boolean> => {
  if (tonConnectUI.connected) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      try { unsubscribe?.(); } catch { /* ignore */ }
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    unsubscribe = tonConnectUI.onStatusChange((wallet) => {
      if (wallet) done(true);
    });
    timer = setTimeout(() => done(tonConnectUI.connected), 120000);
    void tonConnectUI.openModal().catch(() => done(false));
    if (tonConnectUI.connected) done(true);
  });
};

/**
 * Sends Gram (TON) to the project treasury with pre-flight validation.
 * Throws a PaymentError with a specific code so callers can show accurate feedback.
 */
export const sendTonPayment = async (
  tonConnectUI: TonConnectUI,
  opts: { amountTon: number; comment?: string },
): Promise<{ boc: string }> => {
  const amountTon = Number(opts.amountTon);
  if (!Number.isFinite(amountTon) || amountTon <= 0) {
    throw new PaymentError("invalid_amount", "Enter a valid Gram amount");
  }

  const connected = await ensureConnected(tonConnectUI);
  if (!connected) {
    throw new PaymentError("not_connected", "Connect your wallet first");
  }

  const account = tonConnectUI.account;
  if (!account?.address) {
    throw new PaymentError("not_connected", "Reconnect your wallet and try again");
  }
  if (account.chain !== "-239") {
    throw new PaymentError("wrong_network", "Switch your wallet to TON Mainnet and try again");
  }

  // Send immediately through the connected wallet. Do not gate the transaction on a
  // third-party balance API: those endpoints can be unavailable or blocked by CORS,
  // which previously made valid deposits and NFT purchases fail before the wallet
  // was even opened. The wallet performs the authoritative balance/fee simulation.
  // Keep this as a plain transfer for maximum wallet compatibility.
  const message = {
    address: TREASURY_ADDRESS,
    amount: toNano(amountTon).toString(),
  };

  try {
    const result = await tonConnectUI.sendTransaction({
      network: "-239",
      from: account.address,
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [message],
    });
    if (!result?.boc) {
      throw new PaymentError("failed", "The wallet did not return a signed transaction. Please try again.");
    }
    return { boc: result.boc };
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    console.error("[ton] sendTransaction failed", err);
    if (isCancellation(err)) throw new PaymentError("cancelled", "Payment cancelled in your wallet");
    throw new PaymentError("failed", "The wallet could not process this transfer. Please try again.");
  }
};
