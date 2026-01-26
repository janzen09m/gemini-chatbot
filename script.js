const API_KEY = "AIzaSyBVdOUZ5ErCUhr8ezyfTcsP7egkxKRmrac";

async function sendMessage() {
  const input = document.getElementById("userInput");
  const message = input.value;
  input.value = "";

  addMessage("Du", message, "user");

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + API_KEY,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: message }]
          }
        ]
      })
    }
  );

  const data = await response.json();
  const botReply = data.candidates[0].content.parts[0].text;

  addMessage("Bot", botReply, "bot");
}

function addMessage(sender, text, className) {
  const messages = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = `<b>${sender}:</b> ${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}
