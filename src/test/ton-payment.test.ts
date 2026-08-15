import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTonPayment, TREASURY_ADDRESS } from "@/lib/ton";

const makeTonConnect = (balanceNano: string) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ balance: balanceNano }),
  }));

  return {
    connected: true,
    account: { address: "0:sender", chain: "-239" },
    sendTransaction: vi.fn().mockResolvedValue({ boc: "signed-boc" }),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TON treasury payments", () => {
  it("opens wallet confirmation without relying on a third-party balance API", async () => {
    const tonConnect = makeTonConnect("0");

    await expect(sendTonPayment(tonConnect as never, { amountTon: 5 })).resolves.toEqual({
      boc: "signed-boc",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(tonConnect.sendTransaction).toHaveBeenCalledOnce();
  });

  it("sends a plain mainnet transfer only to the treasury", async () => {
    const tonConnect = makeTonConnect("10000000000");

    await expect(sendTonPayment(tonConnect as never, { amountTon: 5, comment: "ignored safely" })).resolves.toEqual({
      boc: "signed-boc",
    });
    expect(tonConnect.sendTransaction).toHaveBeenCalledWith({
      network: "-239",
      from: "0:sender",
      validUntil: expect.any(Number),
      messages: [{ address: TREASURY_ADDRESS, amount: "5000000000" }],
    });
  });

  it("blocks testnet wallets before requesting a transfer", async () => {
    const tonConnect = makeTonConnect("10000000000");
    tonConnect.account.chain = "-3";

    await expect(sendTonPayment(tonConnect as never, { amountTon: 5 })).rejects.toMatchObject({
      code: "wrong_network",
    });
    expect(tonConnect.sendTransaction).not.toHaveBeenCalled();
  });

  it("still opens the wallet when balance providers are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const tonConnect = {
      connected: true,
      account: { address: "0:sender", chain: "-239" },
      sendTransaction: vi.fn().mockResolvedValue({ boc: "signed-boc" }),
    };

    await expect(sendTonPayment(tonConnect as never, { amountTon: 5 })).resolves.toEqual({
      boc: "signed-boc",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(tonConnect.sendTransaction).toHaveBeenCalledOnce();
  });
});