"use strict";
/**
 * db.js — Persistent storage layer (SQLite via node:sqlite, zero dependencies)
 * Shared by every user: students, lecturers and the administrator.
 */
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/* Minimal .env loader (no dependencies). Runs BEFORE any process.env reads,
   so a local `.env` file works on Windows/macOS/Linux. On Render (and in
   production generally) real environment variables take precedence and this
   file is normally absent — nothing is read from disk there. Never commit
   a real .env to git (see .gitignore). */
(function loadEnvFile() {
  try {
    const envFile = path.join(__dirname, ".env");
    if (!fs.existsSync(envFile)) return;
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (_) { /* never crash startup because of a local .env file */ }
})();

/* Production persistence (Render):
   - DATA_DIR=/var/data  -> database at /var/data/helpdesk.sqlite
   - DATABASE_PATH (explicit) still wins for backward compatibility / recovery
   - otherwise local dev default: ./data/helpdesk.sqlite */
const DATA_DIR = process.env.DATA_DIR || "";
const DB_PATH = process.env.DATABASE_PATH || (DATA_DIR ? path.join(DATA_DIR, "helpdesk.sqlite") : path.join(__dirname, "data", "helpdesk.sqlite"));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

function now() { return new Date().toISOString(); }
function uid(prefix) { return (prefix || "id") + "-" + crypto.randomBytes(6).toString("hex"); }

/* ---------------- password hashing (scrypt) ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + derived;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, salt, expected] = String(stored || "").split("$");
    if (scheme !== "scrypt") return false;
    const actual = crypto.scryptSync(String(password || ""), salt, 64);
    return crypto.timingSafeEqual(actual, Buffer.from(expected, "hex"));
  } catch (_) { return false; }
}

/* ---------------- schema ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT 'Administrator',
  email TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT UNIQUE,
  department TEXT NOT NULL DEFAULT '', matric_number TEXT UNIQUE NOT NULL,
  initials TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS lecturers (
  id TEXT PRIMARY KEY, staff_id TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
  email TEXT, department TEXT NOT NULL DEFAULT '', phone TEXT DEFAULT '',
  initials TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  lecturer_staff_id TEXT, student_id TEXT, lecturer_id TEXT,
  student_name TEXT DEFAULT '', student_matric TEXT DEFAULT '', student_department TEXT DEFAULT '',
  lecturer_name TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id),
  author_type TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL,
  category TEXT DEFAULT '', priority TEXT DEFAULT 'normal', sound TEXT,
  recipient_type TEXT NOT NULL, scheduled_at TEXT, expires_at TEXT,
  created_by TEXT DEFAULT 'admin', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  user_type TEXT NOT NULL, user_id TEXT NOT NULL,
  read_at TEXT, sound_played INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (notification_id, user_type, user_id));
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_type TEXT NOT NULL, user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, admin_username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL, target TEXT DEFAULT '', details TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT 'Under maintenance',
  message TEXT NOT NULL DEFAULT 'We are improving the help desk. Please check back soon.',
  reopening_at TEXT, updated_at TEXT, updated_by TEXT DEFAULT '');
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_nr_user ON notification_recipients(user_type, user_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);`);

/* ---------------- settings / maintenance ---------------- */
const DEFAULT_SETTINGS = {
  brand_name: "Student Help Desk", app_title: "Student HelpDesk · PTI",
  welcome_message: "A calmer way to ask for help.", footer_text: "Common Room · University support desk",
  institution: "Polytechnic (PTI)", primary_color: "#23444a",
  contact_email: "helpdesk@university.edu", contact_phone: "", logo_path: "", favicon_path: ""
};
function getSettings() {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  db.prepare("SELECT key, value FROM settings").all().forEach((r) => { out[r.key] = r.value; });
  return out;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value == null ? "" : value));
}
function getMaintenance() {
  return db.prepare("SELECT * FROM maintenance WHERE id=1").get();
}
function setMaintenance(patch, by) {
  const cur = getMaintenance();
  db.prepare("UPDATE maintenance SET enabled=?, title=?, message=?, reopening_at=?, updated_at=?, updated_by=? WHERE id=1")
    .run(patch.enabled ? 1 : 0, patch.title != null ? patch.title : cur.title,
      patch.message != null ? patch.message : cur.message,
      patch.reopeningAt != null ? patch.reopeningAt : cur.reopening_at, now(), by || "");
  return getMaintenance();
}

/* ---------------- audit ---------------- */
function audit(admin, action, target, details) {
  try {
    db.prepare("INSERT INTO audit_logs(admin_id, admin_username, action, target, details, created_at) VALUES(?,?,?,?,?,?)")
      .run(admin && admin.id ? admin.id : null, admin ? (admin.username || admin.display_name || "admin") : "system",
        action, target || "", details || "", now());
  } catch (_) { /* never break the request for logging */ }
}

/* ---------------- seed (development-only demo data) ----------------
   Production: never auto-seed demo users/tickets/passwords.
   Local dev:  set SEED_DEMO=true OR NODE_ENV=development (default when
               NODE_ENV is unset). The flag only matters on a brand-new,
               empty database — existing records are always preserved. */
const LECTURER_SEED = [
  ["lecturer-Ayuba", "STAFF-1042", "Mr. Isuwa Ayuba", "Computer Science", "IA"],
  ["lecturer-Otorokpo", "STAFF-1038", "Mr. Augustine Otorokpo", "Computer Science", "AO"],
  ["lecturer-Oshasha", "STAFF-1087", "Mrs. Roli Oshasha", "Computer Science", "RO"],
  ["lecturer-Opara", "STAFF-1016", "Mr. Celestine Opara", "Computer Science", "CO"],
  ["lecturer-Ferguson", "STAFF-1043", "Dr. Ferguson Oghene", "Computer Science", "FO"],
  ["lecturer-Amaechina", "STAFF-1026", "Sir. William Amaechina", "Computer Science", "WA"],
  ["lecturer-Benjamin", "STAFF-1027", "Dr. Benjamin Omole", "Computer Science", "BO"]
];
function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) c FROM lecturers").get().c;
  if (count > 0) return;
  const seedEnabled = process.env.SEED_DEMO === "true" || (process.env.SEED_DEMO !== "false" && process.env.NODE_ENV !== "production");
  if (!seedEnabled) {
    db.prepare("INSERT OR IGNORE INTO maintenance(id,enabled) VALUES(1,0)").run();
    console.log("[db] Production mode: demo data NOT seeded (set SEED_DEMO=true for local dev).");
    return;
  }
  const ts = "2025-03-10T08:00:00.000Z";
  for (const [id, staffId, name, dept, init] of LECTURER_SEED) {
    db.prepare("INSERT OR IGNORE INTO lecturers(id,staff_id,full_name,email,department,phone,initials,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, staffId, name, "lecturer@university.edu", dept, "", init, hashPassword("lecturer123"), ts);
  }
  db.prepare("INSERT OR IGNORE INTO students(id,full_name,email,department,matric_number,initials,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("student-amina", "Amina Yusuf", "amina.yusuf@campus.edu", "Computer Science", "CSC/2024/0142", "AY", hashPassword("student123"), ts);
  const tickets = [
    ["HD-1048", "Missing Grades", "CSC 301 result not showing on portal", "My second semester result for CSC 301 is not showing on the student portal, although I submitted the examination.", "in_progress", "STAFF-1042", "2025-03-12T08:42:00.000Z", "2025-03-12T11:16:00.000Z", "Mr. Isuwa Ayuba",
      [["msg-1048-1", "student", "Amina Yusuf", "My second semester result for CSC 301 is not showing on the student portal, although I submitted the examination.", "2025-03-12T08:42:00.000Z"],
       ["msg-1048-2", "lecturer", "Mr. Augustine Otorokpo", "Thanks for flagging this, Amina. I am checking the departmental result sheet and will update you shortly.", "2025-03-12T11:16:00.000Z"]]],
    ["HD-1043", "Timetable Clash", "Two classes scheduled at the same time", "MTH 204 and GST 202 are both showing on my timetable for Tuesday at 10:00 AM.", "open", "STAFF-1038", "2025-03-11T14:05:00.000Z", "2025-03-11T14:05:00.000Z", "Mr. Augustine Otorokpo",
      [["msg-1043-1", "student", "Amina Yusuf", "MTH 204 and GST 202 are both showing on my timetable for Tuesday at 10:00 AM.", "2025-03-11T14:05:00.000Z"]]],
    ["HD-1039", "Assignment Issues", "Unable to submit group assignment", "The submission page keeps timing out when I try to upload our group project PDF.", "resolved", "STAFF-1038", "2025-03-10T09:18:00.000Z", "2025-03-10T12:21:00.000Z", "Mr. Augustine Otorokpo",
      [["msg-1039-1", "student", "Amina Yusuf", "The submission page keeps timing out when I try to upload our group project PDF.", "2025-03-10T09:18:00.000Z"],
       ["msg-1039-2", "lecturer", "Mr. Augustine Otorokpo", "The portal issue has been resolved. Please try uploading again, and keep a copy of the confirmation screen.", "2025-03-10T12:21:00.000Z"]]]
  ];
  for (const t of tickets) {
    db.prepare("INSERT OR IGNORE INTO tickets(id,category,subject,message,status,lecturer_staff_id,student_id,student_name,student_matric,student_department,lecturer_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(t[0], t[1], t[2], t[3], t[4], t[5], "student-amina", "Amina Yusuf", "CSC/2024/0142", "Computer Science", t[8], t[6], t[7]);
    const msgs = t[9];
    const msgStmt = db.prepare("INSERT OR IGNORE INTO ticket_messages(id,ticket_id,author_type,author_name,message,created_at) VALUES(?,?,?,?,?,?)");
    for (const m of msgs) msgStmt.run(m[0], t[0], m[1], m[2], m[3], m[4]);
  }
  db.prepare("INSERT OR IGNORE INTO maintenance(id,enabled) VALUES(1,0)").run();
  console.log("[db] Seeded demo lecturers, student and tickets (passwords: lecturer123 / student123). Change them via the admin panel.");
}
seedIfEmpty();

module.exports = {
  db, now, uid, hashPassword, verifyPassword, getSettings, setSetting, getMaintenance, setMaintenance, audit, DB_PATH
};
