import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialize Gemini API client to prevent crashes if key is missing on startup
let aiClient = null;
function getAIClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY Umgebungsvariable ist nicht gesetzt. Bitte konfigurieren Sie Ihren API-Schlüssel in den Einstellungen.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// Server-side endpoint for Gemini chat requests
app.post("/api/chat", async (req, res) => {
  try {
    const { message, contents } = req.body;

    let prompt = "";
    if (typeof message === "string" && message.trim()) {
      prompt = message.trim();
    } else if (Array.isArray(contents) && contents.length > 0) {
      const last = contents[contents.length - 1];
      if (last?.parts?.length > 0) {
        prompt = last.parts.map((p) => p.text).filter(Boolean).join("\n");
      }
    }

    if (!prompt) {
      return res.status(400).json({
        error: "Keine Nachricht übermittelt",
        candidates: null
      });
    }

    const ai = getAIClient();
    
    // Use gemini-3.8-flash or gemini-2.5-flash
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt
    });

    const replyText = response.text || "";

    res.json({
      candidates: [
        {
          content: {
            parts: [{ text: replyText }]
          }
        }
      ]
    });
  } catch (err) {
    console.error("Gemini API Error:", err);
    res.status(500).json({
      error: err.message || "Fehler bei der Kommunikation mit Gemini",
      candidates: null
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
