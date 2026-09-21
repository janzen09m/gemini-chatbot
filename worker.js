export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Telegram Webhook (POST auf / oder /webhook)
    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/webhook")) {
      return handleTelegram(request, env);
    }

    // 2. Web-Chat API
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleWebChat(request, env);
    }

    // 3. Status API
    if (url.pathname === "/api/status") {
      return new Response(JSON.stringify({
        gemini: {
          hasKey: !!env.GEMINI_API_KEY,
          status: env.GEMINI_API_KEY ? "ok" : "missing",
          text: env.GEMINI_API_KEY ? "Bereit" : "Key fehlt"
        },
        telegram: {
          hasToken: !!env.TELEGRAM_BOT_TOKEN,
          isRunning: true,
          mode: "webhook"
        }
      }), {
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
    const token = env.TELEGRAM_BOT_TOKEN;
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
        const hasKey = !!env.GEMINI_API_KEY;
        await sendTelegram(token, chatId, hasKey ? "✅ Gemini API ist konfiguriert und einsatzbereit!" : "⚠️ GEMINI_API_KEY fehlt in den Cloudflare Worker Secrets.");
        return new Response("OK");
      }

      if (text.startsWith("/")) {
        return new Response("OK");
      }

      // Gemini aufrufen
      const reply = await callGemini(env.GEMINI_API_KEY, text);

      // An Telegram senden (Nachrichten bei >4000 Zeichen aufteilen)
      if (reply.length <= 4000) {
        await sendTelegram(token, chatId, reply);
      } else {
        for (let i = 0; i < reply.length; i += 4000) {
          await sendTelegram(token, chatId, reply.slice(i, i + 4000));
        }
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

    const reply = await callGemini(env.GEMINI_API_KEY, message);
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
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
    throw new Error(data.error?.message || "Fehler von der Gemini API");
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Keine Antwort von Gemini erhalten.";
}

async function sendTelegram(token, chatId, text, isMarkdown = false) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: isMarkdown ? "Markdown" : undefined
    })
  });
}
