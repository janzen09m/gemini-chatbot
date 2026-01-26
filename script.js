const API_KEY = "DEIN_API_KEY_HIER";

async function sendMessage() {
  const input = document.getElementById("userInput");
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  addMessage("Du", message, "user");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=" + API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();
    console.log("API Antwort:", data); // 👈 SEHR WICHTIG

    if (!data.candidates) {
      addMessage("Bot", "❌ Fehler – keine Antwort von Gemini", "bot");
      return;
    }

    const botReply = data.candidates[0].content.parts[0].text;
    addMessage("Bot", botReply, "bot");

  } catch (err) {
    console.error(err);
    addMessage("Bot", "❌ API Fehler (siehe Konsole)", "bot");
  }
}

function addMessage(sender, text, className) {
  const messages = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = `<b>${sender}:</b> ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}
