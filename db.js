const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const config = require("./config");

fs.mkdirSync(config.dataDir, { recursive: true });

const dbPath = path.join(config.dataDir, "app.db");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    student_id TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    article_type TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    raw_payload_json TEXT,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "full_name")) {
  db.exec("ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === "student_id")) {
  db.exec("ALTER TABLE users ADD COLUMN student_id TEXT NOT NULL DEFAULT ''");
}

const conversationColumns = db.prepare("PRAGMA table_info(conversations)").all();
if (!conversationColumns.some((column) => column.name === "article_type")) {
  db.exec("ALTER TABLE conversations ADD COLUMN article_type TEXT NOT NULL DEFAULT ''");
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash).split(":");
  const actual = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function createUser(username, password, fullName, studentId) {
  const id = newId();
  const createdAt = nowIso();
  const passwordHash = hashPassword(password);
  db.prepare(
    `INSERT INTO users (id, username, full_name, student_id, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, username, fullName, studentId, passwordHash, createdAt);
  return { id, username, fullName, studentId, createdAt };
}

function findUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) || null;
}

function createSession(userId, ttlDays = 14) {
  const id = newId();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, userId, expiresAt, createdAt);
  return { id, userId, expiresAt };
}

function findSessionWithUser(sessionId) {
  const row = db
    .prepare(
      `SELECT sessions.id AS session_id, sessions.expires_at, users.id AS user_id, users.username
             , users.full_name, users.student_id
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`
    )
    .get(sessionId);

  if (!row) {
    return null;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(sessionId);
    return null;
  }
  return row;
}

function deleteSession(sessionId) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

function createConversation(userId, originalText = "") {
  const id = newId();
  const createdAt = nowIso();
  const title = "New tutoring chat";
  db.prepare(
    `INSERT INTO conversations (id, user_id, title, article_type, original_text, status, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, 'active', ?, ?)`
  ).run(id, userId, title, originalText, createdAt, createdAt);
  return getConversationByIdForUser(id, userId);
}

function updateConversation(id, userId, fields) {
  const allowed = [];
  const values = [];
  if (typeof fields.title === "string") {
    allowed.push("title = ?");
    values.push(fields.title);
  }
  if (typeof fields.articleType === "string") {
    allowed.push("article_type = ?");
    values.push(fields.articleType);
  }
  if (typeof fields.originalText === "string") {
    allowed.push("original_text = ?");
    values.push(fields.originalText);
  }
  if (allowed.length === 0) {
    return;
  }
  allowed.push("updated_at = ?");
  values.push(nowIso(), id, userId);
  db.prepare(`UPDATE conversations SET ${allowed.join(", ")} WHERE id = ? AND user_id = ?`).run(...values);
}

function listConversationsForUser(userId) {
  return db
    .prepare(
      `SELECT id, title, original_text AS originalText, status, created_at AS createdAt, updated_at AS updatedAt
              , article_type AS articleType
       FROM conversations
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId);
}

function getConversationByIdForUser(id, userId) {
  return (
    db
      .prepare(
        `SELECT id, title, original_text AS originalText, status, created_at AS createdAt, updated_at AS updatedAt
                , article_type AS articleType
         FROM conversations
         WHERE id = ? AND user_id = ?`
      )
      .get(id, userId) || null
  );
}

function addMessage(conversationId, role, content, rawPayload = null) {
  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, created_at, raw_payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, role, content, createdAt, rawPayload ? JSON.stringify(rawPayload) : null);
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, conversationId);
  return { id, conversationId, role, content, createdAt };
}

function listMessages(conversationId) {
  return db
    .prepare(
      `SELECT id, role, content, created_at AS createdAt, raw_payload_json AS rawPayloadJson
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(conversationId)
    .map((row) => ({
      ...row,
      rawPayload: row.rawPayloadJson ? JSON.parse(row.rawPayloadJson) : null,
      rawPayloadJson: undefined,
    }));
}

module.exports = {
  createUser,
  findUserByUsername,
  verifyPassword,
  createSession,
  findSessionWithUser,
  deleteSession,
  createConversation,
  updateConversation,
  listConversationsForUser,
  getConversationByIdForUser,
  addMessage,
  listMessages,
};
