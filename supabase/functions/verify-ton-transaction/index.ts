import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXPECTED_WALLET = "UQAp1QxnLJ2z44IooUovvtVShw7hJBEdxCRV3RlbCYC3D8qj";
const TONCENTER_V2 = "https://toncenter.com/api/v2";

// Convert user-friendly address to raw format for comparison
// We'll compare amounts on recent incoming transactions instead

async function getRecentTransactions(address: string, limit = 20): Promise<any[]> {
  const url = `${TONCENTER_V2}/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("TONCenter error:", res.status, text);
    return [];
  }
  const json = await res.json();
  if (!json.ok || !json.result) return [];
  return json.result;
}

function findMatchingTransaction(
  transactions: any[],
  expectedAmountNano: bigint,
  maxAgeSeconds: number
): any | null {
  const now = Math.floor(Date.now() / 1000);

  for (const tx of transactions) {
    const txTime = tx.utime || 0;
    const age = now - txTime;

    // Only check transactions within the time window
    if (age > maxAgeSeconds) continue;

    // Check incoming messages (in_msg)
    const inMsg = tx.in_msg;
    if (!inMsg) continue;

    const value = BigInt(inMsg.value || "0");

    // Allow 1% tolerance for fees
    const minAmount = (expectedAmountNano * 99n) / 100n;
    const maxAmount = (expectedAmountNano * 101n) / 100n;

    if (value >= minAmount && value <= maxAmount) {
      return tx;
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { expected_amount_ton, boc } = await req.json();

    if (!expected_amount_ton || expected_amount_ton <= 0) {
      return new Response(
        JSON.stringify({ verified: false, error: "Missing or invalid expected_amount_ton" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!boc) {
      return new Response(
        JSON.stringify({ verified: false, error: "Missing BOC" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const expectedAmountNano = BigInt(Math.round(expected_amount_ton * 1e9));

    // Poll TONCenter for up to 30 seconds to find the transaction
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 3000;
    const MAX_AGE_SECONDS = 120; // Look at transactions from last 2 minutes

    let matchedTx: any = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }

      console.log(`Verification attempt ${attempt + 1}/${MAX_RETRIES} for ${expected_amount_ton} TON`);

      const transactions = await getRecentTransactions(EXPECTED_WALLET);

      matchedTx = findMatchingTransaction(transactions, expectedAmountNano, MAX_AGE_SECONDS);

      if (matchedTx) {
        console.log("Transaction verified on-chain:", JSON.stringify({
          hash: matchedTx.transaction_id?.hash,
          value: matchedTx.in_msg?.value,
          time: matchedTx.utime,
        }));
        break;
      }
    }

    if (!matchedTx) {
      console.error("Verification FAILED: no matching transaction found after all retries");
      return new Response(
        JSON.stringify({ verified: false, error: "Transaction not found on-chain" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        verified: true,
        tx_hash: matchedTx.transaction_id?.hash || "",
        amount_nano: matchedTx.in_msg?.value || "0",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Verification error:", error);
    return new Response(
      JSON.stringify({ verified: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
