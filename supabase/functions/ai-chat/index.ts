import { admin, corsHeaders, json, loadSubscription, sleep } from "../_shared/ai.ts";

const MANUS_BASE = "https://api.manus.ai/v1";

const CHAT_MODEL = "manus-1.6";
const CODE_MODEL = "manus-max";

const SYSTEM: Record<string, string> = {
  chat: "You are a helpful, concise assistant inside a crypto mining mini app. Answer clearly.",
  code: "You are an expert software engineer. Return working code with short explanations. Use markdown code blocks.",
};

const callManus = async (key: string, model: string, prompt: string) => {
  const create = await fetch(`${MANUS_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-manus-api-key": key },
    body: JSON.stringify({ prompt, mode: "fast", model, hidden_in_task_list: true }),
  });

  const created = await create.json().catch(() => ({}));
  if (!create.ok) {
    throw new Error(created?.error?.message || created?.message || `Manus error ${create.status}`);
  }

  const taskId = created.task_id || created.id;
  if (!taskId) throw new Error("Manus did not return a task id");

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const res = await fetch(`${MANUS_BASE}/tasks/${taskId}`, {
      headers: { "x-manus-api-key": key },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `Manus error ${res.status}`);

    const status = data.status ?? data.state;
    if (status === "finished" || status === "completed" || status === "success") {
      const text =
        data.output ??
        data.result ??
        data.answer ??
        (Array.isArray(data.messages) ? data.messages.at(-1)?.content : null);
      return typeof text === "string" ? text : JSON.stringify(text ?? "", null, 2);
    }
    if (status === "failed" || status === "error" || status === "stopped") {
      throw new Error(data?.error || "Manus task failed");
    }
  }

  throw new Error("Manus task timed out");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("MANUS_API_KEY");
    if (!key) return json({ error: "MANUS_API_KEY is not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "code" ? "code" : "chat";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const profileId = typeof body.profileId === "string" ? body.profileId : null;

    const last = messages.filter((m: { role: string }) => m.role === "user").at(-1);
    const question = typeof last?.content === "string" ? last.content.trim() : "";
    if (!question) return json({ error: "Prompt is required" }, 400);
    if (question.length > 4000) return json({ error: "Prompt is too long" }, 400);

    if (profileId) {
      const db = admin();
      const sub = await loadSubscription(db, profileId);
      if (sub.plan === "free" && messages.length > 20) {
        return json({ error: "Free chat limit reached. Subscribe to continue." }, 402);
      }
    }

    const history = messages
      .slice(-8)
      .map((m: { role: string; content: string }) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const model = mode === "code" ? CODE_MODEL : CHAT_MODEL;
    const reply = await callManus(key, model, `${SYSTEM[mode]}\n\n${history}\n\nAssistant:`);

    return json({ reply, model });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
