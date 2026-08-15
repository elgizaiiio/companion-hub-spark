import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN_HELLO') || Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN_HELLO or TELEGRAM_BOT_TOKEN not configured');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

    const body = await req.json();

    const tg = async (method: string, payload: Record<string, unknown>) => {
      const r = await fetch(`${BASE_URL}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await r.json();
    };

    const isAdminUser = async (tgId: number) => {
      try {
        const { data } = await supabase.rpc('is_telegram_admin', { _telegram_id: tgId });
        return data === true;
      } catch {
        return false;
      }
    };

    const adminStats = async () => {
      const [users, tasks, tx] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('type', 'withdrawal').eq('status', 'pending'),
      ]);
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: newUsers } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);
      return {
        users: users.count ?? 0,
        newUsers: newUsers ?? 0,
        tasks: tasks.count ?? 0,
        pendingWithdrawals: tx.count ?? 0,
      };
    };

    // ---- Admin draft state (button-driven task builder) ----
    const getDraft = async (tgId: number) => {
      const { data } = await supabase
        .from('telegram_task_drafts')
        .select('draft')
        .eq('telegram_id', tgId)
        .limit(1);
      return (data?.[0]?.draft ?? null) as any;
    };
    const setDraft = async (tgId: number, value: any) => {
      const { error } = await supabase
        .from('telegram_task_drafts')
        .upsert({ telegram_id: tgId, draft: value }, { onConflict: 'telegram_id' });
      if (error) console.error('setDraft failed:', error.message);
    };
    const clearDraft = async (tgId: number) => {
      await supabase.from('telegram_task_drafts').delete().eq('telegram_id', tgId);
    };


    const adminPanelText = async () => {
      const s = await adminStats();
      return (
        `<b>Nova Admin Panel</b>\n\n` +
        `Total users: ${s.users}\n` +
        `New users (24h): ${s.newUsers}\n` +
        `Active Nova tasks: ${s.tasks}\n` +
        `Pending withdrawals: ${s.pendingWithdrawals}\n\n` +
        `Use the buttons below to manage Nova tasks.`
      );
    };

    const adminKeyboard = {
      inline_keyboard: [
        [{ text: 'Add Nova task', callback_data: 'adm_add' }],
        [{ text: 'Nova tasks', callback_data: 'adm_tasks' }],
        [{ text: 'Refresh stats', callback_data: 'adm_stats' }],
      ],
    };

    const listTasks = async () => {
      const { data } = await supabase
        .from('tasks')
        .select('id, title, reward_amount, reward_type, is_active')
        .order('created_at', { ascending: true });
      const rows = data ?? [];
      if (rows.length === 0) {
        return {
          text: '<b>Nova Tasks</b>\n\nNo tasks yet.',
          markup: { inline_keyboard: [[{ text: 'Add Nova task', callback_data: 'adm_add' }]] },
        };
      }
      const text = rows
        .map((t: any, i: number) => `${i + 1}. ${t.title} - ${t.reward_amount} ${String(t.reward_type).toUpperCase()}${t.is_active ? '' : ' (inactive)'}`)
        .join('\n');
      const markup = {
        inline_keyboard: [
          ...rows.slice(0, 20).map((t: any, i: number) => [
            { text: `Delete ${i + 1}`, callback_data: `adm_del:${t.id}` },
          ]),
          [{ text: 'Add Nova task', callback_data: 'adm_add' }],
        ],
      };
      return { text: `<b>Nova Tasks</b>\n\n${text}`, markup };
    };

    const cancelRow = [{ text: 'Cancel', callback_data: 'adm_cancel' }];

    const draftSummary = (d: any) =>
      `<b>New Nova Task</b>\n\n` +
      `Title: ${d.title || '-'}\n` +
      `Link: ${d.link || 'none'}\n` +
      `Reward: ${d.reward ?? '-'} ${(d.rewardType || '').toUpperCase()}`;

    const askStep = async (chat: number, d: any) => {
      if (d.step === 'title') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nSend the task title as a message.`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [cancelRow] },
        });
      }
      if (d.step === 'link') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nSend the task link, or tap "No link".`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'No link', callback_data: 'adm_link_none' }], cancelRow] },
        });
      }
      if (d.step === 'type') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nChoose the reward currency.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '$NOVA', callback_data: 'adm_type:siri' },
                { text: 'TON', callback_data: 'adm_type:ton' },
                { text: 'USDT', callback_data: 'adm_type:usdt' },
              ],
              cancelRow,
            ],
          },
        });
      }
      if (d.step === 'reward') {
        return tg('sendMessage', {
          chat_id: chat,
          text: `${draftSummary(d)}\n\nChoose the reward amount, or send a custom number.`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '0.1', callback_data: 'adm_rew:0.1' },
                { text: '0.5', callback_data: 'adm_rew:0.5' },
                { text: '1', callback_data: 'adm_rew:1' },
              ],
              [
                { text: '5', callback_data: 'adm_rew:5' },
                { text: '10', callback_data: 'adm_rew:10' },
                { text: '100', callback_data: 'adm_rew:100' },
              ],
              cancelRow,
            ],
          },
        });
      }
      return tg('sendMessage', {
        chat_id: chat,
        text: `${draftSummary(d)}\n\nSave this Nova task?`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Save task', callback_data: 'adm_save' }], cancelRow],
        },
      });
    };

    const saveDraft = async (chat: number, tgId: number, d: any) => {
      const { error } = await supabase.from('tasks').insert({
        title: d.title,
        link: d.link || null,
        reward_amount: Number(d.reward) || 0,
        reward_type: d.rewardType || 'siri',
        task_type: d.link ? 'link' : 'custom',
        verification_type: 'auto',
        is_active: true,
      });
      await clearDraft(tgId);
      await tg('sendMessage', {
        chat_id: chat,
        text: error ? `Failed: ${error.message}` : `Nova task added: ${d.title} - ${d.reward} ${String(d.rewardType).toUpperCase()}`,
        reply_markup: adminKeyboard,
      });
    };

    // Admin inline buttons
    if (body.callback_query) {
      const cq = body.callback_query;
      const cqChat = cq.message?.chat?.id;
      const cqUser = cq.from?.id;
      const data: string = cq.data || '';
      if (cqChat && cqUser && (await isAdminUser(cqUser))) {
        if (data === 'adm_stats') {
          await tg('sendMessage', { chat_id: cqChat, text: await adminPanelText(), parse_mode: 'HTML', reply_markup: adminKeyboard });
        } else if (data === 'adm_tasks') {
          const l = await listTasks();
          await tg('sendMessage', { chat_id: cqChat, text: l.text, parse_mode: 'HTML', reply_markup: l.markup });
        } else if (data === 'adm_add') {
          const d = { step: 'title', title: '', link: '', rewardType: '', reward: null };
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data === 'adm_cancel') {
          await clearDraft(cqUser);
          await tg('sendMessage', { chat_id: cqChat, text: 'Cancelled.', reply_markup: adminKeyboard });
        } else if (data === 'adm_link_none') {
          const d = (await getDraft(cqUser)) || {};
          d.link = '';
          d.step = 'type';
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data.startsWith('adm_type:')) {
          const d = (await getDraft(cqUser)) || {};
          d.rewardType = data.slice(9);
          d.step = 'reward';
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data.startsWith('adm_rew:')) {
          const d = (await getDraft(cqUser)) || {};
          d.reward = Number(data.slice(8));
          d.step = 'confirm';
          await setDraft(cqUser, d);
          await askStep(cqChat, d);
        } else if (data === 'adm_save') {
          const d = await getDraft(cqUser);
          if (d?.title) await saveDraft(cqChat, cqUser, d);
          else await tg('sendMessage', { chat_id: cqChat, text: 'Draft expired.', reply_markup: adminKeyboard });
        } else if (data.startsWith('adm_del:')) {
          const id = data.slice(8);
          const { error } = await supabase.from('tasks').delete().eq('id', id);
          await tg('sendMessage', { chat_id: cqChat, text: error ? `Delete failed: ${error.message}` : 'Nova task deleted.', reply_markup: adminKeyboard });
        }
      }
      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.update_id) {
      const message = body.message;
      if (!message) {
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const chatId = message.chat?.id;
      const userId = message.from?.id;
      const firstName = message.from?.first_name || 'Player';

      if (!chatId || !userId) {
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const text: string = message.text || '';

      // Admin panel entry
      if (/^\/101\b/.test(text)) {
        if (!(await isAdminUser(userId))) {
          await tg('sendMessage', { chat_id: chatId, text: 'Access denied.' });
        } else {
          await clearDraft(userId);
          await tg('sendMessage', { chat_id: chatId, text: await adminPanelText(), parse_mode: 'HTML', reply_markup: adminKeyboard });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Button-driven task builder: capture free text for the active draft step
      if (text && !text.startsWith('/') && (await isAdminUser(userId))) {
        const d = await getDraft(userId);
        if (d) {
          if (d.step === 'title') {
            d.title = text.trim();
            d.step = 'link';
          } else if (d.step === 'link') {
            d.link = text.trim();
            d.step = 'type';
          } else if (d.step === 'reward') {
            const n = Number(text.trim());
            if (!Number.isFinite(n)) {
              await tg('sendMessage', { chat_id: chatId, text: 'Send a valid number.' });
              return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            d.reward = n;
            d.step = 'confirm';
          }
          await setDraft(userId, d);
          await askStep(chatId, d);
          return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }



      if (message.text?.startsWith('/start')) {
        const lastName = message.from?.last_name || '';
        const username = message.from?.username || '';
        const parts = message.text.split(' ');
        const referralCode = parts.length > 1 ? parts[1] : null;

        // Register user - always try, handle duplicates gracefully
        try {
          const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('telegram_id', userId)
            .limit(1);

          if (!existing || existing.length === 0) {
            const newReferralCode = `SIRI${userId}${Date.now().toString(36)}`.toUpperCase();
            
            // Build deterministic UUID from telegram ID
            const hex = Math.abs(Math.trunc(userId)).toString(16).padStart(32, '0').slice(-32);
            const scopedUserId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
            
            let referredBy = null;
            if (referralCode) {
              const { data: referrer } = await supabase
                .from('profiles')
                .select('id')
                .eq('referral_code', referralCode)
                .limit(1);
              if (referrer && referrer.length > 0) referredBy = referrer[0].id;
            }

            const { error: insertError } = await supabase.from('profiles').insert({
              telegram_id: userId,
              first_name: firstName,
              last_name: lastName,
              username: username,
              referral_code: newReferralCode,
              referred_by: referredBy,
              user_id: scopedUserId,
            });

            if (insertError && insertError.code !== '23505') {
              console.error("Profile insert error:", insertError);
            }
          }
        } catch (regError) {
          console.error("Registration error:", regError);
          // Don't block the welcome message
        }

        // Get welcome image from admin config (falls back to default Nova banner)
        const DEFAULT_WELCOME_IMAGE = 'https://ltgampdtawuefwwayncx.supabase.co/storage/v1/object/public/user-images/nova/welcome-start.jpg';
        let welcomeImageUrl = DEFAULT_WELCOME_IMAGE;
        try {
          const { data: adminConfig } = await supabase
            .from('telegram_admins')
            .select('welcome_image_url')
            .not('welcome_image_url', 'is', null)
            .neq('welcome_image_url', '')
            .limit(1);
          welcomeImageUrl = adminConfig?.[0]?.welcome_image_url || DEFAULT_WELCOME_IMAGE;
        } catch (e) {
          console.error("Failed to get welcome image:", e);
        }

        const welcomeText = `<b>Welcome to Nova</b>\n\nMine $NOVA, TON, and USDT every eight hours. Upgrade your mining capacity. Invite friends. Earn more. Simple. Powerful. Rewarding. Start today .`;


        const welcomeMarkup = {
          inline_keyboard: [
            [{ text: 'Open Nova AI', url: 'https://t.me/Noveaibot/App' }],
            [{ text: 'Join Community', url: 'https://t.me/noveall' }],
          ]
        };


        try {
          if (welcomeImageUrl) {
            await fetch(`${BASE_URL}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                photo: welcomeImageUrl,
                caption: welcomeText,
                parse_mode: 'HTML',
                reply_markup: welcomeMarkup,
              }),
            });
          } else {
            await fetch(`${BASE_URL}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: welcomeText,
                parse_mode: 'HTML',
                reply_markup: welcomeMarkup,
              }),
            });
          }
        } catch (sendError) {
          console.error("Failed to send welcome:", sendError);
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const { action, chat_id, text, parse_mode } = body;

    let result;
    switch (action) {
      case 'sendMessage': {
        const response = await fetch(`${BASE_URL}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: parse_mode || 'HTML' }),
        });
        result = await response.json();
        break;
      }
      case 'setWebhook': {
        const webhookUrl = body.webhook_url;
        const response = await fetch(`${BASE_URL}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl }),
        });
        result = await response.json();
        break;
      }
      case 'getMe': {
        const response = await fetch(`${BASE_URL}/getMe`);
        result = await response.json();
        break;
      }
      case 'verifyTonTransaction': {
        const expectedAmount = Number(body.expected_amount_ton);
        if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || !body.boc) {
          result = { verified: false, error: 'Invalid verification request' };
          break;
        }

        const expectedNano = BigInt(Math.round(expectedAmount * 1e9));
        const minNano = (expectedNano * 99n) / 100n;
        const maxNano = (expectedNano * 101n) / 100n;
        const treasury = 'UQAp1QxnLJ2z44IooUovvtVShw7hJBEdxCRV3RlbCYC3D8qj';
        let matched: any = null;

        for (let attempt = 0; attempt < 10 && !matched; attempt++) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
          const response = await fetch(
            `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(treasury)}&limit=20`,
            { headers: { Accept: 'application/json' } },
          );
          if (!response.ok) continue;
          const payload = await response.json();
          const now = Math.floor(Date.now() / 1000);
          matched = (payload?.result ?? []).find((transaction: any) => {
            if (now - Number(transaction?.utime ?? 0) > 120) return false;
            const value = BigInt(transaction?.in_msg?.value ?? '0');
            return value >= minNano && value <= maxNano;
          });
        }

        result = matched
          ? {
              verified: true,
              tx_hash: matched.transaction_id?.hash ?? '',
              amount_nano: matched.in_msg?.value ?? '0',
            }
          : { verified: false, error: 'Transaction not found on-chain' };
        break;
      }
      case 'prizeBroadcast': {
        const PRIZE_IMAGE =
          'https://f7ebd660-aa64-45d5-8e89-2003f4b0bb3e.lovableproject.com/__l5e/assets-v1/d72c7d9e-0f0d-4e37-b64c-e43ce02b4b8e/prize-banner-monthly.jpg';
        // Rotating captions so the recurring broadcast never repeats itself.
        const CAPTIONS = [
          'Good news: the issue is fixed ✅\n\nThere was a technical error that stopped some players from seeing their reward. It has been fixed, and you can now claim your prize.\n\nYour Monthly Prize: $10,000 USDT\nBrought to you by the Nova × Google × Alibaba partnership.\n\nYou have a 72 hour window to claim it.',
          'Your $10,000 Monthly Prize is ready 🎉\n\nCelebrating the new partnership between Nova, Google and Alibaba.\nThe earlier display error is fixed for every player, old and new.\n\nOpen the app and withdraw before the 72 hour countdown ends.',
          'Reminder: $10,000 USDT is waiting for you 💚\n\nThe Nova × Google × Alibaba Monthly Prize has been credited to your balance.\nUnclaimed rewards are removed automatically when the countdown hits zero.\n\nTap below to claim yours now.',
          'Final stretch ⏳\n\nYour Monthly Prize of $10,000 USDT — powered by the Nova, Google and Alibaba partnership — is still unclaimed.\nEverything works correctly now, so nothing stands between you and your reward.\n\nClaim it inside the app today.',
        ];
        const CAPTION =
          typeof body.caption === 'string' && body.caption.trim()
            ? body.caption
            : CAPTIONS[
                typeof body.variant === 'number'
                  ? Math.abs(Math.floor(body.variant)) % CAPTIONS.length
                  : Math.floor(Date.now() / (4 * 60 * 60 * 1000)) % CAPTIONS.length
              ];
        const APP_URL = 'https://t.me/Noveaibot/App';
        const markup = { inline_keyboard: [[{ text: 'Claim $10,000 Prize', url: APP_URL }]] };

        let targets: number[] = [];
        if (body.telegram_id) {
          targets = [Number(body.telegram_id)];
        } else {
          const limit = Math.min(Number(body.limit ?? 500), 1000);
          const startAfter = Number(body.start_after ?? 0);
          const { data, error } = await supabase
            .from('profiles')
            .select('telegram_id')
            .not('telegram_id', 'is', null)
            .gt('telegram_id', startAfter)
            .order('telegram_id', { ascending: true })
            .limit(limit);
          if (error) throw new Error(error.message);
          targets = (data ?? [])
            .map((p: { telegram_id: number | string }) => Number(p.telegram_id))
            .filter((n: number) => Number.isFinite(n));
        }

        let sent = 0;
        const failures: { chat_id: number; error: string }[] = [];
        for (const chatId of targets) {
          try {
            const r = await tg('sendPhoto', {
              chat_id: chatId,
              photo: PRIZE_IMAGE,
              caption: CAPTION,
              reply_markup: markup,
            });
            if (r?.ok) sent++;
            else failures.push({ chat_id: chatId, error: r?.description ?? 'unknown error' });
          } catch (e) {
            failures.push({ chat_id: chatId, error: String(e) });
          }
          if ((sent + failures.length) % 25 === 0) await new Promise((r) => setTimeout(r, 800));
        }

        result = {
          ok: true,
          sent,
          total: targets.length,
          last_id: targets.length ? targets[targets.length - 1] : null,
          failures: failures.slice(0, 5),
        };

        // Self-chain to the next page so one trigger covers every user.
        if (body.chain && !body.telegram_id && targets.length > 0) {
          const nextAfter = targets[targets.length - 1];
          try {
            void fetch(`${SUPABASE_URL}/functions/v1/telegram-bot`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                apikey: SUPABASE_SERVICE_ROLE_KEY,
              },
              body: JSON.stringify({
                action: 'prizeBroadcast',
                chain: true,
                limit: body.limit ?? 500,
                start_after: nextAfter,
                caption: CAPTION,
              }),
            });
            await new Promise((r) => setTimeout(r, 500));
          } catch (e) {
            console.error('chain failed', e);
          }
        }
        break;
      }
      default:
        result = { ok: false, error: 'Unknown action' };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Telegram bot error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
