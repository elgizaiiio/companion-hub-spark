import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COOLDOWN_HOURS = 6;
const APP_URL = "https://nova.megsyai.com";

const MESSAGES = [
  "⛏️ <b>{name}</b>, your Nova rig is idle!\nStart an 8-hour mining session now and earn <b>$NOVA + Gram + USDT</b>.",
  "🚀 <b>{name}</b>, mining stopped — every idle hour is lost rewards.\nTap below and restart your session in one click.",
  "💎 <b>{name}</b>, your last session finished!\nClaim the next one and keep your streak alive.",
  "🔥 <b>{name}</b>, upgrade your servers to boost daily <b>Gram</b> and <b>USDT</b> income — then start mining again!",
  "🌙 <b>{name}</b>, don't sleep on free rewards. Start mining now and wake up richer.",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN_HELLO") || Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!TOKEN) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowIso = new Date().toISOString();
  const cooldownIso = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString();

  // Players currently mining -> skip them
  const { data: active } = await supabase
    .from("mining_sessions")
    .select("user_id")
    .gt("ends_at", nowIso);
  const mining = new Set((active || []).map((r: any) => r.user_id));

  // Players reminded recently -> skip them
  const { data: recent } = await supabase
    .from("mining_reminders")
    .select("profile_id")
    .gt("last_sent_at", cooldownIso);
  const recentlySent = new Set((recent || []).map((r: any) => r.profile_id));

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, telegram_id, first_name")
    .eq("is_banned", false)
    .limit(2000);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const targets = (profiles || []).filter(
    (p: any) => p.telegram_id && !mining.has(p.id) && !recentlySent.has(p.id),
  );

  let sent = 0;
  let failed = 0;
  const CHUNK = 25;

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const okIds: string[] = [];

    await Promise.all(
      chunk.map(async (p: any) => {
        const text = MESSAGES[Math.floor(Math.random() * MESSAGES.length)].replace(
          /{name}/g,
          p.first_name || "Miner",
        );
        try {
          const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: p.telegram_id,
              text,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[{ text: "⛏️ Start Mining", url: APP_URL }]],
              },
            }),
          });
          const json = await res.json();
          if (json.ok) okIds.push(p.id);
          else failed++;
        } catch {
          failed++;
        }
      }),
    );

    if (okIds.length) {
      await supabase.from("mining_reminders").upsert(
        okIds.map((id) => ({ profile_id: id, last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })),
        { onConflict: "profile_id" },
      );
      sent += okIds.length;
    }

    if (i + CHUNK < targets.length) await new Promise((r) => setTimeout(r, 1100));
  }

  return new Response(JSON.stringify({ ok: true, candidates: targets.length, sent, failed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
