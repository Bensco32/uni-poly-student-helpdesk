(function () {
  "use strict";
  var DB_KEY = "student-helpdesk-db-v1";
  var SESSION_KEY = "student-helpdesk-session-v1";
  var app = document.getElementById("app");
  var selectedTicketId = null;
  var csrfToken = null;
  var SETTINGS = { brand_name: "Student Help Desk", app_title: "Student HelpDesk · PTI", welcome_message: "A calmer way to ask for help.", footer_text: "Student Help Desk · University support desk", institution: "Polytechnic (PTI)", primary_color: "#23444a", logo_path: "", favicon_path: "" };
  var MAINT = { enabled: false, title: "Under maintenance", message: "We are improving the help desk. Please check back soon.", reopening_at: null };
  var SOUNDS = [{ id: "none", label: "No sound" }];
  var currentUser = null;
  var notifications = [];
  var unreadCount = 0;
  var pollTimer = null;
  var playedIds = {};
  try { var _p = JSON.parse(localStorage.getItem("hd_played_notifs") || "{}"); playedIds = _p; } catch (_) {}
  function savePlayed() { try { localStorage.setItem("hd_played_notifs", JSON.stringify(playedIds)); } catch (_) {} }
  function soundEnabled() { return localStorage.getItem("hd_notif_sound") === "1"; }

  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]; }); }
  function formatDate(value, includeTime) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return esc(value);
    return new Intl.DateTimeFormat("en-NG", includeTime ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }).format(date);
  }
  function esc(v) { return String(v == null ? "" : v); }
  function statusText(s) { return s === "in_progress" ? "In progress" : s.charAt(0).toUpperCase() + s.slice(1); }
  function statusPill(s) { return '<span class="status status-' + s + '">' + statusText(s) + "</span>"; }

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
    else if (csrfToken && options.method) headers["X-CSRF-Token"] = csrfToken;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(path, { method: options.method || "GET", headers: headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, credentials: "same-origin" })
      .then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          if (!resp.ok) { var e = new Error(data.error || ("Request failed (" + resp.status + ")")); e.status = resp.status; throw e; }
          return data;
        });
      });
  }

  function applySettings() {
    document.title = SETTINGS.app_title || document.title;
    var meta = document.querySelector('meta[property="og:title"]'); if (meta) meta.setAttribute("content", SETTINGS.app_title);
    if (SETTINGS.primary_color) { document.documentElement.style.setProperty("--ink", SETTINGS.primary_color); }
    if (SETTINGS.favicon_path) { var link = document.querySelector('link[rel="icon"]'); if (link) link.href = SETTINGS.favicon_path; }
  }
  function brandMark() {
    if (SETTINGS.logo_path) return '<img src="' + escapeHtml(SETTINGS.logo_path) + '" alt="" style="width:36px;height:36px;border-radius:13px;object-fit:cover" />';
    return '<span class="brand-mark">⌂</span>';
  }
  function shellBrand() {
    return '<a class="brand" href="#home">' + brandMark() + '<span>' + escapeHtml(SETTINGS.brand_name) + '<span class="brand-sub">University support desk</span></span></a>';
  }
  function showToast(message) {
    var old = document.querySelector(".toast"); if (old) old.remove();
    var toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; document.body.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 4200);
  }
  function go(route) { window.location.hash = route; }

  function renderMaintenance() {
    var reopen = MAINT.reopening_at ? formatDate(MAINT.reopening_at, true) : null;
    app.innerHTML = '<div class="app-noise animate" style="display:grid;place-items:center;min-height:100vh;padding:24px"><main style="max-width:560px;width:100%;text-align:center;padding:48px 30px;border:1px solid var(--line);border-radius:24px;background:var(--card)"><div style="font-size:44px">🛠️</div><div class="eyebrow" style="justify-content:center;display:flex;margin-top:12px">Maintenance</div><h1 class="display" style="font-size:42px;margin-top:12px">' + escapeHtml(MAINT.title) + '</h1><p style="color:var(--muted);line-height:1.7;margin-top:16px">' + escapeHtml(MAINT.message) + '</p>' + (reopen ? '<p style="margin-top:12px;font-size:13px;color:var(--ink-soft)">We expect to reopen around <strong>' + escapeHtml(reopen) + '</strong>.</p>' : "") + '<div style="margin-top:26px"><a class="btn btn-secondary btn-small" href="/admin">Admin sign in</a></div><p style="margin-top:18px;color:var(--muted-2);font-size:11px">All existing tickets and accounts are preserved.</p></main></div>';
  }

  function pageHome() {
    app.innerHTML =
      '<div class="app-noise animate"><header class="topbar wrap">' + shellBrand() + '<div class="topbar-account"><span class="hide-mobile">Already have an account?</span> <a class="btn btn-quiet" href="#student-login">Sign in</a></div></header>' +
      '<main><section class="hero wrap"><div><div class="eyebrow">Student support, made human</div><h1 class="display">' + escapeHtml(SETTINGS.welcome_message) + '</h1><p class="hero-copy">' + escapeHtml(SETTINGS.brand_name) + ' is the university support space for the questions that matter. Start a private conversation, follow its progress, and know who is helping.</p><div class="actions"><a class="btn btn-primary" href="#student-login">Student portal <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="#lecturer-login">Lecturer portal <span aria-hidden="true">→</span></a></div><div class="trust-row"><span>Private by design</span><span>Clear next steps</span></div></div><div class="mock-desk"><div class="mock-window"><div class="mock-head"><div><small>Your support desk</small><strong>Good day, People</strong></div><span class="mock-avatar">SH</span></div><div class="mock-request"><div class="status-line"><b>Active request</b><em>In progress</em></div><h3>Choosing modules for next semester</h3><p>Academic advising · Updated 18 min ago</p><div class="avatar-stack"><span>AO</span><span>MK</span></div></div><div class="mock-stats"><div class="mock-stat"><strong>03</strong><small>Total requests</small></div><div class="mock-stat"><strong>01</strong><small>Resolved</small></div></div></div><div class="mock-note"><i>?</i><span>Every request has a real person on the other side.</span></div></div></section><section class="process"><div class="process-grid wrap"><div><div class="eyebrow">01 / Ask clearly</div><p>Choose a category and tell us what is getting in the way. A few useful details go a long way.</p></div><div><div class="eyebrow">02 / Stay in the loop</div><p>Your request is routed to the right lecturer, with a visible status from open to resolved.</p></div><div><div class="eyebrow">03 / Move forward</div><p>Reply when you need to. Close the conversation when it has helped — or reopen it if something changes.</p></div></div></section><section class="portal-section wrap"><div><div class="eyebrow">Two doors, one standard</div><h2 class="display">Support that respects your time.</h2></div><div class="portal-cards"><article class="portal-card"><div class="card-mark">+</div><h3>For students</h3><p>A private place to ask questions about learning, access, wellbeing, and campus life.</p><a href="#register">Create your account →</a></article><article class="portal-card alt"><div class="card-mark">◐</div><h3>For lecturers</h3><p>An oldest-first queue that keeps the human context attached to every request.</p><a href="#lecturer-login">Open lecturer sign in →</a></article></div></section></main><footer class="footer wrap"><span>' + escapeHtml(SETTINGS.footer_text) + '</span><span>Here to help you continue.</span></footer></div>';
  }

  function pageAuth(mode) {
    if (mode === "register") {
      app.innerHTML = '<div class="auth-page app-noise animate"><header class="topbar wrap">' + shellBrand() + '<a class="btn btn-quiet" href="#home">Back home</a></header><main class="auth-layout"><div class="auth-copy"><div class="eyebrow">Student sign in</div><h1 class="display">Accounts are created at admission.</h1><p>Public registration is closed. Your student account is created by the administrator during school admission — sign in with the matric number and password issued to you.</p><div class="auth-points"><span>Contact the help desk office if your account is missing.</span></div></div><section class="form-card"><div class="eyebrow">Student sign in</div><h2>Registration closed</h2><div class="notice">Student accounts are created by the administrator during admission. Self-registration is disabled.</div><div class="form-foot">Already admitted? <a href="#student-login">Sign in</a></div></section></main></div>';
      return;
    }
    var isLecturer = mode === "lecturer-login";
    var title = isLecturer ? "Welcome back to the queue." : "Welcome back, student.";
    var intro = isLecturer ? "Sign in to work through the requests waiting for your attention." : "Sign in to pick up where you left off with your support team.";
    var label = isLecturer ? "Lecturer sign in" : "Student sign in";
    var fields = "";
    fields += isLecturer ? '<div class="field"><label for="staff-id">Lecturer ID</label><input id="staff-id" required placeholder="e.g. STAFF-1042" /></div>' : '<div class="field"><label for="matric-number">Matric number</label><input id="matric-number" required placeholder="e.g. CSC/2024/0142" /></div>';
    fields += '<div class="field"><label for="password">Password</label><input id="password" required type="password" minlength="6" placeholder="Your account password" /></div>';
    var hint = isLecturer ? '<div class="hint">Lecturer accounts are created by the administrator. Use the exact Lecturer ID issued to you.</div>' : '<div class="hint">Student accounts are created by the administrator during admission. Use your matric number issued by the school.</div>';
    app.innerHTML = '<div class="auth-page app-noise animate"><header class="topbar wrap">' + shellBrand() + '<a class="btn btn-quiet" href="#home">Back home</a></header><main class="auth-layout"><div class="auth-copy"><div class="eyebrow">' + label + '</div><h1 class="display">' + title + '</h1><p>' + intro + '</p><div class="auth-points"><span>Your details stay with the assigned support team.</span><span>You can reply, close, or reopen a request anytime.</span></div></div><section class="form-card"><div class="eyebrow">' + label + '</div><h2>' + "Sign in to " + escapeHtml(SETTINGS.brand_name) + '</h2><div id="auth-error" class="notice hidden"></div><form id="auth-form" class="form-stack">' + fields + hint + '<button class="btn btn-primary" type="submit">Continue <span aria-hidden="true">→</span></button></form><div class="form-foot">Forgot your password? Contact the help desk office.</div></section></main></div>';
    document.getElementById("auth-form").addEventListener("submit", function (event) { event.preventDefault(); handleAuth(mode); });
  }
  function authError(el, msg) { el.textContent = msg; el.classList.remove("hidden"); }
  function logout() {
    if (currentUser && currentUser.userType) {
      api("/api/auth/logout", { method: "POST" }).catch(function () {}).finally(function () {
        currentUser = null; localStorage.removeItem("hd_notif_sound");
        location.replace(location.pathname + "#home");
      });
    }
  }
  function handleAuth(mode) {
    var errorEl = document.getElementById("auth-error");
    errorEl.classList.add("hidden");
    var password = document.getElementById("password").value;
    var reqBody, url;
    if (mode === "lecturer-login") {
      url = "/api/auth/lecturer-login"; reqBody = { staffId: document.getElementById("staff-id").value.trim(), password: password };
    } else { url = "/api/auth/student-login"; reqBody = { matricNumber: document.getElementById("matric-number").value.trim(), password: password }; }
    api(url, { method: "POST", body: reqBody }).then(function (data) {
      currentUser = data.user; selectedTicketId = null;
      go(data.user.userType === "student" ? "#student" : "#lecturer");
    }).catch(function (err) { authError(errorEl, err.message); });
  }

  function summary(tickets) { return { total: tickets.length, open: tickets.filter(function (t) { return t.status === "open"; }).length, inProgress: tickets.filter(function (t) { return t.status === "in_progress"; }).length, resolved: tickets.filter(function (t) { return t.status === "resolved"; }).length, closed: tickets.filter(function (t) { return t.status === "closed"; }).length }; }
  function initialsOf(u) { return u.initials || ((u.fullName || "U").trim().split(/\s+/).slice(0, 2).map(function (p) { return (p[0] || "").toUpperCase(); }).join("")); }

  function pageDesk(role) {
    if (!currentUser || currentUser.userType !== role) return go(role === "student" ? "#student-login" : "#lecturer-login");
    app.innerHTML = '<div class="desk-page animate"><div class="desk-shell"><aside class="side-nav">' + shellBrand() + '<div class="nav-label">Workspace</div><a class="nav-link active" href="#' + role + '"><span class="nav-dot"></span>' + (role === "student" ? "My requests" : "Assigned queue") + '</a><a class="nav-link" href="#' + role + '" data-scroll="summary"><span class="nav-dot"></span>Overview</a><div class="side-help"><strong>' + (role === "student" ? "Need a hand?" : "Response rhythm") + '</strong>' + (role === "student" ? "Choose the person closest to your question. Clear details help us help you faster." : "Start with the oldest request so every student gets a fair next step.") + '</div></aside><main class="desk-main"><header class="desk-topbar"><span class="live-state">Live updates on</span><button class="notif" id="notification-button" aria-label="Notifications"><span aria-hidden="true">🔔</span><span class="badge">' + Math.min(unreadCount, 9) + '</span></button><div class="user-chip"><span>' + escapeHtml(initialsOf(currentUser)) + '</span><div><strong>' + escapeHtml(currentUser.fullName) + '</strong><small>' + escapeHtml(currentUser.department) + '</small></div></div><button class="sign-out" id="sign-out">Sign out</button></header><div class="desk-content"><div class="desk-heading"><div><div class="eyebrow">' + (role === "student" ? "Student support desk" : "Lecturer support desk") + '</div><h1 class="display">' + (role === "student" ? "Welcome back " + escapeHtml((currentUser.fullName || "Student").split(" ")[0]) : "Assigned queue") + '</h1><p>' + (role === "student" ? "A clear place to ask, follow up, and keep moving." : "The oldest request is the next person waiting for you.") + '</p></div>' + (role === "student" ? '<button class="btn btn-primary" id="new-ticket">+ New help request</button>' : '<div class="btn btn-secondary btn-small" id="queue-count">Oldest first</div>') + '</div><div class="summary-grid" id="summary"></div><div class="desk-grid"><section class="panel"><div class="panel-head"><div><h2>' + (role === "student" ? "All help requests" : "Requests waiting on you") + '</h2><p id="list-sub"></p></div><div class="search-wrap"><input class="search-input" id="ticket-search" placeholder="' + (role === "student" ? "Search requests" : "Search queue") + '" /></div></div><div class="ticket-list" id="ticket-list"></div></section><section class="panel detail-panel" id="detail-panel"></section></div></div></main></div></div>';
    updateNotifBadge();
    var list = document.getElementById("ticket-list"); var detail = document.getElementById("detail-panel");
    function paintSummary(tickets) {
      var s = summary(tickets);
      document.getElementById("summary").innerHTML = '<div class="summary-card"><div class="mono">' + String(s.total).padStart(2, "0") + '</div><small>Total requests</small></div><div class="summary-card open"><div class="mono">' + String(s.open).padStart(2, "0") + '</div><small>Open</small></div><div class="summary-card progress"><div class="mono">' + String(s.inProgress).padStart(2, "0") + '</div><small>In progress</small></div><div class="summary-card resolved"><div class="mono">' + String(s.resolved).padStart(2, "0") + '</div><small>Resolved</small></div>';
      document.getElementById("list-sub").textContent = tickets.length + " conversations in your desk";
      var qc = document.getElementById("queue-count"); if (qc) qc.textContent = "Oldest first · " + tickets.length + " waiting";
    }
    function paintList(tickets) {
      var query = (document.getElementById("ticket-search").value || "").toLowerCase();
      var rows = tickets.filter(function (t) { return (t.subject + " " + t.category + " " + (t.student ? t.student.fullName : "")).toLowerCase().indexOf(query) > -1; });
      list.innerHTML = rows.length ? rows.map(function (t) { return ticketRow(t, t.id === selectedTicketId, role === "lecturer"); }).join("") : '<div class="empty-state" style="padding:55px 25px;text-align:center"><div class="empty-mark" style="margin:auto">+</div><h3>' + (role === "student" ? "No requests yet" : "Queue is clear") + '</h3><p>' + (role === "student" ? "Start a conversation when you need a next step." : "There are no tickets assigned to you right now.") + '</p></div>';
      list.querySelectorAll("[data-ticket]").forEach(function (row) { row.addEventListener("click", function () { selectedTicketId = row.getAttribute("data-ticket"); loadTickets(); }); });
    }
    function paintDetail(tickets) {
      var ticket = tickets.find(function (t) { return t.id === selectedTicketId; });
      if (!ticket) { detail.className = "panel detail-panel empty"; detail.innerHTML = '<div class="empty-state"><div class="empty-mark ' + (role === "lecturer" ? "gold" : "") + '">' + (role === "lecturer" ? "✓" : "?") + '</div><h3>' + (role === "lecturer" ? "A thoughtful reply starts here" : "Select a request") + '</h3><p>' + (role === "lecturer" ? "Select a request to read the context and send the next useful step." : "Choose a conversation from the list to see its details and reply.") + '</p></div>'; return; }
      detail.className = "panel detail-panel"; detail.innerHTML = detailMarkup(ticket, role);
      bindDetail(ticket, role);
    }
    function loadTickets() {
      api("/api/tickets").then(function (data) { paintSummary(data.tickets); paintList(data.tickets); paintDetail(data.tickets); }).catch(function (e) { showToast(e.message); });
    }
    function loadNotifications() {
      return api("/api/notifications").then(function (data) {
        var prevUnread = {}; notifications.forEach(function (n) { if (!n.readAt) prevUnread[n.id] = true; });
        notifications = data.notifications; unreadCount = data.unread; updateNotifBadge();
        notifications.forEach(function (n) {
          if (!n.readAt && (n.sound && n.sound !== "none") && soundEnabled() && !playedIds[n.id] && !n.soundPlayed) {
            playSound(n.sound); playedIds[n.id] = true; savePlayed();
            api("/api/notifications/" + encodeURIComponent(n.id) + "/sound-played", { method: "POST" }).catch(function () {});
          }
        });
      }).catch(function () {});
    }
    var debounce; document.getElementById("ticket-search").addEventListener("input", function () { clearTimeout(debounce); debounce = setTimeout(loadTickets, 200); });
    document.getElementById("sign-out").addEventListener("click", function () { api("/api/auth/logout", { method: "POST" }).finally(function () { currentUser = null; selectedTicketId = null; stopPoll(); go("#home"); }); });
    document.getElementById("notification-button").addEventListener("click", openNotifCenter);
    if (role === "student") document.getElementById("new-ticket").addEventListener("click", openNewTicket);
    loadTickets(); loadNotifications();
    stopPoll(); pollTimer = setInterval(function () {
      var active = document.activeElement;
      var typing = active && (active.id === "student-reply" || active.id === "lecturer-response" || active.id === "ticket-search");
      var hash = window.location.hash;
      if ((hash === "#student" || hash === "#lecturer") && !typing) { loadTickets(); }
      loadNotifications();
    }, 15000);
    window.__deskLoad = loadTickets;
  }
  function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function updateNotifBadge() {
    var btn = document.getElementById("notification-button"); if (!btn) return;
    var badge = btn.querySelector(".badge");
    if (unreadCount > 0) { btn.classList.add("has-badge"); badge.textContent = Math.min(unreadCount, 9); } else { btn.classList.remove("has-badge"); }
  }
  function playSound(soundId) {
    if (!soundId || soundId === "none" || !soundEnabled()) return;
    var file = soundId + (soundId.indexOf(".") > -1 ? "" : ".wav");
    try {
      var audio = new Audio("/assets/sounds/" + encodeURIComponent(file));
      var p = audio.play(); if (p && p.catch) p.catch(function () {});
    } catch (_) {}
  }
  function openNotifCenter() {
    var backdrop = document.createElement("div"); backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<section class="modal" style="max-width:520px"><div class="modal-head"><div><div class="eyebrow">Inbox</div><h2 style="font-size:22px">Notifications</h2></div><button class="close-modal" aria-label="Close">×</button></div><div style="padding:18px 22px;display:grid;gap:12px"><label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="sound-toggle" ' + (soundEnabled() ? "checked" : "") + ' /> Enable notification sounds on this device</label><div id="notif-list">' + (notifications.length ? notifications.map(function (n) { return '<div style="padding:12px;border:1px solid var(--line-light);border-radius:12px;background:' + (!n.readAt ? "#f4f0e8" : "transparent") + '"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">' + escapeHtml(n.title) + '</strong><time style="font-size:10px;color:var(--muted-2)">' + formatDate(n.createdAt, true) + '</time></div><p style="margin:6px 0 0;font-size:12px;color:var(--ink-soft)">' + escapeHtml(n.message) + '</p><div style="margin-top:8px;font-size:11px;color:var(--muted)">' + (n.readAt ? "Read" : "Unread") + (n.sound && n.sound !== "none" ? " · Sound: " + escapeHtml(n.sound) : "") + '</div></div>'; }).join("") : '<p style="color:var(--muted);font-size:13px">No notifications yet.</p>') + '</div></div></section>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".close-modal").addEventListener("click", function () { backdrop.remove(); });
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) backdrop.remove(); });
    var toggle = document.getElementById("sound-toggle");
    toggle.addEventListener("change", function () {
      localStorage.setItem("hd_notif_sound", toggle.checked ? "1" : "0");
      if (toggle.checked) { var a = new Audio("/assets/sounds/default.wav"); var p = a.play(); if (p && p.catch) p.catch(function () {}); }
    });
    Promise.all(notifications.filter(function (n) { return !n.readAt; }).map(function (n) { return api("/api/notifications/" + encodeURIComponent(n.id) + "/read", { method: "POST" }).catch(function () {}); })).then(function () { unreadCount = 0; updateNotifBadge(); });
  }

  function ticketRow(ticket, selected, queue) {
    return '<button class="ticket-row ' + (selected ? "selected" : "") + '" data-ticket="' + escapeHtml(ticket.id) + '"><div class="ticket-top"><span class="ticket-id">' + escapeHtml(ticket.id) + '</span>' + statusPill(ticket.status) + '</div><h3>' + escapeHtml(ticket.subject) + '</h3><p>' + escapeHtml(queue ? (ticket.student.fullName + " · " + ticket.student.department) : (ticket.lecturer.fullName + " · " + (ticket.lecturerStaffId || ticket.lecturer.staffId))) + '</p><div class="ticket-meta"><span>' + escapeHtml(ticket.category) + '</span><span>·</span><span>' + formatDate(ticket.createdAt, true) + '</span></div></button>';
  }
  function detailMarkup(ticket, role) {
    var messages = ticket.messages.map(function (m) { return '<article class="message ' + (m.authorType === role ? "mine" : "") + '"><div class="message-author"><span>' + escapeHtml(m.authorName) + '</span><time>' + formatDate(m.createdAt, true) + '</time></div><p>' + escapeHtml(m.message) + '</p></article>'; }).join("");
    var info = role === "lecturer" ? '<div class="student-info"><span class="small-label">Student details</span><div class="student-info-grid"><div><span>Name</span><strong>' + escapeHtml(ticket.student.fullName) + '</strong></div><div><span>Matric number</span><strong>' + escapeHtml(ticket.student.matricNumber) + '</strong></div><div><span>Department</span><strong>' + escapeHtml(ticket.student.department) + '</strong></div><div><span>Submitted</span><strong>' + formatDate(ticket.createdAt, false) + '</strong></div></div></div>' : "";
    var actions = role === "student" ? '<div class="detail-actions"><div class="inline-actions">' + (ticket.status === "resolved" ? '<button class="btn btn-secondary btn-small" id="close-ticket">Close ticket</button>' : "") + (ticket.status === "closed" || ticket.status === "resolved" ? '<button class="btn btn-quiet btn-small" id="reopen-ticket">Reply and reopen</button>' : "") + '</div>' + (ticket.status === "closed" || ticket.status === "resolved" ? '<form id="student-reply-form" class="hidden"><textarea id="student-reply" placeholder="Tell the lecturer what still needs attention..." required></textarea><div class="actions-row"><span style="color:var(--muted);font-size:10px">Your reply will reopen this request.</span><button class="btn btn-primary btn-small" type="submit">Send reply</button></div></form>' : "") + '</div>' : '<div class="detail-actions"><form id="lecturer-response-form"><div class="actions-row"><div class="status-control"><label for="response-status">Status</label><select id="response-status"><option value="open" ' + (ticket.status === "open" ? "selected" : "") + '>Open</option><option value="in_progress" ' + (ticket.status === "in_progress" ? "selected" : "") + '>In progress</option><option value="resolved" ' + (ticket.status === "resolved" ? "selected" : "") + '>Resolved</option></select></div><span style="color:var(--muted-2);font-size:10px">' + formatDate(ticket.updatedAt, true) + '</span></div><textarea id="lecturer-response" placeholder="Write a clear, helpful response to the student..." required></textarea><div class="actions-row"><span style="color:var(--muted);font-size:10px">A response is sent instantly.</span><button class="btn btn-primary btn-small" type="submit">Send response</button></div></form></div>';
    return '<div class="detail-head"><div class="detail-head-row"><div><span class="ticket-id">' + escapeHtml(ticket.id) + '</span><h2>' + escapeHtml(ticket.subject) + '</h2><div class="detail-meta">' + escapeHtml(ticket.category) + ' · Routed to ' + escapeHtml(ticket.lecturer.fullName) + ' (' + escapeHtml(ticket.lecturerStaffId || ticket.lecturer.staffId) + ')</div></div>' + statusPill(ticket.status) + '</div></div><div class="conversation">' + messages + '</div>' + info + actions;
  }
  function bindDetail(ticket, role) {
    if (role === "student") {
      var close = document.getElementById("close-ticket");
      if (close) close.addEventListener("click", function () { api("/api/tickets/" + encodeURIComponent(ticket.id) + "/status", { method: "POST", body: { status: "closed" } }).then(function () { showToast("Ticket archived"); window.__deskLoad && window.__deskLoad(); }).catch(function (e) { showToast(e.message); }); });
      var reopen = document.getElementById("reopen-ticket"), form = document.getElementById("student-reply-form");
      if (reopen) reopen.addEventListener("click", function () { form.classList.toggle("hidden"); if (!form.classList.contains("hidden")) document.getElementById("student-reply").focus(); });
      if (form) form.addEventListener("submit", function (e) { e.preventDefault(); var text = document.getElementById("student-reply").value.trim(); if (!text) return; api("/api/tickets/" + encodeURIComponent(ticket.id) + "/reply", { method: "POST", body: { message: text } }).then(function () { showToast("Ticket reopened and lecturer notified"); window.__deskLoad && window.__deskLoad(); }).catch(function (err) { showToast(err.message); }); });
    } else {
      var f = document.getElementById("lecturer-response-form");
      if (f) f.addEventListener("submit", function (e) { e.preventDefault(); var text = document.getElementById("lecturer-response").value.trim(); if (!text) return; var status = document.getElementById("response-status").value; api("/api/tickets/" + encodeURIComponent(ticket.id) + "/reply", { method: "POST", body: { message: text, status: status } }).then(function () { showToast("Student notified of a new response"); window.__deskLoad && window.__deskLoad(); }).catch(function (err) { showToast(err.message); }); });
    }
  }
  function openNewTicket() {
    api("/api/lecturers/directory").catch(function () { return { lecturers: [] }; }).then(function (data) {
      var backdrop = document.createElement("div"); backdrop.className = "modal-backdrop";
      backdrop.innerHTML = '<section class="modal animate"><div class="modal-head"><div><div class="eyebrow">Start a conversation</div><h2>What can we help with?</h2></div><button class="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="new-ticket-form"><div class="field"><label for="ticket-category">Issue category</label><select id="ticket-category"><option>Missing Grades</option><option>Timetable Clash</option><option>Assignment Issues</option><option>Academic advising</option><option>Fees and finance</option><option>Technology support</option><option>Wellbeing and access</option></select></div><div class="field"><label for="lecturer-id">Lecturer ID</label><input id="lecturer-id" list="lecturer-id-list" required placeholder="e.g. STAFF-1042" autocomplete="off" /><datalist id="lecturer-id-list">' + (data.lecturers || []).map(function (l) { return '<option value="' + escapeHtml(l.staffId) + '">' + escapeHtml(l.fullName) + " · " + escapeHtml(l.department) + '</option>'; }).join("") + '</datalist><small class="field-help">Enter the exact ID the lecturer used during registration. The ticket will be routed to that lecturer.</small></div><div class="field"><label for="ticket-subject">Subject</label><input id="ticket-subject" required minlength="2" placeholder="Give your request a clear heading" /></div><div class="field"><label for="ticket-message">Message</label><textarea id="ticket-message" required minlength="5" placeholder="What have you tried, and what would a helpful next step look like?"></textarea></div><div class="form-actions"><button type="button" class="btn btn-quiet btn-small" id="cancel-ticket">Cancel</button><button type="submit" class="btn btn-primary btn-small">Send request</button></div></form></section></div>';
      document.body.appendChild(backdrop);
      var close = function () { backdrop.remove(); };
      backdrop.querySelector(".close-modal").addEventListener("click", close); backdrop.querySelector("#cancel-ticket").addEventListener("click", close);
      backdrop.querySelector("#new-ticket-form").addEventListener("submit", function (e) {
        e.preventDefault();
        api("/api/tickets", { method: "POST", body: { category: document.getElementById("ticket-category").value, lecturerId: document.getElementById("lecturer-id").value.trim(), subject: document.getElementById("ticket-subject").value.trim(), message: document.getElementById("ticket-message").value.trim() } })
          .then(function (res) { close(); selectedTicketId = res.ticket.id; showToast("New request routed to " + res.ticket.lecturer.fullName); window.__deskLoad && window.__deskLoad(); })
          .catch(function (err) { showToast(err.message); });
      });
    });
  }

  function route() {
    if (MAINT.enabled) { renderMaintenance(); return; }
    var hash = (window.location.hash || "#home").slice(1);
    if (hash === "student" || hash === "lecturer") return pageDesk(hash);
    if (hash === "student-login" || hash === "lecturer-login" || hash === "register") return pageAuth(hash);
    pageHome();
  }
  window.addEventListener("hashchange", route);

  function migrateLocalIfNeeded() {
    var raw = localStorage.getItem(DB_KEY);
    if (!raw) return Promise.resolve();
    try {
      var db = JSON.parse(raw);
      if (!db || (!db.students && !db.lecturers)) return Promise.resolve();
      return api("/api/migrate-local", { method: "POST", body: { students: db.students || [], lecturers: db.lecturers || [], tickets: db.tickets || [] } })
        .then(function (res) {
          if (res.importedStudents || res.importedLecturers) showToast("Imported " + (res.importedStudents + res.importedLecturers) + " accounts from your previous browser data.");
          localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY);
        }).catch(function () {});
    } catch (_) { return Promise.resolve(); }
  }

  function bootstrap() {
    fetch("/api/public", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (data) {
      SETTINGS = Object.assign(SETTINGS, data.settings || {});
      MAINT = Object.assign(MAINT, data.maintenance || {});
      SOUNDS = data.sounds || SOUNDS;
      csrfToken = data.csrf;
      applySettings();
      return migrateLocalIfNeeded();
    }).then(function () {
      return api("/api/me").then(function (data) { currentUser = data.user; if (currentUser && currentUser.userType === "admin") currentUser = null; }).catch(function () { currentUser = null; });
    }).then(function () {
      route();
      if (MAINT.enabled) showToast("The help desk is currently under maintenance.");
    }).catch(function () {
      app.innerHTML = '<div style="padding:60px 20px;text-align:center"><h2>Unable to load the help desk.</h2><p>Please check your connection and refresh.</p></div>';
    });
  }
  bootstrap();
})();
