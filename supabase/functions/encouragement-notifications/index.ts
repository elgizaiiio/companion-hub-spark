import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MESSAGES = [
  "Hey {name}! Your mining rewards are waiting. Start a session now and earn $SIRI + Gram!",
  "Don't miss out, {name}! The battle arena is heating up. Defeat a monster and win Gram rewards!",
  "{name}, your servers are generating passive income while you sleep. Want to boost earnings? Upgrade now!",
  "Quick reminder {name}: Complete your daily tasks to earn free rewards. Easy $SIRI!",
  "{name}, top players are earning big today! Join the battle and claim your share of the Gram pool!",
  "Hey {name}! You have 3 free attacks daily. Use them before they reset!",
  "{name}, the monster's HP is getting low! One more hit could be the killing blow. Don't miss the Gram bonus!",
  "Your $SIRI balance is growing, {name}! Keep mining to maximize your earnings.",
  "{name}, invite friends and earn 50% commission on their purchases. Share your referral link now!",
  "New day, new opportunities {name}! Start mining, complete tasks, and battle monsters for maximum rewards.",
];

Deno.serve(async () => {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN_HELLO") || Deno.env.get("TELEGRAM_BOT_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!TELEGRAM_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN_HELLO (or TELEGRAM_BOT_TOKEN) not set" }), { status: 500 });
  }

  const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, telegram_id, first_name")
    .eq("is_banned", false);

  if (error || !profiles) {
    return new Response(JSON.stringify({ error: error?.message }), { status: 500 });
  }

  // Pick a random message template for this batch
  const template = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];

  let sent = 0;

  for (const profile of profiles) {
    const text = template.replace(/{name}/g, profile.first_name || "Player");

    try {
      await fetch(`${BASE_URL}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: profile.telegram_id,
          text,
          parse_mode: "HTML",
        }),
      });
      sent++;
    } catch {
      // skip failed sends
    }

    // Rate limit: 25 messages per second
    if (sent % 25 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }));
});
