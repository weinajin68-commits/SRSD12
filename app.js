let state = {
  me: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
};

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message) {
  $("#status-line").textContent = message;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 401) {
    window.location.href = "/login";
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function renderConversations() {
  const container = $("#conversation-list");
  container.innerHTML = "";

  if (state.conversations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No chats yet. Create a new tutoring conversation.";
    container.appendChild(empty);
    return;
  }

  for (const item of state.conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "conversation-item" +
      (item.id === state.activeConversationId ? " active" : "");
    button.innerHTML = `
      <span class="conversation-item-title">${escapeHtml(item.title)}</span>
      <span class="conversation-item-time">${new Date(item.updatedAt).toLocaleString()}</span>
    `;
    button.addEventListener("click", () => loadConversation(item.id));
    container.appendChild(button);
  }
}

function renderMessages() {
  const container = $("#messages");
  container.innerHTML = "";

  if (state.messages.length === 0) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "Start by saving the reading passage, then send a message such as: Please guide me step by step in simple English.";
    container.appendChild(hint);
    return;
  }

  for (const message of state.messages) {
    const div = document.createElement("div");
    div.className = `message ${message.role}`;
    const roleLabel = message.role === "assistant" ? "Tutor" : "Student";
    div.innerHTML = `
      <div class="message-role">${roleLabel}</div>
      <div class="message-bubble">${escapeHtml(message.content)}</div>
    `;
    container.appendChild(div);
  }

  container.scrollTop = container.scrollHeight;
}

function currentConversation() {
  return state.conversations.find((item) => item.id === state.activeConversationId) || null;
}

async function bootstrap() {
  const data = await request("/api/me");
  if (!data) {
    return;
  }
  state.me = data.user;
  $("#username-chip").textContent = `${data.user.fullName} · ${data.user.studentId}`;
  await refreshConversations();
}

async function refreshConversations() {
  const data = await request("/api/conversations");
  if (!data) {
    return;
  }
  state.conversations = data.conversations;
  renderConversations();

  if (!state.activeConversationId && state.conversations.length > 0) {
    await loadConversation(state.conversations[0].id);
  } else if (state.activeConversationId) {
    const stillExists = state.conversations.some((item) => item.id === state.activeConversationId);
    if (!stillExists && state.conversations[0]) {
      await loadConversation(state.conversations[0].id);
    }
  }
}

async function createConversation() {
  const articleType = window.prompt("Choose article type: enter A or B", "A");
  const normalizedArticleType = String(articleType || "").trim().toUpperCase();
  if (!["A", "B"].includes(normalizedArticleType)) {
    setStatus("Article type must be A or B.");
    return;
  }
  const data = await request("/api/conversations", {
    method: "POST",
    body: JSON.stringify({}),
  });
  await request(`/api/conversations/${data.conversation.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      articleType: normalizedArticleType,
      title: `Article ${normalizedArticleType} tutoring chat`,
    }),
  });
  state.activeConversationId = data.conversation.id;
  await refreshConversations();
  await loadConversation(data.conversation.id);
}

async function loadConversation(conversationId) {
  const data = await request(`/api/conversations/${conversationId}`);
  if (!data) {
    return;
  }
  state.activeConversationId = conversationId;
  state.messages = data.messages;
  $("#conversation-title").textContent = `${data.conversation.title}${
    data.conversation.articleType ? ` · Type ${data.conversation.articleType}` : ""
  }`;
  $("#original-text").value = data.conversation.originalText || "";
  renderConversations();
  renderMessages();
}

async function saveOriginalText() {
  const conversation = currentConversation();
  if (!conversation) {
    setStatus("Create a chat first.");
    return;
  }

  const originalText = $("#original-text").value.trim();
  if (!conversation.articleType) {
    setStatus("Please choose article type A or B first.");
    return;
  }
  const title = originalText
    ? originalText.split(/\r?\n/)[0].slice(0, 60)
    : `Article ${conversation.articleType} tutoring chat`;
  await request(`/api/conversations/${conversation.id}`, {
    method: "PATCH",
    body: JSON.stringify({ originalText, title, articleType: conversation.articleType }),
  });
  setStatus("Reading passage saved.");
  await refreshConversations();
  await loadConversation(conversation.id);
}

async function sendMessage() {
  const conversation = currentConversation();
  if (!conversation) {
    setStatus("Create a chat first.");
    return;
  }

  const content = $("#message-input").value.trim();
  if (!content) {
    setStatus("Enter a message first.");
    return;
  }

  $("#send-btn").disabled = true;
  $("#message-input").disabled = true;
  setStatus("Tutor is replying...");

  try {
    const data = await request(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    state.messages = data.messages;
    $("#message-input").value = "";
    renderMessages();
    setStatus("Reply received.");
    await refreshConversations();
  } catch (error) {
    setStatus(error.message);
  } finally {
    $("#send-btn").disabled = false;
    $("#message-input").disabled = false;
    $("#message-input").focus();
  }
}

$("#new-chat-btn").addEventListener("click", createConversation);
$("#save-original-btn").addEventListener("click", saveOriginalText);
$("#send-btn").addEventListener("click", sendMessage);
$("#logout-btn").addEventListener("click", async () => {
  await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  window.location.href = "/login";
});

$("#message-input").addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    sendMessage();
  }
});

bootstrap();
