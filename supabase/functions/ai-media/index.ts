import { admin, corsHeaders, json, loadSubscription, sleep } from "../_shared/ai.ts";

const DEAPI_BASE = "https://api.deapi.ai/v1";

const PREMIUM_MODELS = new Set(["hd", "cinematic", "video-hd", "video-cinematic"]);

const MODEL_MAP: Record<string, string> = {
  standard: "flux-schnell",
  hd: "flux-pro",
  cinematic: "flux-ultra",
  "video-lite": "kling-lite",
  "video-hd": "kling-pro",
  "video-cinematic": "veo-3",
};

const extractUrl = (data: Record<string, unknown>): string | null => {
  const d = data as any;
  return (
    d?.data?.[0]?.url ??
    d?.output?.[0] ??
    d?.output?.url ??
    d?.result?.url ??
    d?.url ??
    d?.video?.url ??
    null
  );
};

const runDeapi = async (key: string, kind: "image" | "video", model: string, prompt: string) => {
  const endpoint = kind === "image" ? "/images/generations" : "/videos/generations";
  const res = await fetch(`${DEAPI_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      ...(kind === "image" ? { size: "1024x1024" } : { duration: 5, aspect_ratio: "9:16" }),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `DeAPI error ${res.status}`);

  const direct = extractUrl(data);
  if (direct) return direct;

  const jobId = (data as any).id ?? (data as any).job_id ?? (data as any).task_id;
  if (!jobId) throw new Error("DeAPI did not return a result");

  for (let i = 0; i < 90; i++) {
    await sleep(2500);
    const poll = await fetch(`${DEAPI_BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const pd = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(pd?.message || `DeAPI error ${poll.status}`);

    const status = (pd as any).status ?? (pd as any).state;
    const url = extractUrl(pd);
    if (url) return url;
    if (status === "failed" || status === "error") throw new Error((pd as any).error || "Generation failed");
  }

  throw new Error("Generation timed out");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("DEAPI_API_KEY");
    if (!key) return json({ error: "DEAPI_API_KEY is not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const kind: "image" | "video" = body.kind === "video" ? "video" : "image";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const modelId = typeof body.model === "string" ? body.model : "standard";
    const profileId = typeof body.profileId === "string" ? body.profileId : null;

    if (!prompt) return json({ error: "Prompt is required" }, 400);
    if (prompt.length > 1500) return json({ error: "Prompt is too long" }, 400);
    if (!MODEL_MAP[modelId]) return json({ error: "Unknown model" }, 400);
    if (!profileId) return json({ error: "Missing profile" }, 400);

    const db = admin();
    const sub = await loadSubscription(db, profileId);

    if (PREMIUM_MODELS.has(modelId) && sub.plan === "free") {
      return json({ error: "This model is available on paid plans only." }, 402);
    }

    const used = kind === "image" ? sub.images_used : sub.videos_used;
    const limit = kind === "image" ? sub.images_limit : sub.videos_limit;
    if (limit !== null && used >= limit) {
      return json({ error: `You reached your monthly ${kind} limit. Upgrade your plan.` }, 402);
    }

    const url = await runDeapi(key, kind, MODEL_MAP[modelId], prompt);

    await db.from("ai_generations").insert({
      profile_id: profileId,
      kind,
      model: modelId,
      prompt,
      url,
    });

    await db
      .from("ai_subscriptions")
      .upsert(
        {
          profile_id: profileId,
          images_used: sub.images_used + (kind === "image" ? 1 : 0),
          videos_used: sub.videos_used + (kind === "video" ? 1 : 0),
        },
        { onConflict: "profile_id" },
      );

    return json({ url, kind, model: modelId, created_at: new Date().toISOString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
