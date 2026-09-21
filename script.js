async function sendMessage() {
  const input = document.getElementById("userInput");
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  addMessage("Du", message, "user");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json();
    console.log("API Antwort:", data);

    if (!response.ok || !data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      const errorMsg = data?.error ? `❌ ${data.error}` : "❌ Fehler – keine Antwort von Gemini";
      addMessage("Bot", errorMsg, "bot");
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

// Allow sending message with Enter key
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("userInput");
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        sendMessage();
      }
    });
  }
});
