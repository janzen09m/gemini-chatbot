async function checkStatus() {
  const geminiBadge = document.getElementById("gemini-status");
  const telegramBadge = document.getElementById("telegram-status");
  const tgLinkWrap = document.getElementById("telegram-link-wrap");
  const openTgBtn = document.getElementById("open-telegram-btn");

  try {
    const res = await fetch("/api/status");
    const data = await res.json();

    // Update Gemini Status Badge
    if (data.gemini?.status === "ok") {
      geminiBadge.className = "status-badge status-success";
      geminiBadge.innerHTML = '<span class="status-dot"></span><span class="status-text">Gemini: Bereit</span>';
    } else if (data.gemini?.status === "leaked") {
      geminiBadge.className = "status-badge status-error";
      geminiBadge.innerHTML = '<span class="status-dot"></span><span class="status-text">Gemini: Key gesperrt</span>';
    } else {
      geminiBadge.className = "status-badge status-warning";
      geminiBadge.innerHTML = '<span class="status-dot"></span><span class="status-text">Gemini: Key fehlt</span>';
    }

    // Update Telegram Status Badge
    if (data.telegram?.isRunning && data.telegram?.username) {
      telegramBadge.className = "status-badge status-success";
      telegramBadge.innerHTML = `<span class="status-dot"></span><span class="status-text">Telegram: @${data.telegram.username} aktiv</span>`;
      
      if (tgLinkWrap && openTgBtn) {
        openTgBtn.href = `https://t.me/${data.telegram.username}`;
        openTgBtn.textContent = `@${data.telegram.username} in Telegram öffnen`;
        tgLinkWrap.style.display = "block";
      }
    } else if (data.telegram?.isRunning || data.telegram?.hasToken) {
      telegramBadge.className = "status-badge status-success";
      telegramBadge.innerHTML = '<span class="status-dot"></span><span class="status-text">Telegram: Bot aktiv</span>';
    } else {
      telegramBadge.className = "status-badge status-warning";
      telegramBadge.innerHTML = '<span class="status-dot"></span><span class="status-text">Telegram: Token fehlt</span>';
      if (tgLinkWrap) tgLinkWrap.style.display = "none";
    }

  } catch (err) {
    console.warn("Status-Prüfung fehlgeschlagen:", err);
  }
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");
  const message = input.value.trim();
  if (!message) return;

  input.value = "";
  addMessage("Du", message, "user");

  if (sendBtn) sendBtn.disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json();
    const reply = data.reply || data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (reply) {
      addMessage("Gemini", reply, "bot");
    } else {
      addMessage("Gemini", "❌ Keine Antwort erhalten.", "bot");
    }

  } catch (err) {
    console.warn("Chat Fehler:", err);
    addMessage("Gemini", "❌ Server-Verbindungsfehler. Bitte Server prüfen.", "bot");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

function sendQuickPrompt(promptText) {
  const input = document.getElementById("userInput");
  if (input) {
    input.value = promptText;
    sendMessage();
  }
}

function addMessage(sender, text, className) {
  const messages = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = className;
  
  const senderStrong = document.createElement("strong");
  senderStrong.textContent = `${sender}: `;
  div.appendChild(senderStrong);

  const textNode = document.createTextNode(text);
  div.appendChild(textNode);

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// Initial setup
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("userInput");
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        sendMessage();
      }
    });
  }

  // Check initial status
  checkStatus();
  // Periodically refresh status every 15 seconds
  setInterval(checkStatus, 15000);
});
