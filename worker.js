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
        } catch (e) {
          // ignore
        }
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

    // 4. Webhook Setup & Info API (1-Klick Aktivierung)
    if (url.pathname === "/api/setup-webhook") {
      const token = env.TELEGRAM_BOT_TOKEN?.trim();
      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN fehlt in Cloudflare Secrets" }), {
          headers: { "Content-Type": "application/json" },
          status: 400
        });
      }

      const webhookUrl = `${url.origin}/`;
      const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`);
      const setData = await setRes.json();

      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const infoData = await infoRes.json();

      return new Response(JSON.stringify({
        ok: setData.ok,
        message: setData.ok ? "Webhook erfolgreich aktiviert!" : "Fehler beim Setzen des Webhooks",
        webhookResult: setData,
        webhookInfo: infoData,
        registeredUrl: webhookUrl
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/api/webhook-info") {
      const token = env.TELEGRAM_BOT_TOKEN?.trim();
      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN fehlt" }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const infoData = await infoRes.json();
      return new Response(JSON.stringify(infoData, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Static Assets (Website)
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

      // Gemini aufrufen mit Tipp-Status und Fehler-Rückmeldung
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "typing" })
        });

        const reply = await callGemini(env.GEMINI_API_KEY?.trim(), text);

        // An Telegram senden (Nachrichten bei >4000 Zeichen aufteilen)
        if (reply.length <= 4000) {
          await sendTelegram(token, chatId, reply);
        } else {
          for (let i = 0; i < reply.length; i += 4000) {
            await sendTelegram(token, chatId, reply.slice(i, i + 4000));
          }
        }
      } catch (geminiErr) {
        console.error("Gemini Fehler:", geminiErr.message);
        await sendTelegram(token, chatId, `⚠️ Fehler bei Gemini: ${geminiErr.message}`);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Telegram Webhook Fehler:", err);
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
    throw new Error("GEMINI_API_KEY ist in Cloudflare Secrets nicht hinterlegt.");
  }
  if (apiKey === "AIzaSyBVdOUZ5ErCUhr8ezyfTcsP7egkxKRmrac") {
    throw new Error("Der hinterlegte Gemini-Schlüssel ist gesperrt. Bitte erstelle einen neuen Schlüssel auf Google AI Studio.");
  }

  // Model fallback list: if a model is experiencing high demand, try the next one
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
        // If high demand or overloaded or 503/429, try next model
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
        body: JSON.stringify({
          chat_id: chatId,
          text: text
        })
      });
    }
  } catch (err) {
    console.error("sendTelegram Error:", err);
  }
}
