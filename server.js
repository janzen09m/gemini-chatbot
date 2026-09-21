import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { Bot } from "grammy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Known leaked API key from old GitHub commit
const LEAKED_GITHUB_KEY = "AIzaSyBVdOUZ5ErCUhr8ezyfTcsP7egkxKRmrac";

let aiClient = null;
let cachedKey = null;

function getGeminiStatus() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { status: "missing", text: "Nicht konfiguriert" };
  if (key === LEAKED_GITHUB_KEY) return { status: "leaked", text: "Gesperrter GitHub-Schlüssel" };
  return { status: "ok", text: "Bereit" };
}

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === LEAKED_GITHUB_KEY) {
    return null;
  }
  if (!aiClient || cachedKey !== apiKey) {
    cachedKey = apiKey;
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// Generate Gemini reply
async function askGemini(prompt) {
  const ai = getAIClient();
  if (!ai) {
    const status = getGeminiStatus();
    if (status.status === "leaked") {
      throw new Error("Der Gemini API-Schlüssel wurde von Google gesperrt (auf GitHub geleakt). Bitte erstelle einen neuen Schlüssel auf https://aistudio.google.com/apikey und trage ihn in .env ein.");
    }
    throw new Error("Kein Gemini API-Schlüssel konfiguriert. Bitte GEMINI_API_KEY in .env eintragen.");
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: prompt
  });

  return response.text || "Keine Antwort erhalten.";
}

// State for Telegram Bot
let telegramBot = null;
let telegramBotInfo = null;
let telegramError = null;

function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !token.trim()) {
    console.log("Telegram Bot Token nicht gesetzt. Web-Interface läuft normal.");
    telegramBot = null;
    telegramBotInfo = null;
    telegramError = "Kein Token in .env hinterlegt";
    return;
  }

  try {
    telegramBot = new Bot(token.trim());

    // /start command
    telegramBot.command("start", async (ctx) => {
      await ctx.reply(
        "👋 Hallo! Ich bin dein kostenloser Gemini KI Bot auf Telegram.\n\n" +
        "Schreibe mir einfach eine Nachricht oder Frage, und ich antworte dir mit Google Gemini!\n\n" +
        "Befehle:\n" +
        "/help - Hilfe & Infos\n" +
        "/status - Status der KI-Verbindung prüfen"
      );
    });

    // /help command
    telegramBot.command("help", async (ctx) => {
      await ctx.reply(
        "💡 *Hilfe & Funktionen:*\n\n" +
        "• Schreibe mir einfach eine beliebige Frage, Aufgabe oder Text.\n" +
        "• Ich nutze die kostenlose Google Gemini 2.5/3.8 Flash KI für blitzschnelle Antworten.\n" +
        "• Befehl /status zeigt an, ob der Google API Schlüssel aktiv ist.",
        { parse_mode: "Markdown" }
      );
    });

    // /status command
    telegramBot.command("status", async (ctx) => {
      const gStatus = getGeminiStatus();
      if (gStatus.status === "ok") {
        await ctx.reply("✅ Gemini KI ist verbunden und bereit!");
      } else {
        await ctx.reply(`⚠️ Gemini KI Problem: ${gStatus.text}. Bitte prüfe die .env Datei auf dem Server.`);
      }
    });

    // Handle incoming text messages
    telegramBot.on("message:text", async (ctx) => {
      const userMessage = ctx.message.text;
      if (userMessage.startsWith("/")) return; // Ignore unhandled commands

      try {
        await ctx.replyWithChatAction("typing");
        const reply = await askGemini(userMessage);

        // Telegram message limit is 4096 characters. Split if needed.
        if (reply.length <= 4000) {
          await ctx.reply(reply);
        } else {
          for (let i = 0; i < reply.length; i += 4000) {
            await ctx.reply(reply.slice(i, i + 4000));
          }
        }
      } catch (err) {
        console.warn("Fehler bei Telegram-Anfrage:", err.message);
        await ctx.reply(`❌ Fehler: ${err.message}`);
      }
    });

    telegramBot.catch((err) => {
      console.warn("Telegram Bot Fehler:", err.message);
      telegramError = err.message;
    });

    // Start long polling
    telegramBot.start({
      onStart: (info) => {
        telegramBotInfo = info;
        telegramError = null;
        console.log(`Telegram Bot erfolgreich gestartet als @${info.username}`);
      }
    }).catch((err) => {
      console.warn("Telegram Start Fehler:", err.message);
      telegramError = err.message;
    });

  } catch (err) {
    console.warn("Telegram Initialisierungsfehler:", err.message);
    telegramError = err.message;
  }
}

// Initialize Telegram bot
initTelegramBot();

// API endpoint for status
app.get("/api/status", (req, res) => {
  const gemini = getGeminiStatus();
  res.json({
    gemini: {
      status: gemini.status,
      text: gemini.text,
      hasKey: !!process.env.GEMINI_API_KEY
    },
    telegram: {
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      isRunning: !!telegramBotInfo,
      username: telegramBotInfo ? telegramBotInfo.username : null,
      firstName: telegramBotInfo ? telegramBotInfo.first_name : null,
      error: telegramError
    }
  });
});

// API endpoint for web chat
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Nachricht darf nicht leer sein" });
    }

    const reply = await askGemini(message.trim());
    res.json({
      reply,
      candidates: [{ content: { parts: [{ text: reply }] } }]
    });
  } catch (err) {
    console.warn("Chat Fehler:", err.message);
    res.status(200).json({
      reply: `⚠️ ${err.message}`,
      candidates: [{ content: { parts: [{ text: `⚠️ ${err.message}` }] } }]
    });
  }
});

// Serve static assets
app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf http://0.0.0.0:${PORT}`);
});
