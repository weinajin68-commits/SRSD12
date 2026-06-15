const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./lib/config");
const db = require("./lib/db");
const { generateTutorReply } = require("./lib/openai");

const publicDir = path.join(process.cwd(), "public");

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, contentType, text) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
  });
  res.end(text);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found." });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      continue;
    }
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function setSessionCookie(res, sessionId) {
  const signature = signSessionId(sessionId);
  const cookieValue = encodeURIComponent(`${sessionId}.${signature}`);
  const securePart = config.cookieSecure ? " Secure;" : "";
  res.setHeader("Set-Cookie", [
    `srsd_session=${cookieValue}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60};${securePart}`,
  ]);
}

function clearSessionCookie(res) {
  const securePart = config.cookieSecure ? " Secure;" : "";
  res.setHeader("Set-Cookie", [
    `srsd_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0;${securePart}`,
  ]);
}

function signSessionId(sessionId) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(sessionId)
    .digest("hex");
}

function readSignedSessionId(req) {
  const cookies = parseCookies(req);
  if (!cookies.srsd_session) {
    return null;
  }
  const [sessionId, signature] = String(cookies.srsd_session).split(".");
  if (!sessionId || !signature) {
    return null;
  }
  const expected = signSessionId(sessionId);
  if (signature !== expected) {
    return null;
  }
  return sessionId;
}

function getAuthUser(req) {
  const sessionId = readSignedSessionId(req);
  if (!sessionId) {
    return null;
  }
  const session = db.findSessionWithUser(sessionId);
  if (!session) {
    return null;
  }
  return {
    sessionId: session.session_id,
    id: session.user_id,
    username: session.username,
  };
}

function validateCredentials(username, password) {
  if (typeof username !== "string" || username.trim().length < 3 || username.trim().length > 32) {
    return "Username must be 3-32 characters.";
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
    return "Username may contain only letters, numbers, underscores, and hyphens.";
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    return "Password must be 6-128 characters.";
  }
  return null;
}

function validateProfile(fullName, studentId) {
  if (typeof fullName !== "string" || fullName.trim().length < 2 || fullName.trim().length > 40) {
    return "Name must be 2-40 characters.";
  }
  if (typeof studentId !== "string" || studentId.trim().length < 2 || studentId.trim().length > 40) {
    return "Student ID must be 2-40 characters.";
  }
  return null;
}

function serveStaticFile(res, filePath) {
  const fullPath = path.join(publicDir, filePath);
  if (!fullPath.startsWith(publicDir) || !fs.existsSync(fullPath)) {
    notFound(res);
    return;
  }

  const ext = path.extname(fullPath);
  const typeMap = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };

  sendText(res, 200, typeMap[ext] || "application/octet-stream", fs.readFileSync(fullPath));
}

function requireAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Authentication required." });
    return null;
  }
  return user;
}

function sanitizeMessage(content) {
  if (typeof content !== "string") {
    return "";
  }
  return content.trim();
}

async function handleApi(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/register") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const fullName = String(body.fullName || "").trim();
    const studentId = String(body.studentId || "").trim();
    const error = validateCredentials(username, password);
    if (error) {
      sendJson(res, 400, { error });
      return;
    }
    const profileError = validateProfile(fullName, studentId);
    if (profileError) {
      sendJson(res, 400, { error: profileError });
      return;
    }
    if (db.findUserByUsername(username)) {
      sendJson(res, 400, { error: "Username already exists." });
      return;
    }
    const user = db.createUser(username, password, fullName, studentId);
    const session = db.createSession(user.id);
    setSessionCookie(res, session.id);
    sendJson(res, 201, {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        studentId: user.studentId,
      },
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const user = db.findUserByUsername(username);
    if (!user || !db.verifyPassword(password, user.password_hash)) {
      sendJson(res, 401, { error: "Invalid username or password." });
      return;
    }
    const session = db.createSession(user.id);
    setSessionCookie(res, session.id);
    sendJson(res, 200, {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        studentId: user.student_id,
      },
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const user = getAuthUser(req);
    if (user) {
      db.deleteSession(user.sessionId);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    sendJson(res, 200, {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        studentId: user.student_id,
      },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/conversations") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    sendJson(res, 200, {
      conversations: db.listConversationsForUser(user.id),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/conversations") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const body = await parseBody(req);
    const conversation = db.createConversation(user.id, String(body.originalText || ""));
    sendJson(res, 201, { conversation });
    return;
  }

  const conversationMatch = pathname.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
  if (conversationMatch) {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const conversationId = conversationMatch[1];
    const conversation = db.getConversationByIdForUser(conversationId, user.id);
    if (!conversation) {
      sendJson(res, 404, { error: "Conversation not found." });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, {
        conversation,
        messages: db.listMessages(conversationId),
      });
      return;
    }

    if (req.method === "PATCH") {
      const body = await parseBody(req);
      db.updateConversation(conversationId, user.id, {
        title: typeof body.title === "string" ? body.title.slice(0, 120) : undefined,
        originalText:
          typeof body.originalText === "string" ? body.originalText.slice(0, 30000) : undefined,
      });
      sendJson(res, 200, {
        conversation: db.getConversationByIdForUser(conversationId, user.id),
      });
      return;
    }
  }

  const messageMatch = pathname.match(/^\/api\/conversations\/([a-f0-9-]+)\/messages$/);
  if (messageMatch && req.method === "POST") {
    const user = requireAuth(req, res);
    if (!user) {
      return;
    }
    const conversationId = messageMatch[1];
    const conversation = db.getConversationByIdForUser(conversationId, user.id);
    if (!conversation) {
      sendJson(res, 404, { error: "Conversation not found." });
      return;
    }

    const body = await parseBody(req);
    const content = sanitizeMessage(body.content);
    if (!content) {
      sendJson(res, 400, { error: "Message content is required." });
      return;
    }

    db.addMessage(conversationId, "user", content, {
      source: "student",
    });

    try {
      const history = db.listMessages(conversationId).map((item) => ({
        role: item.role,
        content: item.content,
      }));
      const result = await generateTutorReply(history, conversation.originalText);
      db.addMessage(conversationId, "assistant", result.text, {
        openaiRequest: result.request,
        openaiResponse: result.raw,
      });
      sendJson(res, 201, {
        messages: db.listMessages(conversationId),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Tutor reply failed." });
    }
    return;
  }

  notFound(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== "GET") {
      notFound(res);
      return;
    }

    if (pathname === "/") {
      serveStaticFile(res, "index.html");
      return;
    }

    if (pathname === "/login") {
      serveStaticFile(res, "login.html");
      return;
    }

    if (pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/app") {
      const user = getAuthUser(req);
      if (!user) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      serveStaticFile(res, "app.html");
      return;
    }

    serveStaticFile(res, pathname.slice(1));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error." });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`SRSD tutor web app listening on http://${config.host}:${config.port}`);
});
