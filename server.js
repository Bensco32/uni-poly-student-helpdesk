"use strict";
/**
 * server.js — Secure backend for Student Help Desk (Node.js, zero dependencies).
 * Serves the existing static site, the /admin panel, and a REST API backed by SQLite (db.js).
 *
 * Run:  node server.js        (PORT env, default 3000)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { db, now, uid, hashPassword, verifyPassword, getSettings, setSetting, getMaintenance, setMaintenance, audit, DB_PATH } = require("./db.js");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";
/* Behind Render's HTTPS proxy COOKIE_SECURE=true on Render (set in render.yaml).
   Local HTTP dev keeps false. Session + CSRF cookies are always HttpOnly. */
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains", /* no-op over local HTTP; enforced on HTTPS */
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};
const ROOT = __dirname;
const PUBLIC_DIR = ROOT;
/* Uploads/sounds: persistent disk in production (DATA_DIR=/var/data),
   app assets/ in local dev. Env-overridable without code changes. */
const DATA_DIR = process.env.DATA_DIR || "";
const UPLOADS_DIR = process.env.UPLOADS_DIR || (DATA_DIR ? path.join(DATA_DIR, "uploads") : path.join(ROOT, "assets", "uploads"));
const SOUNDS_DIR = process.env.SOUNDS_DIR || (DATA_DIR ? path.join(DATA_DIR, "sounds") : path.join(ROOT, "assets", "sounds"));
const ASSETS_DIR = path.join(ROOT, "assets");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SOUNDS_DIR, { recursive: true });

/* ---------- initial admin from env / one-time setup ---------- */
try {
  const cols = db.prepare("PRAGMA table_info(admins)").all().map((c) => c.name);
  if (!cols.includes("must_change_password")) db.exec("ALTER TABLE admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
} catch (_) {}
(function initAdmin() {
  const count = db.prepare("SELECT COUNT(*) c FROM admins").get().c;
  if (count > 0) return; /* never overwrite existing admin accounts */
  const envUser = process.env.ADMIN_USERNAME, envPass = process.env.ADMIN_PASSWORD;
  if (envUser && envPass) {
    if (String(envPass).length < 10) { console.error("[admin] ADMIN_PASSWORD must be at least 10 characters."); process.exit(1); }
    db.prepare("INSERT INTO admins(username,password_hash,display_name,email,must_change_password,created_at) VALUES(?,?,?,?,1,?)")
      .run(String(envUser).trim().toLowerCase(), hashPassword(envPass), "Administrator", "", now());
    console.log("[admin] Initial administrator created from environment variables (must change password on first sign-in).");
  } else if (IS_PROD) {
    /* Production: refuse to create a predictable/temp password automatically. */
    console.error("[admin] FATAL: no administrator exists and ADMIN_USERNAME/ADMIN_PASSWORD are not set. Set them in the Render Dashboard and restart.");
    process.exit(1);
  } else {
    const oneTime = crypto.randomBytes(9).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 14);
    db.prepare("INSERT INTO admins(username,password_hash,display_name,email,must_change_password,created_at) VALUES(?,?,?,?,1,?)")
      .run("admin", hashPassword(oneTime), "Administrator", "", now());
    console.log("\n============================================================");
    console.log("  FIRST ADMIN LOGIN (local dev one-time password — change it at once)");
    console.log("  URL:      /admin");
    console.log("  Username: admin");
    console.log("  Password: " + oneTime);
    console.log("  Change it via Admin Profile > Change password.");
    console.log("============================================================\n");
  }
})();

/* ---------- built-in notification sounds (generated WAV, no binary commit) ---------- */
function writeWav(file, freqs, durationEach) {
  if (fs.existsSync(file)) return;
  const rate = 44100, n = Math.floor(rate * durationEach * freqs.length);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const idx = Math.min(freqs.length - 1, Math.floor(i / (rate * durationEach)));
    const t = (i % Math.floor(rate * durationEach)) / rate;
    const env = Math.min(1, t * 12) * Math.max(0, 1 - t / durationEach);
    const s = Math.sin(2 * Math.PI * freqs[idx] * (i / rate)) * 0.45 * env;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}
writeWav(path.join(SOUNDS_DIR, "default.wav"), [880, 1174], 0.18);
writeWav(path.join(SOUNDS_DIR, "chime.wav"), [659, 880, 1318], 0.16);
writeWav(path.join(SOUNDS_DIR, "alert.wav"), [440, 440, 440], 0.15);
writeWav(path.join(SOUNDS_DIR, "gentle.wav"), [523, 659], 0.25);
const SOUND_OPTIONS = [
  { id: "none", label: "No sound" }, { id: "default", label: "Default" },
  { id: "chime", label: "Chime" }, { id: "alert", label: "Alert" }, { id: "gentle", label: "Gentle" }
];

/* ---------- helpers ---------- */
function initials(name) { return String(name || "").trim().split(/\s+/).slice(0, 2).map((p) => (p[0] || "").toUpperCase()).join(""); }
function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "")); }
function esc(s) { return String(s == null ? "" : s); }
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("="); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookieHeader(name, value, maxAgeSec) {
  let s = name + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAgeSec;
  if (COOKIE_SECURE) s += "; Secure";
  return s;
}
function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extraHeaders || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > (limit || 5 * 1024 * 1024)) { reject(new Error("Payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { const raw = Buffer.concat(chunks).toString("utf8"); if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
/* rate limiting (auth endpoints) */
const rateMap = new Map();
function rateLimited(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const key = ip + ":" + req.url.split("?")[0];
  const t = Date.now(); const arr = (rateMap.get(key) || []).filter((x) => t - x < 15 * 60 * 1000);
  arr.push(t); rateMap.set(key, arr);
  if (arr.length > 20) return true;
  return false;
}
/* sessions */
function createSession(userType, userId) {
  const id = crypto.randomBytes(24).toString("hex");
  const exp = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions(id,user_type,user_id,expires_at,created_at) VALUES(?,?,?,?,?)").run(id, userType, String(userId), exp, now());
  return id;
}
function destroySession(id) { if (id) db.prepare("DELETE FROM sessions WHERE id=?").run(id); }
function getSession(req) {
  const id = parseCookies(req)["hd_session"];
  if (!id) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) { destroySession(id); return null; }
  let user = null, type = row.user_type;
  if (type === "admin") {
    user = db.prepare("SELECT id,username,display_name as displayName,email,active,must_change_password as mustChangePassword,created_at as createdAt,last_login_at as lastLoginAt FROM admins WHERE id=?").get(Number(row.user_id));
    if (user && !user.active) { destroySession(id); return null; }
  } else if (type === "student") {
    user = db.prepare("SELECT * FROM students WHERE id=?").get(row.user_id);
    if (user && (user.deleted || !user.active)) {
      /* Deleted/deactivated accounts keep no sessions: wipe all their sessions too */
      db.prepare("DELETE FROM sessions WHERE user_type='student' AND user_id=?").run(String(row.user_id));
      destroySession(id); return null;
    }
  } else if (type === "lecturer") {
    user = db.prepare("SELECT * FROM lecturers WHERE id=?").get(row.user_id);
    if (user && (user.deleted || !user.active)) {
      db.prepare("DELETE FROM sessions WHERE user_type='lecturer' AND user_id=?").run(String(row.user_id));
      destroySession(id); return null;
    }
  }
  if (!user) return null;
  return { id, userType: type, userId: String(row.user_id), user };
}
function publicUser(sess) {
  if (!sess) return null;
  const u = sess.user;
  if (sess.userType === "admin") return { id: String(u.id), userType: "admin", username: u.username, displayName: u.displayName, email: u.email, mustChangePassword: !!u.mustChangePassword };
  if (sess.userType === "student") return { id: u.id, userType: "student", fullName: u.full_name, email: u.email, department: u.department, matricNumber: u.matric_number, initials: u.initials, active: !!u.active };
  return { id: u.id, userType: "lecturer", staffId: u.staff_id, fullName: u.full_name, email: u.email, department: u.department, phone: u.phone || "", initials: u.initials, active: !!u.active };
}
function checkCsrf(req, res) {
  const cookies = parseCookies(req);
  const token = cookies["hd_csrf"] || "";
  const header = req.headers["x-csrf-token"] || "";
  if (!token || token !== header) { sendJson(res, 403, { error: "Invalid CSRF token." }); return false; }
  return true;
}
function requireAdmin(req, res) {
  const sess = getSession(req);
  if (!sess || sess.userType !== "admin") { sendJson(res, 403, { error: "Administrator access required." }); return null; }
  return sess;
}
function requireUser(req, res) {
  const sess = getSession(req);
  if (!sess || sess.userType === "admin") { sendJson(res, 401, { error: "Authentication required." }); return null; }
  return sess;
}
function ticketToJson(t) {
  const msgs = db.prepare("SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at ASC").all(t.id)
    .map((m) => ({ id: m.id, authorType: m.author_type, authorName: m.author_name, message: m.message, createdAt: m.created_at }));
  const student = t.student_id ? db.prepare("SELECT * FROM students WHERE id=?").get(t.student_id) : null;
  const lecturer = t.lecturer_id ? db.prepare("SELECT * FROM lecturers WHERE id=?").get(t.lecturer_id) : null;
  return {
    id: t.id, category: t.category, subject: t.subject, message: t.message, status: t.status,
    createdAt: t.created_at, updatedAt: t.updated_at, lecturerStaffId: t.lecturer_staff_id,
    student: { id: t.student_id, fullName: student ? student.full_name : t.student_name, email: student ? student.email : "", department: student ? student.department : t.student_department, matricNumber: student ? student.matric_number : t.student_matric },
    lecturer: { id: t.lecturer_id, fullName: lecturer ? lecturer.full_name : t.lecturer_name, staffId: t.lecturer_staff_id, department: lecturer ? lecturer.department : "" },
    messages: msgs
  };
}
function nextTicketId() {
  const row = db.prepare("SELECT COUNT(*) c FROM tickets").get();
  return "HD-" + (1049 + row.c + Math.floor(Math.random() * 3));
}
function isMaintenanceEnabled() { const m = getMaintenance(); return !!(m && m.enabled); }
function resolveRecipients(recipientType, userIds) {
  const out = [];
  const addStudents = (rows) => rows.forEach((r) => out.push({ userType: "student", userId: r.id }));
  const addLecturers = (rows) => rows.forEach((r) => out.push({ userType: "lecturer", userId: r.id }));
  if (recipientType === "all_students") addStudents(db.prepare("SELECT id FROM students WHERE active=1 AND deleted=0").all());
  else if (recipientType === "all_lecturers") addLecturers(db.prepare("SELECT id FROM lecturers WHERE active=1 AND deleted=0").all());
  else if (recipientType === "everyone") { addStudents(db.prepare("SELECT id FROM students WHERE active=1 AND deleted=0").all()); addLecturers(db.prepare("SELECT id FROM lecturers WHERE active=1 AND deleted=0").all()); }
  else if ((recipientType === "selected_students" || recipientType === "selected_lecturers" || recipientType === "specific") && Array.isArray(userIds)) {
    const seen = new Set();
    for (const it of userIds) {
      const k = it.userType + ":" + it.userId;
      if (seen.has(k)) continue; seen.add(k);
      if (it.userType === "student") { const r = db.prepare("SELECT id FROM students WHERE id=? AND active=1 AND deleted=0").get(it.userId); if (r) out.push({ userType: "student", userId: r.id }); }
      if (it.userType === "lecturer") { const r = db.prepare("SELECT id FROM lecturers WHERE id=? AND active=1 AND deleted=0").get(it.userId); if (r) out.push({ userType: "lecturer", userId: r.id }); }
    }
  }
  return out;
}
const MAX_IMAGE = 1024 * 1024; // 1MB
const MAX_SOUND = 2 * 1024 * 1024;
function magicCheck(buf, kind) {
  const start = buf.slice(0, 12);
  if (kind === "image") {
    if (start.slice(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))) return "jpg";
    if (start.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return "png";
    if (start.slice(0, 12).toString("latin1").startsWith("RIFF") && start.slice(8, 12).toString("latin1") === "WEBP") return "webp";
    if (start.slice(0, 6).toString("latin1").startsWith("GIF8")) return "gif";
    const s = buf.slice(0, 2000).toString("utf8").trimStart();
    if (s.startsWith("<svg") && !/<script|on\w+\s*=|javascript:/i.test(s)) return "svg";
    return null;
  }
  if (start.slice(0, 4).toString("latin1") === "RIFF" && start.slice(8, 12).toString("latin1") === "WAVE") return "wav";
  if (start.slice(0, 3).toString("latin1") === "ID3" || (start[0] === 0xFF && (start[1] & 0xE0) === 0xE0)) return "mp3";
  if (start.slice(0, 4).toString("latin1") === "OggS") return "ogg";
  return null;
}

/* ---------- persistent file serving (uploads/sounds outside source tree) ---------- */
function isWithinDir(dir, resolved) {
  const base = path.resolve(dir) + path.sep;
  return resolved === path.resolve(dir) || resolved.startsWith(base);
}
function serveUploadsSounds(req, res, pathname) {
  /* /assets/uploads/<file> -> UPLOADS_DIR, /assets/sounds/<file> -> SOUNDS_DIR */
  let baseDir = null;
  if (pathname.startsWith("/assets/uploads/")) baseDir = UPLOADS_DIR;
  else if (pathname.startsWith("/assets/sounds/")) baseDir = SOUNDS_DIR;
  else return false;
  const rel = pathname.slice(pathname.indexOf("/", 8) + 1); /* after /assets/uploads/ or /assets/sounds/ */
  const resolved = path.resolve(path.join(baseDir, rel));
  if (!isWithinDir(baseDir, resolved)) { res.writeHead(403); res.end("Forbidden"); return true; }
  /* Only safe file types are ever written by the upload endpoint; still enforce here. */
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".wav", ".mp3", ".ogg", ".ico"]);
  if (!allowed.has(path.extname(resolved).toLowerCase())) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return true; }
  fs.readFile(resolved, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=86400" });
    res.end(data);
  });
  return true;
}
/* ---------- static serving ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".json": "application/json", ".ico": "image/x-icon" };
function serveStatic(req, res, pathname) {
  if (serveUploadsSounds(req, res, pathname)) return true;
  let file = null;
  if (pathname === "/" || pathname === "/index.html") file = path.join(ROOT, "index.html");
  else if (pathname === "/app.js") file = path.join(ROOT, "app.js");
  else if (pathname === "/style.css") file = path.join(ROOT, "style.css");
  else if (pathname === "/favicon.svg") file = path.join(ROOT, "favicon.svg");
  else if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin.html") file = path.join(ROOT, "admin", "index.html");
  else if (pathname.startsWith("/admin/")) {
    const rel = pathname.slice("/admin/".length) || "index.html";
    file = path.join(ROOT, "admin", rel);
  } else if (pathname.startsWith("/assets/")) {
    file = path.join(ROOT, pathname);
  } else if (pathname.startsWith("/api/") || pathname === "/healthz") return false;
  else {
    /* SPA fallback for hash-less clean URLs: serve main site */
    file = path.join(ROOT, "index.html");
  }
  const resolved = path.resolve(file);
  if (!isWithinDir(ROOT, resolved)) { res.writeHead(403); res.end("Forbidden"); return true; }
  /* Never expose the database, env files, or any data directory over HTTP. */
  if (resolved === path.resolve(DB_PATH) || resolved.endsWith(".sqlite") || resolved.endsWith(".sqlite-wal") || resolved.endsWith(".sqlite-shm") || resolved.endsWith(".db") || path.basename(resolved) === ".env") { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return true; }
  fs.readFile(resolved, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    res.end(data);
  });
  return true;
}

/* ---------- API ---------- */
async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const json = (s, o, h) => sendJson(res, s, o, h);
  const sess = getSession(req);

  if (pathname === "/api/public") {
    if (method !== "GET") return json(405, { error: "Method not allowed" });
    const csrf = parseCookies(req)["hd_csrf"] || crypto.randomBytes(16).toString("hex");
    const s = getSettings(), m = getMaintenance();
    return json(200, { settings: s, maintenance: m, sounds: SOUND_OPTIONS, csrf }, {
      "Set-Cookie": cookieHeader("hd_csrf", csrf, 60 * 60 * 24)
    });
  }
  if (pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "POST" && method !== "PATCH" && method !== "DELETE") return json(405, { error: "Method not allowed" });
    if (method !== "GET" && !checkCsrf(req, res)) return;
  }

  /* --- auth --- */
  if (pathname === "/api/auth/register" && method === "POST") {
    return json(403, { error: "Self-registration is disabled. Student accounts are created by the administrator during admission. Please contact the help desk admin." });
  }
  if (pathname === "/api/auth/student-login" && method === "POST") {
    const b = await readBody(req);
    if (isMaintenanceEnabled()) return json(403, { error: "The help desk is under maintenance." });
    if (rateLimited(req)) return json(429, { error: "Too many attempts. Try again later." });
    const u = db.prepare("SELECT * FROM students WHERE matric_number=? COLLATE NOCASE").get(esc(b.matricNumber).trim());
    if (!u || u.deleted || !u.active || !verifyPassword(b.password, u.password_hash)) return json(401, { error: "The matric number or password is incorrect." });
    db.prepare("UPDATE students SET last_login_at=? WHERE id=?").run(now(), u.id);
    const sid = createSession("student", u.id);
    return json(200, { user: publicUser({ userType: "student", user: u }) }, { "Set-Cookie": cookieHeader("hd_session", sid, SESSION_TTL_MS / 1000) });
  }
  if (pathname === "/api/auth/lecturer-login" && method === "POST") {
    const b = await readBody(req);
    if (isMaintenanceEnabled()) return json(403, { error: "The help desk is under maintenance." });
    if (rateLimited(req)) return json(429, { error: "Too many attempts. Try again later." });
    const u = db.prepare("SELECT * FROM lecturers WHERE staff_id=? COLLATE NOCASE").get(esc(b.staffId).trim());
    if (!u || u.deleted || !u.active || !verifyPassword(b.password, u.password_hash)) return json(401, { error: "The Lecturer ID or password is incorrect." });
    db.prepare("UPDATE lecturers SET last_login_at=? WHERE id=?").run(now(), u.id);
    const sid = createSession("lecturer", u.id);
    return json(200, { user: publicUser({ userType: "lecturer", user: u }) }, { "Set-Cookie": cookieHeader("hd_session", sid, SESSION_TTL_MS / 1000) });
  }
  if (pathname === "/api/auth/admin-login" && method === "POST") {
    const b = await readBody(req);
    if (rateLimited(req)) return json(429, { error: "Too many attempts. Try again later." });
    const u = db.prepare("SELECT * FROM admins WHERE username=? COLLATE NOCASE").get(esc(b.username).trim());
    if (!u || !u.active || !verifyPassword(b.password, u.password_hash)) return json(401, { error: "Invalid administrator credentials." });
    db.prepare("UPDATE admins SET last_login_at=? WHERE id=?").run(now(), u.id);
    audit(u, "admin_login", "admin:" + u.username, "Admin signed in");
    const sid = createSession("admin", u.id);
    return json(200, { user: publicUser({ userType: "admin", user: u }) }, { "Set-Cookie": cookieHeader("hd_session", sid, SESSION_TTL_MS / 1000) });
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    if (sess && sess.userType === "admin") audit(sess.user, "admin_logout", "admin:" + (sess.user.username || ""), "Admin signed out");
    destroySession(sess && sess.id);
    return json(200, { ok: true }, { "Set-Cookie": cookieHeader("hd_session", "", 0) });
  }
  if (pathname === "/api/me" && method === "GET") {
    if (!sess) return json(401, { error: "Not signed in." });
    return json(200, { user: publicUser(sess) });
  }
  if (pathname === "/api/lecturers/directory" && method === "GET") {
    if (!requireUser(req, res)) return;
    const rows = db.prepare("SELECT staff_id, full_name, department FROM lecturers WHERE active=1 AND deleted=0 ORDER BY full_name").all();
    return json(200, { lecturers: rows.map((r) => ({ staffId: r.staff_id, fullName: r.full_name, department: r.department })) });
  }
  /* --- legacy localStorage safe import (one descriptor per call, idempotent) --- */
  if (pathname === "/api/migrate-local" && method === "POST") {
    if (!requireUser(req, res)) return;
    const b = await readBody(req);
    let importedStudents = 0, importedLecturers = 0;
    for (const s of (b.students || [])) {
      const matric = esc(s.matricNumber).trim(); if (!matric || !s.password) continue;
      const ex = db.prepare("SELECT id FROM students WHERE matric_number=? COLLATE NOCASE OR email=? COLLATE NOCASE").get(matric, esc(s.email).trim().toLowerCase());
      if (!ex) { db.prepare("INSERT INTO students(id,full_name,email,department,matric_number,initials,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(esc(s.id).trim() || uid("student"), esc(s.fullName).trim(), esc(s.email).trim().toLowerCase(), esc(s.department).trim(), matric, initials(esc(s.fullName)), hashPassword(s.password), s.createdAt || now()); importedStudents++; }
    }
    for (const l of (b.lecturers || [])) {
      const staffId = esc(l.staffId).trim(); if (!staffId || !l.password) continue;
      const ex = db.prepare("SELECT id FROM lecturers WHERE staff_id=? COLLATE NOCASE").get(staffId);
      if (!ex) { db.prepare("INSERT INTO lecturers(id,staff_id,full_name,email,department,initials,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(esc(l.id).trim() || uid("lecturer"), staffId, esc(l.fullName).trim(), esc(l.email).trim(), esc(l.department).trim(), initials(esc(l.fullName)), hashPassword(l.password), l.createdAt || now()); importedLecturers++; }
    }
    return json(200, { importedStudents, importedLecturers });
  }
  /* --- tickets (student/lecturer) --- */
  if (pathname === "/api/tickets" && method === "GET") {
    const s = requireUser(req, res); if (!s) return;
    let rows;
    if (s.userType === "student") rows = db.prepare("SELECT * FROM tickets WHERE student_id=? ORDER BY created_at ASC").all(s.userId);
    else rows = db.prepare("SELECT * FROM tickets WHERE lecturer_staff_id=? COLLATE NOCASE ORDER BY created_at ASC").all(s.user.staff_id);
    return json(200, { tickets: rows.map(ticketToJson) });
  }
  if (pathname === "/api/tickets" && method === "POST") {
    const s = requireUser(req, res); if (!s) return;
    if (s.userType !== "student") return json(403, { error: "Only students can create tickets." });
    if (isMaintenanceEnabled()) return json(403, { error: "The help desk is under maintenance." });
    const b = await readBody(req);
    const staffId = esc(b.lecturerId).trim();
    const lec = db.prepare("SELECT * FROM lecturers WHERE staff_id=? COLLATE NOCASE AND active=1 AND deleted=0").get(staffId);
    if (!lec) return json(400, { error: "Enter a Lecturer ID from the registered directory." });
    const subject = esc(b.subject).trim(), message = esc(b.message).trim(), category = esc(b.category).trim() || "General";
    if (subject.length < 2 || message.length < 5) return json(400, { error: "Please give a clear subject and message." });
    const id = nextTicketId(); const ts = now();
    db.prepare("INSERT INTO tickets(id,category,subject,message,status,lecturer_staff_id,student_id,lecturer_id,student_name,student_matric,student_department,lecturer_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, category, subject, message, "open", lec.staff_id, s.userId, lec.id, s.user.full_name, s.user.matric_number, s.user.department, lec.full_name, ts, ts);
    db.prepare("INSERT INTO ticket_messages(id,ticket_id,author_type,author_name,message,created_at) VALUES(?,?,?,?,?,?)")
      .run(uid("msg"), id, "student", s.user.full_name, message, ts);
    return json(201, { ticket: ticketToJson(db.prepare("SELECT * FROM tickets WHERE id=?").get(id)) });
  }
  const ticketSub = pathname.match(/^\/api\/tickets\/([^/]+)\/(reply|status)$/);
  if (ticketSub && method === "POST") {
    const s = requireUser(req, res); if (!s) return;
    const t = db.prepare("SELECT * FROM tickets WHERE id=?").get(decodeURIComponent(ticketSub[1]));
    if (!t) return json(404, { error: "Ticket not found." });
    const owns = s.userType === "student" ? t.student_id === s.userId : (t.lecturer_staff_id || "").toLowerCase() === (s.user.staff_id || "").toLowerCase();
    if (!owns) return json(403, { error: "Not your ticket." });
    const b = await readBody(req);
    if (ticketSub[2] === "reply") {
      if (isMaintenanceEnabled()) return json(403, { error: "The help desk is under maintenance." });
      const text = esc(b.message).trim(); if (!text) return json(400, { error: "Message is required." });
      db.prepare("INSERT INTO ticket_messages(id,ticket_id,author_type,author_name,message,created_at) VALUES(?,?,?,?,?,?)")
        .run(uid("msg"), t.id, s.userType, s.userType === "student" ? s.user.full_name : s.user.full_name, text, now());
      if (s.userType === "student") db.prepare("UPDATE tickets SET status='open', updated_at=? WHERE id=?").run(now(), t.id);
      else db.prepare("UPDATE tickets SET status=?, updated_at=? WHERE id=?").run(["open", "in_progress", "resolved"].includes(b.status) ? b.status : "in_progress", now(), t.id);
      return json(200, { ticket: ticketToJson(db.prepare("SELECT * FROM tickets WHERE id=?").get(t.id)) });
    }
    const status = esc(b.status);
    if (s.userType === "student" && status === "closed" && ["resolved", "closed"].includes(t.status)) { db.prepare("UPDATE tickets SET status='closed', updated_at=? WHERE id=?").run(now(), t.id); return json(200, { ticket: ticketToJson(db.prepare("SELECT * FROM tickets WHERE id=?").get(t.id)) }); }
    if (s.userType === "lecturer" && ["open", "in_progress", "resolved"].includes(status)) { db.prepare("UPDATE tickets SET status=?, updated_at=? WHERE id=?").run(status, now(), t.id); return json(200, { ticket: ticketToJson(db.prepare("SELECT * FROM tickets WHERE id=?").get(t.id)) }); }
    return json(400, { error: "Invalid status change." });
  }
  /* --- notifications (polling; WebSocket/SSE avoided on purpose for simple hosting) --- */
  if (pathname === "/api/notifications" && method === "GET") {
    const s = requireUser(req, res); if (!s) return;
    const rows = db.prepare(`SELECT n.*, r.read_at, r.sound_played FROM notifications n
      JOIN notification_recipients r ON r.notification_id=n.id AND r.user_type=? AND r.user_id=?
      WHERE (n.scheduled_at IS NULL OR n.scheduled_at<=?) AND (n.expires_at IS NULL OR n.expires_at>?)
      ORDER BY n.created_at DESC LIMIT 100`).all(s.userType, s.userId, now(), now());
    const unread = rows.filter((r) => !r.read_at).length;
    return json(200, { unread, notifications: rows.map((r) => ({ id: r.id, title: r.title, message: r.message, category: r.category, priority: r.priority, sound: r.sound, createdAt: r.created_at, readAt: r.read_at, soundPlayed: !!r.sound_played, expiresAt: r.expires_at })) });
  }
  const notifSub = pathname.match(/^\/api\/notifications\/([^/]+)\/(read|sound-played)$/);
  if (notifSub && method === "POST") {
    const s = requireUser(req, res); if (!s) return;
    const id = decodeURIComponent(notifSub[1]);
    const r = db.prepare("SELECT * FROM notification_recipients WHERE notification_id=? AND user_type=? AND user_id=?").get(id, s.userType, s.userId);
    if (!r) return json(404, { error: "Notification not found." });
    if (notifSub[2] === "read") db.prepare("UPDATE notification_recipients SET read_at=? WHERE notification_id=? AND user_type=? AND user_id=?").run(now(), id, s.userType, s.userId);
    else db.prepare("UPDATE notification_recipients SET sound_played=1 WHERE notification_id=? AND user_type=? AND user_id=?").run(id, s.userType, s.userId);
    return json(200, { ok: true });
  }

  /* ================= ADMIN API ================= */
  if (pathname.startsWith("/api/admin/")) {
    const a = requireAdmin(req, res); if (!a) return;
    const adminUser = a.user;
    if (pathname === "/api/admin/me" && method === "GET") return json(200, { user: publicUser(a) });
    if (pathname === "/api/admin/me/password" && method === "POST") {
      const b = await readBody(req);
      if (!verifyPassword(b.currentPassword, db.prepare("SELECT password_hash FROM admins WHERE id=?").get(adminUser.id).password_hash)) return json(401, { error: "Current password is incorrect." });
      if (String(b.newPassword || "").length < 10) return json(400, { error: "New password must be at least 10 characters." });
      db.prepare("UPDATE admins SET password_hash=?, must_change_password=0 WHERE id=?").run(hashPassword(b.newPassword), adminUser.id);
      audit(adminUser, "admin_password_changed", "admin:" + adminUser.username, "Admin changed own password");
      return json(200, { ok: true });
    }
    if (pathname === "/api/admin/overview" && method === "GET") {
      const cnt = (sql, p) => db.prepare(sql).get(...(p || [])).c || 0;
      const students = cnt("SELECT COUNT(*) c FROM students WHERE deleted=0");
      const lecturers = cnt("SELECT COUNT(*) c FROM lecturers WHERE deleted=0");
      const tickets = cnt("SELECT COUNT(*) c FROM tickets");
      const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
      db.prepare("SELECT status, COUNT(*) c FROM tickets GROUP BY status").all().forEach((r) => { byStatus[r.status] = r.c; });
      const recentStudents = db.prepare("SELECT id,full_name,email,department,matric_number,created_at FROM students WHERE deleted=0 ORDER BY created_at DESC LIMIT 5").all();
      const recentTickets = db.prepare("SELECT id,subject,status,created_at FROM tickets ORDER BY created_at DESC LIMIT 5").all();
      const recentLecturerResponses = db.prepare("SELECT ticket_id,author_name,created_at,message FROM ticket_messages WHERE author_type='lecturer' ORDER BY created_at DESC LIMIT 5").all();
      const recentActivity = db.prepare("SELECT id,admin_username,action,target,created_at FROM audit_logs ORDER BY id DESC LIMIT 10").all();
      const recentNotifs = db.prepare("SELECT id,title,recipient_type,created_at FROM notifications ORDER BY created_at DESC LIMIT 5").all();
      const m = getMaintenance();
      return json(200, { students, lecturers, tickets, byStatus, activeLecturers: cnt("SELECT COUNT(*) c FROM lecturers WHERE deleted=0 AND active=1"), inactiveLecturers: cnt("SELECT COUNT(*) c FROM lecturers WHERE deleted=0 AND active=0"), recentStudents, recentTickets, recentLecturerResponses, recentActivity, recentNotifs, maintenance: { enabled: !!m.enabled, title: m.title, message: m.message, reopeningAt: m.reopening_at } });
    }
    /* lecturers CRUD */
    if (pathname === "/api/admin/lecturers" && method === "GET") {
      const q = String(query.get("q") || "").toLowerCase(), dept = String(query.get("department") || ""), status = String(query.get("status") || "");
      let rows = db.prepare("SELECT * FROM lecturers WHERE deleted=0 ORDER BY full_name").all();
      if (q) rows = rows.filter((r) => (r.full_name + " " + r.staff_id).toLowerCase().includes(q));
      if (dept) rows = rows.filter((r) => r.department === dept);
      if (status === "active") rows = rows.filter((r) => r.active);
      if (status === "inactive") rows = rows.filter((r) => !r.active);
      return json(200, { lecturers: rows.map((r) => ({ id: r.id, staffId: r.staff_id, fullName: r.full_name, email: r.email, department: r.department, phone: r.phone || "", initials: r.initials, active: !!r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at, ticketCount: db.prepare("SELECT COUNT(*) c FROM tickets WHERE lecturer_staff_id=? COLLATE NOCASE").get(r.staff_id).c })) });
    }
    if (pathname === "/api/admin/lecturers" && method === "POST") {
      const b = await readBody(req);
      const fullName = esc(b.fullName).trim(), staffId = esc(b.staffId).trim(), email = esc(b.email).trim(), department = esc(b.department).trim(), phone = esc(b.phone).trim();
      if (!fullName || !staffId || !department || !isEmail(email)) return json(400, { error: "Full name, staff ID, valid email and department are required." });
      if (db.prepare("SELECT id FROM lecturers WHERE staff_id=? COLLATE NOCASE OR email=? COLLATE NOCASE").get(staffId, email)) return json(409, { error: "Staff ID or email already exists." });
      const password = String(b.password || "");
      if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });
      const id = uid("lecturer");
      db.prepare("INSERT INTO lecturers(id,staff_id,full_name,email,department,phone,initials,password_hash,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id, staffId, fullName, email, department, phone, initials(fullName), hashPassword(password), b.active === false ? 0 : 1, now());
      audit(adminUser, "lecturer_created", "lecturer:" + staffId, "Created lecturer " + fullName);
      return json(201, { ok: true, id });
    }
    const lecSub = pathname.match(/^\/api\/admin\/lecturers\/([^/]+)(\/(password|activate|deactivate))?$/);
    if (lecSub) {
      const id = decodeURIComponent(lecSub[1]);
      const existing = db.prepare("SELECT * FROM lecturers WHERE id=?").get(id);
      if (!existing) return json(404, { error: "Lecturer not found." });
      if (!lecSub[2] && method === "PATCH") {
        const b = await readBody(req);
        const fullName = esc(b.fullName).trim() || existing.full_name, staffId = esc(b.staffId).trim() || existing.staff_id;
        const email = esc(b.email).trim() || existing.email, department = esc(b.department).trim() || existing.department, phone = esc(b.phone || "").trim();
        if (!isEmail(email)) return json(400, { error: "Valid email required." });
        if (db.prepare("SELECT id FROM lecturers WHERE (staff_id=? COLLATE NOCASE OR email=? COLLATE NOCASE) AND id<>?").get(staffId, email, id)) return json(409, { error: "Staff ID or email already used by another lecturer." });
        db.prepare("UPDATE lecturers SET full_name=?, staff_id=?, email=?, department=?, phone=?, initials=? WHERE id=?").run(fullName, staffId, email, department, phone, initials(fullName), id);
        audit(adminUser, "lecturer_updated", "lecturer:" + staffId, "Updated lecturer profile");
        return json(200, { ok: true });
      }
      if (lecSub[2] === "/password" && method === "POST") {
        const b = await readBody(req); if (String(b.newPassword || "").length < 8) return json(400, { error: "Password must be at least 8 characters." });
        db.prepare("UPDATE lecturers SET password_hash=? WHERE id=?").run(hashPassword(b.newPassword), id);
        audit(adminUser, "lecturer_password_reset", "lecturer:" + existing.staff_id, "Reset lecturer password (value not logged)");
        return json(200, { ok: true });
      }
      if ((lecSub[2] === "/activate" || lecSub[2] === "/deactivate") && method === "POST") {
        const active = lecSub[2] === "/activate";
        db.prepare("UPDATE lecturers SET active=? WHERE id=?").run(active ? 1 : 0, id);
        if (!active) db.prepare("DELETE FROM sessions WHERE user_type='lecturer' AND user_id=?").run(id);
        audit(adminUser, active ? "lecturer_activated" : "lecturer_deactivated", "lecturer:" + existing.staff_id, (active ? "Activated" : "Deactivated") + " lecturer");
        return json(200, { ok: true });
      }
      if (!lecSub[2] && method === "DELETE") {
        const b = await readBody(req).catch(() => ({}));
        const ticketCount = db.prepare("SELECT COUNT(*) c FROM tickets WHERE lecturer_staff_id=? COLLATE NOCASE").get(existing.staff_id).c;
        if (ticketCount > 0 && !b.reassignTo) return json(409, { error: "This lecturer owns " + ticketCount + " tickets. Choose a lecturer to reassign them to, or deactivate instead.", ticketCount });
        if (b.reassignTo) {
          const target = db.prepare("SELECT * FROM lecturers WHERE staff_id=? COLLATE NOCASE AND active=1 AND deleted=0").get(esc(b.reassignTo).trim());
          if (!target) return json(400, { error: "Reassignment lecturer not found." });
          db.prepare("UPDATE tickets SET lecturer_staff_id=?, lecturer_id=?, lecturer_name=?, updated_at=? WHERE lecturer_staff_id=? COLLATE NOCASE").run(target.staff_id, target.id, target.full_name, now(), existing.staff_id);
        }
        db.prepare("UPDATE lecturers SET deleted=1, active=0 WHERE id=?").run(id);
        db.prepare("DELETE FROM sessions WHERE user_type='lecturer' AND user_id=?").run(id);
        audit(adminUser, "lecturer_deleted", "lecturer:" + existing.staff_id, "Soft-deleted lecturer (login blocked, sessions revoked)" + (b.reassignTo ? " and reassigned tickets to " + b.reassignTo : ""));
        return json(200, { ok: true });
      }
      return json(405, { error: "Method not allowed" });
    }
    /* students admin — admin-created during admission (no public registration) */
    if (pathname === "/api/admin/students" && method === "POST") {
      const b = await readBody(req);
      const fullName = esc(b.fullName).trim(), email = esc(b.email).trim().toLowerCase(), department = esc(b.department).trim(), matric = esc(b.matricNumber).trim(), password = String(b.password || "");
      if (!fullName || !department || !matric || !isEmail(email)) return json(400, { error: "Full name, valid email, department and matric number are required." });
      if (password.length < 8) return json(400, { error: "Password must be at least 8 characters. The student can sign in immediately." });
      if (db.prepare("SELECT id FROM students WHERE matric_number=? COLLATE NOCASE OR email=? COLLATE NOCASE").get(matric, email)) return json(409, { error: "That matric number or email already exists." });
      const id = uid("student");
      db.prepare("INSERT INTO students(id,full_name,email,department,matric_number,initials,password_hash,active,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(id, fullName, email, department, matric, initials(fullName), hashPassword(password), b.active === false ? 0 : 1, now());
      audit(adminUser, "student_created", "student:" + matric, "Admitted student " + fullName + " (admin-created)");
      return json(201, { ok: true, id });
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      const q = String(query.get("q") || "").toLowerCase(), dept = String(query.get("department") || "");
      let rows = db.prepare("SELECT * FROM students WHERE deleted=0 ORDER BY full_name").all();
      if (q) rows = rows.filter((r) => [r.full_name, r.matric_number, r.email, r.department].join(" ").toLowerCase().includes(q));
      if (dept) rows = rows.filter((r) => r.department === dept);
      return json(200, { students: rows.map((r) => ({ id: r.id, fullName: r.full_name, email: r.email, department: r.department, matricNumber: r.matric_number, initials: r.initials, active: !!r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at, ticketCount: db.prepare("SELECT COUNT(*) c FROM tickets WHERE student_id=?").get(r.id).c })) });
    }
    if (pathname === "/api/admin/users/search" && method === "GET") {
      const q = String(query.get("q") || "").toLowerCase();
      const students = db.prepare("SELECT id,full_name,department,matric_number FROM students WHERE deleted=0 AND active=1 ORDER BY full_name").all().filter((r) => !q || (r.full_name + " " + r.matric_number).toLowerCase().includes(q)).map((r) => ({ userType: "student", userId: r.id, label: r.full_name + " — " + r.matric_number + " (" + r.department + ")" }));
      const lecturers = db.prepare("SELECT id,full_name,department,staff_id FROM lecturers WHERE deleted=0 AND active=1 ORDER BY full_name").all().filter((r) => !q || (r.full_name + " " + r.staff_id).toLowerCase().includes(q)).map((r) => ({ userType: "lecturer", userId: r.id, label: r.full_name + " — " + r.staff_id + " (" + r.department + ")" }));
      return json(200, { students, lecturers });
    }
    const stuSub = pathname.match(/^\/api\/admin\/students\/([^/]+)(\/(password|activate|deactivate|suspend|tickets))?$/);
    if (stuSub) {
      const id = decodeURIComponent(stuSub[1]);
      const existing = db.prepare("SELECT * FROM students WHERE id=?").get(id);
      if (!existing) return json(404, { error: "Student not found." });
      if (!stuSub[2] && method === "PATCH") {
        const b = await readBody(req);
        const fullName = esc(b.fullName).trim() || existing.full_name, email = esc(b.email).trim() || existing.email, department = esc(b.department).trim() || existing.department, matric = esc(b.matricNumber).trim() || existing.matric_number;
        if (!isEmail(email)) return json(400, { error: "Valid email required." });
        if (db.prepare("SELECT id FROM students WHERE (matric_number=? COLLATE NOCASE OR email=? COLLATE NOCASE) AND id<>?").get(matric, email, id)) return json(409, { error: "Matric or email already used." });
        db.prepare("UPDATE students SET full_name=?, email=?, department=?, matric_number=?, initials=? WHERE id=?").run(fullName, email, department, matric, initials(fullName), id);
        audit(adminUser, "student_updated", "student:" + matric, "Updated student profile");
        return json(200, { ok: true });
      }
      if (stuSub[2] === "/password" && method === "POST") {
        const b = await readBody(req); if (String(b.newPassword || "").length < 8) return json(400, { error: "Password must be at least 8 characters." });
        db.prepare("UPDATE students SET password_hash=? WHERE id=?").run(hashPassword(b.newPassword), id);
        audit(adminUser, "student_password_reset", "student:" + existing.matric_number, "Reset student password (value not logged)");
        return json(200, { ok: true });
      }
      if ((stuSub[2] === "/activate" || stuSub[2] === "/deactivate" || stuSub[2] === "/suspend") && method === "POST") {
        const active = stuSub[2] === "/activate";
        db.prepare("UPDATE students SET active=? WHERE id=?").run(active ? 1 : 0, id);
        if (!active) db.prepare("DELETE FROM sessions WHERE user_type='student' AND user_id=?").run(id);
        audit(adminUser, active ? "student_activated" : "student_suspended", "student:" + existing.matric_number, (active ? "Activated" : "Suspended") + " student");
        return json(200, { ok: true });
      }
      if (stuSub[2] === "/tickets" && method === "GET") {
        return json(200, { tickets: db.prepare("SELECT * FROM tickets WHERE student_id=? ORDER BY created_at DESC").all(id).map(ticketToJson) });
      }
      if (!stuSub[2] && method === "DELETE") {
        db.prepare("UPDATE students SET deleted=1, active=0 WHERE id=?").run(id);
        db.prepare("DELETE FROM sessions WHERE user_type='student' AND user_id=?").run(id);
        audit(adminUser, "student_deleted", "student:" + existing.matric_number, "Soft-deleted student (tickets preserved, login blocked, sessions revoked)");
        return json(200, { ok: true });
      }
      return json(405, { error: "Method not allowed" });
    }
    /* admin tickets */
    if (pathname === "/api/admin/tickets" && method === "GET") {
      const q = String(query.get("q") || "").toLowerCase(), status = String(query.get("status") || ""), dept = String(query.get("department") || ""), lec = String(query.get("lecturer") || "");
      let rows = db.prepare("SELECT * FROM tickets ORDER BY created_at DESC").all();
      if (q) rows = rows.filter((t) => (t.id + " " + t.student_name + " " + t.lecturer_name + " " + t.category + " " + t.subject).toLowerCase().includes(q));
      if (status) rows = rows.filter((t) => t.status === status);
      if (dept) rows = rows.filter((t) => t.student_department === dept);
      if (lec) rows = rows.filter((t) => (t.lecturer_staff_id || "") === lec);
      return json(200, { tickets: rows.map(ticketToJson) });
    }
    if (pathname === "/api/admin/tickets/export" && method === "GET") {
      const rows = db.prepare("SELECT * FROM tickets ORDER BY created_at ASC").all();
      const csv = ["id,category,subject,status,student,matric,department,lecturer,created,updated"].concat(
        rows.map((t) => [t.id, t.category, t.subject, t.status, t.student_name, t.student_matric, t.student_department, t.lecturer_name, t.created_at, t.updated_at].map((v) => '"' + String(v || "").replace(/"/g, '""') + '"').join(","))
      ).join("\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=tickets-export.csv" });
      res.end(csv); return;
    }
    const aTick = pathname.match(/^\/api\/admin\/tickets\/([^/]+)$/);
    if (aTick && method === "PATCH") {
      const t = db.prepare("SELECT * FROM tickets WHERE id=?").get(decodeURIComponent(aTick[1]));
      if (!t) return json(404, { error: "Ticket not found." });
      const b = await readBody(req);
      if (b.status && ["open", "in_progress", "resolved", "closed"].includes(b.status)) {
        db.prepare("UPDATE tickets SET status=?, updated_at=? WHERE id=?").run(b.status, now(), t.id);
        audit(adminUser, "ticket_status_changed", "ticket:" + t.id, "Status set to " + b.status);
      }
      if (b.reassignTo) {
        const lec = db.prepare("SELECT * FROM lecturers WHERE staff_id=? COLLATE NOCASE AND active=1 AND deleted=0").get(esc(b.reassignTo).trim());
        if (!lec) return json(400, { error: "Lecturer not found." });
        db.prepare("UPDATE tickets SET lecturer_staff_id=?, lecturer_id=?, lecturer_name=?, updated_at=? WHERE id=?").run(lec.staff_id, lec.id, lec.full_name, now(), t.id);
        audit(adminUser, "ticket_reassigned", "ticket:" + t.id, "Reassigned to " + lec.staff_id);
      }
      return json(200, { ticket: ticketToJson(db.prepare("SELECT * FROM tickets WHERE id=?").get(t.id)) });
    }
    /* notifications admin */
    if (pathname === "/api/admin/notifications" && method === "POST") {
      const b = await readBody(req);
      const title = esc(b.title).trim(), message = esc(b.message).trim();
      if (!title || !message) return json(400, { error: "Title and message are required." });
      const types = ["all_students", "selected_students", "all_lecturers", "selected_lecturers", "everyone", "specific"];
      if (!types.includes(b.recipientType)) return json(400, { error: "Invalid recipient type." });
      const sound = esc(b.sound || "none");
      const soundValid = sound === "none" || SOUND_OPTIONS.some((s) => s.id === sound) || fs.existsSync(path.join(SOUNDS_DIR, path.basename(sound)));
      if (!soundValid) return json(400, { error: "Invalid sound." });
      const id = b.idempotencyKey && /^[A-Za-z0-9-]{8,60}$/.test(b.idempotencyKey) ? b.idempotencyKey : uid("notif");
      const exists = db.prepare("SELECT id FROM notifications WHERE id=?").get(id);
      if (exists) return json(200, { ok: true, id, duplicate: true });
      const recipients = resolveRecipients(b.recipientType, b.userIds);
      if (recipients.length === 0) return json(400, { error: "No eligible recipients for this selection." });
      void 0;
      const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt).toISOString() : null;
      const expiresAt = b.expiresAt ? new Date(b.expiresAt).toISOString() : null;
      db.prepare("INSERT INTO notifications(id,title,message,category,priority,sound,recipient_type,scheduled_at,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, title, message, esc(b.category).trim(), esc(b.priority).trim() || "normal", sound, b.recipientType, scheduledAt, expiresAt, adminUser.username, now());
      const ins = db.prepare("INSERT OR IGNORE INTO notification_recipients(notification_id,user_type,user_id) VALUES(?,?,?)");
      for (const r of recipients) ins.run(id, r.userType, r.userId);
      audit(adminUser, "notification_sent", "notification:" + id, title + " -> " + b.recipientType + " (" + recipients.length + " recipients)");
      return json(201, { ok: true, id, recipientCount: recipients.length });
    }
    if (pathname === "/api/admin/notifications/history" && method === "GET") {
      const rows = db.prepare(`SELECT n.*, (SELECT COUNT(*) FROM notification_recipients r WHERE r.notification_id=n.id) AS
        recipients, (SELECT COUNT(*) FROM notification_recipients r WHERE r.notification_id=n.id AND r.read_at IS NOT NULL) AS read_count
        FROM notifications n ORDER BY n.created_at DESC LIMIT 200`).all();
      return json(200, { notifications: rows.map((r) => ({ id: r.id, title: r.title, message: r.message, recipientType: r.recipient_type, sound: r.sound, createdAt: r.created_at, scheduledAt: r.scheduled_at, expiresAt: r.expires_at, recipients: Number(r.recipients), readCount: Number(r.read_count) })) });
    }
    if (pathname === "/api/admin/notifications/count" && method === "GET") {
      const types = ["all_students", "selected_students", "all_lecturers", "selected_lecturers", "everyone", "specific"];
      const type = String(query.get("type") || ""), ids = (() => { try { return JSON.parse(query.get("ids") || "[]"); } catch (_) { return []; } })();
      if (!types.includes(type)) return json(400, { error: "Invalid type." });
      return json(200, { count: resolveRecipients(type, ids).length });
    }
    /* website control */
    if (pathname === "/api/admin/maintenance" && method === "PATCH") {
      const b = await readBody(req);
      const m = setMaintenance({ enabled: !!b.enabled, title: b.title, message: b.message, reopeningAt: b.reopeningAt || null }, adminUser.username);
      audit(adminUser, b.enabled ? "maintenance_enabled" : "maintenance_disabled", "website", (b.enabled ? "Enabled" : "Disabled") + " maintenance mode");
      return json(200, { maintenance: m });
    }
    /* settings */
    if (pathname === "/api/admin/settings" && method === "GET") return json(200, { settings: getSettings() });
    if (pathname === "/api/admin/settings" && method === "PATCH") {
      const b = await readBody(req);
      const allowed = ["brand_name", "app_title", "welcome_message", "footer_text", "institution", "primary_color", "contact_email", "contact_phone", "logo_path", "favicon_path"];
      for (const k of allowed) if (b[k] !== undefined) {
        let v = String(b[k]).trim();
        if (k === "primary_color" && v && !/^#[0-9a-fA-F]{6}$/.test(v)) return json(400, { error: "Primary color must be a hex color like #23444a." });
        if (k === "contact_email" && v && !isEmail(v)) return json(400, { error: "Invalid contact email." });
        setSetting(k, v);
      }
      audit(adminUser, "settings_updated", "settings", "Updated website branding/settings");
      return json(200, { settings: getSettings() });
    }
    if (pathname === "/api/admin/uploads" && method === "POST") {
      const b = await readBody(req, 8 * 1024 * 1024);
      const kind = b.kind === "sound" ? "sound" : "image";
      const buf = Buffer.from(String(b.dataBase64 || "").replace(/\s/g, ""), "base64");
      if (!buf.length) return json(400, { error: "No file data." });
      if (kind === "image" && buf.length > MAX_IMAGE) return json(400, { error: "Image must be under 1MB." });
      if (kind === "sound" && buf.length > MAX_SOUND) return json(400, { error: "Sound must be under 2MB." });
      const ext = magicCheck(buf, kind);
      if (!ext) return json(400, { error: "File type not allowed." });
      const name = (kind === "image" ? "upload-" : "custom-") + Date.now() + "." + ext;
      fs.writeFileSync(path.join(kind === "image" ? UPLOADS_DIR : SOUNDS_DIR, name), buf);
      audit(adminUser, "file_uploaded", kind + ":" + name, "Uploaded " + kind + " file " + name);
      return json(201, { url: (kind === "image" ? "/assets/uploads/" : "/assets/sounds/") + name });
    }
    /* audit logs */
    if (pathname === "/api/admin/audit-logs" && method === "GET") {
      const rows = db.prepare("SELECT id,admin_username,action,target,details,created_at FROM audit_logs ORDER BY id DESC LIMIT 500").all();
      return json(200, { logs: rows });
    }
    return json(404, { error: "Not found." });
  }
  return json(404, { error: "Not found." });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    /* Health check — Render uses this. No auth, no secrets, DB liveness only. */
    if (pathname === "/healthz") {
      if (req.method !== "GET") { res.writeHead(405, { "Content-Type": "text/plain" }); res.end("Method not allowed"); return; }
      try {
        db.prepare("SELECT 1").get();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
      } catch (_) {
        res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }
    if (pathname.startsWith("/api/")) { await handleApi(req, res, pathname, url.searchParams); return; }
    if (req.method !== "GET") { res.writeHead(405); res.end("Method not allowed"); return; }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error("[server]", e && e.message);
    if (!res.headersSent) sendJson(res, 400, { error: "Bad request" }); /* never leak internals */
  }
});
server.listen(PORT, HOST, () => {
  console.log("[server] Student Help Desk running at http://" + HOST + ":" + PORT);
  console.log("         Admin: http://" + HOST + ":" + PORT + "/admin   DB: " + DB_PATH);
})
