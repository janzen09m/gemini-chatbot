export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Telegram Webhook (POST auf /, /webhook oder beliebigen Pfad außer /api/chat)
    if (request.method === "POST" && url.pathname !== "/api/chat") {
      return handleTelegram(request, env);
    }

    // 2. Web-Chat API
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleWebChat(request, env);
    }

    // 3. Status API
    if (url.pathname === "/api/status") {
      let botUsername = null;
      if (env.TELEGRAM_BOT_TOKEN) {
        try {
          const meRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN.trim()}/getMe`);
          const meData = await meRes.json();
          if (meData.ok && meData.result?.username) {
            botUsername = meData.result.username;
          }
        } catch (e) {}
      }

      return new Response(JSON.stringify({
        gemini: {
          hasKey: !!env.GEMINI_API_KEY,
          status: env.GEMINI_API_KEY ? "ok" : "missing",
          text: env.GEMINI_API_KEY ? "Bereit" : "Key fehlt"
        },
        telegram: {
          hasToken: !!env.TELEGRAM_BOT_TOKEN,
          isRunning: !!env.TELEGRAM_BOT_TOKEN,
          username: botUsername,
          mode: "webhook"
        }
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Webhook Setup API
    if (url.pathname === "/api/setup-webhook") {
      const token = env.TELEGRAM_BOT_TOKEN?.trim();
      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN fehlt" }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      const webhookUrl = `${url.origin}/`;
      const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`);
      const setData = await setRes.json();
      return new Response(JSON.stringify(setData, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 5. Static Assets (Website)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Gemini Telegram Bot auf Cloudflare Workers aktiv.", { status: 200 });
  }
};

async function handleTelegram(request, env) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) {
      return new Response("TELEGRAM_BOT_TOKEN fehlt", { status: 200 });
    }

    const update = await request.json();

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === "/start") {
        await sendTelegram(token, chatId, "👋 Hallo! Ich bin dein Gemini KI Bot auf Cloudflare.\n\nSchreib mir einfach eine Frage, und ich antworte dir kostenlos mit Google Gemini!");
        return new Response("OK");
      }

      if (text === "/help") {
        await sendTelegram(token, chatId, "💡 *Hilfe:*\n\nSchreibe mir eine beliebige Nachricht oder Frage. Ich antworte 24/7 über Cloudflare mit Google Gemini.", true);
        return new Response("OK");
      }

      if (text === "/status") {
        const hasKey = !!env.GEMINI_API_KEY?.trim();
        await sendTelegram(token, chatId, hasKey ? "✅ Gemini API ist konfiguriert und einsatzbereit!" : "⚠️ GEMINI_API_KEY fehlt in den Cloudflare Worker Secrets.");
        return new Response("OK");
      }

      if (text.startsWith("/")) {
        return new Response("OK");
      }

      // Tipp-Status senden
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "typing" })
        });

        const reply = await callGemini(env.GEMINI_API_KEY?.trim(), text);

        if (reply.length <= 4000) {
          await sendTelegram(token, chatId, reply);
        } else {
          for (let i = 0; i < reply.length; i += 4000) {
            await sendTelegram(token, chatId, reply.slice(i, i + 4000));
          }
        }
      } catch (geminiErr) {
        await sendTelegram(token, chatId, `⚠️ Gemini Hinweis: ${geminiErr.message}`);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    return new Response("OK", { status: 200 });
  }
}

async function handleWebChat(request, env) {
  try {
    const { message } = await request.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Nachricht fehlt" }), { status: 400 });
    }

    const reply = await callGemini(env.GEMINI_API_KEY?.trim(), message);
    return new Response(JSON.stringify({
      reply,
      candidates: [{ content: { parts: [{ text: reply }] } }]
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      reply: `⚠️ ${err.message}`,
      candidates: [{ content: { parts: [{ text: `⚠️ ${err.message}` }] } }]
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function callGemini(apiKey, prompt) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY fehlt in Cloudflare Secrets.");
  }

  // Automatischer Wechsel auf funktionierendes Modell bei Überlastung
  const candidateModels = [
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-3.6-flash"
  ];

  let lastError = null;
  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errMsg = data.error?.message || `HTTP ${res.status}`;
        lastError = new Error(errMsg);
        if (errMsg.includes("demand") || errMsg.includes("overloaded") || res.status === 503 || res.status === 429) {
          continue;
        }
        throw lastError;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Keine Antwort von Gemini erhalten.");
}

async function sendTelegram(token, chatId, text, isMarkdown = false) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: isMarkdown ? "Markdown" : undefined
      })
    });
    const data = await res.json();
    if (!data.ok && isMarkdown) {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text })
      });
    }
  } catch (e) {}
}
