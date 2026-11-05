(function () {
  "use strict";
  var app = document.getElementById("app");
  var toastWrap = document.getElementById("toast-wrap");
  var csrfToken = null;
  var me = null;
  var route = "dashboard";
  var qr = { q: "", department: "", status: "" };
  var sr = { q: "", department: "" };
  var tr = { q: "", status: "", department: "", lecturer: "" };
  var nsel = { type: "all_students", selected: {}, q: "", dept: "" };
  var preview = null;
  var expandedTicket = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]; }); }
  function fmt(d, t) { var x = new Date(d); if (Number.isNaN(x.getTime())) return esc(d); return new Intl.DateTimeFormat("en-NG", t ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }).format(x); }
  function statusPill(s) { return '<span class="status status-' + s + '">' + esc(s === "in_progress" ? "In progress" : s.charAt(0).toUpperCase() + s.slice(1)) + "</span>"; }
  function toast(msg, type) {
    var t = document.createElement("div"); t.className = "toast " + (type || "ok"); t.textContent = msg;
    toastWrap.appendChild(t); setTimeout(function () { t.remove(); }, 4200);
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: "same-origin" })
      .then(function (resp) { return resp.json().catch(function () { return {}; }).then(function (data) { if (!resp.ok) { var e = new Error(data.error || ("Request failed (" + resp.status + ")")); e.status = resp.status; e.data = data; throw e; } return data; }); });
  }
  function confirmDlg(title, message, confirmLabel, danger) {
    return new Promise(function (resolve) {
      var bd = document.createElement("div"); bd.className = "modal-backdrop";
      bd.innerHTML = '<div class="modal" style="width:min(460px,100%)"><div class="modal-head"><div><div class="eyebrow">Confirm</div><h2>' + esc(title) + '</h2></div><button class="close-x" aria-label="Close">×</button></div><div class="modal-body"><p style="margin:0;font-size:13px;line-height:1.7;color:var(--muted)">' + esc(message) + '</p><div style="display:flex;justify-content:flex-end;gap:9px"><button class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn ' + (danger ? "btn-danger" : "btn-primary") + ' btn-small" data-y>' + esc(confirmLabel || "Confirm") + '</button></div></div></div>';
      document.body.appendChild(bd);
      bd.querySelector(".close-x").addEventListener("click", function () { bd.remove(); resolve(false); });
      bd.querySelector("[data-x]").addEventListener("click", function () { bd.remove(); resolve(false); });
      bd.querySelector("[data-y]").addEventListener("click", function () { bd.remove(); resolve(true); });
    });
  }
  function modal(html, wide) {
    var bd = document.createElement("div"); bd.className = "modal-backdrop";
    bd.innerHTML = '<div class="modal" style="' + (wide ? "width:min(760px,100%)" : "") + '">' + html + "</div>";
    document.body.appendChild(bd);
    bd.querySelector(".close-x").addEventListener("click", function () { bd.remove(); });
    bd.addEventListener("click", function (e) { if (e.target === bd) bd.remove(); });
    return bd;
  }

  /* ---------- login ---------- */
  function pageLogin() {
    app.innerHTML = '<div class="login-wrap"><div class="login-card"><div class="eyebrow">Administration</div><h1>Admin sign in</h1><p>Sign in to manage lecturers, students, tickets, notifications, and website settings. Your session is protected by a secure HTTP-only cookie.</p><div id="err" class="notice hidden"></div><form id="login-form"><div class="field"><label for="u">Username</label><input id="u" required autocomplete="username" /></div><div class="field"><label for="p">Password</label><input id="p" type="password" required autocomplete="current-password" /></div><button class="btn btn-primary btn-block" type="submit">Sign in →</button></form><div class="login-foot"><a href="/">← Back to website</a></div></div></div>';
    $("#login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      api("/api/auth/admin-login", { method: "POST", body: { username: $("#u").value.trim(), password: $("#p").value } })
        .then(function (data) { me = data.user; toast("Signed in as " + me.displayName); if (me.mustChangePassword) setTimeout(function () { profileForm(); }, 300); renderShell(); })
        .catch(function (err) { var el = $("#err"); el.textContent = err.message; el.classList.remove("hidden"); });
    });
  }

  /* ---------- shell ---------- */
  var NAV = [["dashboard", "Dashboard"], ["lecturers", "Lecturers"], ["students", "Students"], ["tickets", "Tickets"], ["notifications", "Notifications"], ["website", "Website Control"], ["settings", "Branding & Settings"], ["logs", "Activity Logs"], ["profile", "Admin Profile"]];
  function renderShell() {
    var sideStatus = window.__maintOn ? '<span class="pill off">Maintenance ON</span>' : '<span class="pill on">Online</span>';
    app.innerHTML = '<div class="shell"><aside class="sidebar"><a class="brand" href="#"><span class="brand-mark">⌂</span><span><strong>Help Desk</strong><small>Admin Panel</small></span></a><div class="nav-label">Manage</div>' +
      NAV.map(function (n) { return '<a class="nav-link ' + (route === n[0] ? "active" : "") + '" href="#" data-r="' + n[0] + '"><span class="nav-dot"></span>' + n[1] + "</a>"; }).join("") +
      '<a class="nav-link" href="#" id="logout-link"><span class="nav-dot"></span>Logout</a><div class="side-status">Website status: ' + sideStatus + '</div></aside><main class="main"><header class="topbar"><h1>' + NAV.filter(function (n) { return n[0] === route; }).map(function (n) { return n[1]; })[0] + '</h1><div class="user-chip"><span class="avatar">' + esc((me.displayName || "A").slice(0, 2).toUpperCase()) + '</span><div><strong style="font-size:12px">' + esc(me.displayName) + '</strong><div style="font-size:10px;color:var(--muted2)">' + esc(me.username) + '</div></div></div></header><div class="content" id="content"><div class="boot"><div class="spinner"></div></div></div></main></div>';
    $$(".nav-link[data-r]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); route = a.getAttribute("data-r"); renderShell(); }); });
    $("#logout-link").addEventListener("click", function (e) {
      e.preventDefault();
      confirmDlg("Sign out?", "You will need to sign in again to access the admin panel.", "Sign out").then(function (ok) {
        if (!ok) return;
        api("/api/auth/logout", { method: "POST" }).finally(function () { me = null; pageLogin(); });
      });
    });
    ({ dashboard: pageDashboard, lecturers: pageLecturers, students: pageStudents, tickets: pageTickets, notifications: pageNotifications, website: pageWebsite, settings: pageSettings, logs: pageLogs, profile: pageProfile })[route]();
  }

  function pageDashboard() {
    var c = $("#content");
    api("/api/admin/overview").then(function (d) {
      window.__maintOn = !!d.maintenance.enabled;
      var s = d.byStatus;
      c.innerHTML =
        '<div class="summary-grid">' +
        '<div class="card"><div class="mono">' + d.students + '</div><small>Total students</small></div>' +
        '<div class="card"><div class="mono">' + d.lecturers + '</div><small>Total lecturers (' + d.activeLecturers + " active, " + d.inactiveLecturers + ' inactive)</small></div>' +
        '<div class="card"><div class="mono">' + d.tickets + '</div><small>Total tickets — ' + (s.open || 0) + ' open, ' + (s.in_progress || 0) + ' in progress, ' + (s.resolved || 0) + ' resolved, ' + (s.closed || 0) + ' closed</small></div>' +
        '<div class="card"><div class="mono" style="color:' + (d.maintenance.enabled ? "var(--gold)" : "var(--green)") + '">' + (d.maintenance.enabled ? "Maintenance" : "Online") + '</div><small>Website status — ' + esc(d.maintenance.title) + '</small></div></div>' +
        '<div class="two-col">' +
        '<div class="panel"><div class="panel-head"><div><h2>Recent students</h2></div><a class="btn btn-quiet btn-small" href="#" data-go="students">Manage →</a></div>' + (d.recentStudents.length ? d.recentStudents.map(function (x) { return '<div class="log-row"><span>' + fmt(x.created_at) + '</span><strong>' + esc(x.full_name) + '</strong><span>' + esc(x.matric_number) + '</span><span></span></div>'; }).join("") : '<div class="empty">No students yet.</div>') + "</div>" +
        '<div class="panel"><div class="panel-head"><div><h2>Recent tickets</h2></div><a class="btn btn-quiet btn-small" href="#" data-go="tickets">Manage →</a></div>' + (d.recentTickets.length ? d.recentTickets.map(function (x) { return '<div class="log-row"><span>' + fmt(x.created_at) + '</span><strong>' + esc(x.id) + " · " + esc(x.subject) + '</strong><span>' + statusPill(x.status) + '</span><span></span></div>'; }).join("") : '<div class="empty">No tickets yet.</div>') + "</div>" +
        '<div class="panel"><div class="panel-head"><div><h2>Recent lecturer responses</h2></div></div>' + (d.recentLecturerResponses.length ? d.recentLecturerResponses.map(function (x) { return '<div class="log-row"><span>' + fmt(x.created_at, true) + '</span><strong>' + esc(x.author_name) + '</strong><span style="color:var(--muted)">' + esc(x.message) + '</span><span>' + esc(x.ticket_id) + '</span></div>'; }).join("") : '<div class="empty">No responses yet.</div>') + "</div>" +
        '<div class="panel"><div class="panel-head"><div><h2>Recent notifications</h2></div><a class="btn btn-quiet btn-small" href="#" data-go="notifications">Manage →</a></div>' + (d.recentNotifs.length ? d.recentNotifs.map(function (x) { return '<div class="log-row"><span>' + fmt(x.created_at) + '</span><strong>' + esc(x.title) + '</strong><span>' + esc(x.recipient_type) + '</span><span></span></div>'; }).join("") : '<div class="empty">No notifications sent yet.</div>') + "</div>" +
        '<div class="panel"><div class="panel-head"><div><h2>Recent admin activity</h2></div><a class="btn btn-quiet btn-small" href="#" data-go="logs">View logs →</a></div>' + (d.recentActivity.length ? d.recentActivity.map(function (x) { return '<div class="log-row"><span>' + fmt(x.created_at, true) + '</span><strong>' + esc(x.admin_username) + '</strong><span>' + esc(x.action) + '</span><span>' + esc(x.target) + '</span></div>'; }).join("") : '<div class="empty">No activity yet.</div>') + "</div>" +
        "</div>";
      $$("[data-go]", c).forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); route = a.getAttribute("data-go"); renderShell(); }); });
    }).catch(function (e) { c.innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
  }

  /* ---------- lecturers ---------- */
  function loadLecturers() {
    var params = new URLSearchParams(qr);
    api("/api/admin/lecturers?" + params.toString()).then(function (d) {
      var rows = d.lecturers;
      var depts = Array.from(new Set(rows.map(function (l) { return l.department; })));
      $("#lect-table tbody").innerHTML = rows.length ? rows.map(function (l) {
        return '<tr><td><strong>' + esc(l.fullName) + '</strong><div style="font-size:11px;color:var(--muted2)">' + esc(l.staffId) + '</div></td><td>' + esc(l.email) + '</td><td>' + esc(l.department) + '</td><td>' + (l.active ? '<span class="pill on">Active</span>' : '<span class="pill off">Inactive</span>') + '</td><td>' + l.ticketCount + '</td><td>' + fmt(l.createdAt) + '</td><td><div class="row-actions"><button class="btn btn-secondary btn-small" data-a="view" data-id="' + l.id + '">View</button><button class="btn btn-secondary btn-small" data-a="edit" data-id="' + l.id + '">Edit</button><button class="btn btn-secondary btn-small" data-a="pass" data-id="' + l.id + '">Reset password</button><button class="btn btn-secondary btn-small" data-a="toggle" data-id="' + l.id + '">' + (l.active ? "Deactivate" : "Activate") + '</button><button class="btn btn-danger btn-small" data-a="del" data-id="' + l.id + '">Delete</button></div></td></tr>';
      }).join("") : '<tr><td colspan="7"><div class="empty">No lecturers found.</div></td></tr>';
      $$("[data-a]", $("#lect-table")).forEach(function (b) { b.addEventListener("click", function () { lecturerAction(b.getAttribute("data-a"), b.getAttribute("data-id"), rows); }); });
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function pageLecturers() {
    var c = $("#content");
    c.innerHTML = '<div class="toolbar"><h2>Lecturer management</h2><button class="btn btn-primary btn-small" id="add-lec">+ Add lecturer</button></div><div class="panel"><div class="panel-head"><div class="filters"><input class="input" id="f-q" placeholder="Search name or staff ID…" value="' + esc(qr.q) + '" /><select class="input" id="f-dept"><option value="">All departments</option></select><select class="input" id="f-status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div><div style="overflow:auto"><table id="lect-table"><thead><tr><th>Lecturer</th><th>Email</th><th>Department</th><th>Status</th><th>Tickets</th><th>Created</th><th>Actions</th></tr></thead><tbody></tbody></table></div></div>';
    api("/api/admin/lecturers").then(function (d) {
      var depts = Array.from(new Set(d.lecturers.map(function (l) { return l.department; })));
      var sel = $("#f-dept");
      depts.forEach(function (x) { var o = document.createElement("option"); o.value = x; o.textContent = x; if (qr.department === x) o.selected = true; sel.appendChild(o); });
      $("#f-status").value = qr.status || "";
    }).catch(function () {});
    var t; $("#f-q").addEventListener("input", function (e) { clearTimeout(t); t = setTimeout(function () { qr.q = e.target.value; loadLecturers(); }, 250); });
    $("#f-dept").addEventListener("change", function (e) { qr.department = e.target.value; loadLecturers(); });
    $("#f-status").addEventListener("change", function (e) { qr.status = e.target.value; loadLecturers(); });
    $("#add-lec").addEventListener("click", function () { lecturerForm(null); });
    loadLecturers();
  }
  function lecturerForm(lecturer) {
    var isEdit = !!lecturer;
    var bd = modal('<div class="modal-head"><div><div class="eyebrow">' + (isEdit ? "Edit lecturer" : "New lecturer") + '</div><h2>' + (isEdit ? esc(lecturer.fullName) : "Create lecturer account") + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><form id="lf"><div class="field"><label>Full name</label><input name="fullName" required value="' + esc(isEdit ? lecturer.fullName : "") + '" /></div><div class="field"><label>Staff ID (unique)</label><input name="staffId" required value="' + esc(isEdit ? lecturer.staffId : "") + '" /></div><div class="field"><label>Email</label><input name="email" type="email" required value="' + esc(isEdit ? lecturer.email : "") + '" /></div><div class="field"><label>Department</label><input name="department" required value="' + esc(isEdit ? lecturer.department : "") + '" /></div><div class="field"><label>Phone (optional)</label><input name="phone" value="' + esc(isEdit ? (lecturer.phone || "") : "") + '" /></div>' + (isEdit ? "" : '<div class="field"><label>Password (min 8 characters) — the lecturer can sign in immediately</label><input name="password" type="password" minlength="8" required /></div>') + '<div class="field"><label>Account status</label><select name="active"><option value="1">Active</option><option value="0">Inactive</option></select></div>' + (isEdit ? "" : '<div class="warn">The account becomes available for lecturer login immediately after creation.</div>') + '<div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-primary btn-small" type="submit">' + (isEdit ? "Save changes" : "Create lecturer") + '</button></div></form></div>');
    bd.querySelector("[data-x]").addEventListener("click", function () { bd.remove(); });
    var fd = bd.querySelector("select[name=active]"); if (fd) fd.value = isEdit && !lecturer.active ? "0" : "1";
    bd.querySelector("#lf").addEventListener("submit", function (e) {
      e.preventDefault(); var f = Object.fromEntries(new FormData(this).entries());
      var p = isEdit ? api("/api/admin/lecturers/" + encodeURIComponent(lecturer.id), { method: "PATCH", body: f }) : api("/api/admin/lecturers", { method: "POST", body: { fullName: f.fullName, staffId: f.staffId, email: f.email, department: f.department, phone: f.phone, password: f.password, active: f.active === "1" } });
      p.then(function () { bd.remove(); toast(isEdit ? "Lecturer updated." : "Lecturer created and can sign in now."); loadLecturers(); }).catch(function (err) { toast(err.message, "err"); });
    });
  }
  function lecturerAction(a, id, rows) {
    var l = rows.find(function (x) { return x.id === id; }); if (!l) return;
    if (a === "view") {
      modal('<div class="modal-head"><div><div class="eyebrow">Lecturer profile</div><h2>' + esc(l.fullName) + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><dl class="kv"><dt>Staff ID</dt><dd>' + esc(l.staffId) + '</dd><dt>Email</dt><dd>' + esc(l.email) + '</dd><dt>Department</dt><dd>' + esc(l.department) + '</dd><dt>Phone</dt><dd>' + esc(l.phone || "—") + '</dd><dt>Status</dt><dd>' + (l.active ? "Active" : "Inactive") + '</dd><dt>Tickets</dt><dd>' + l.ticketCount + '</dd><dt>Created</dt><dd>' + fmt(l.createdAt) + '</dd><dt>Last login</dt><dd>' + (l.lastLoginAt ? fmt(l.lastLoginAt, true) : "—") + '</dd></dl></div>');
    } else if (a === "edit") lecturerForm(l);
    else if (a === "toggle") {
      confirmDlg(l.active ? "Deactivate lecturer?" : "Activate lecturer?", l.active ? "The lecturer will no longer be able to sign in, but their historical tickets and responses are preserved." : "The lecturer will be able to sign in again.", l.active ? "Deactivate" : "Activate").then(function (ok) {
        if (!ok) return;
        api("/api/admin/lecturers/" + encodeURIComponent(id) + (l.active ? "/deactivate" : "/activate"), { method: "POST" }).then(function () { toast("Lecturer " + (l.active ? "deactivated" : "activated") + "."); loadLecturers(); }).catch(function (e) { toast(e.message, "err"); });
      });
    } else if (a === "pass") {
      var bd = modal('<div class="modal-head"><div><div class="eyebrow">Reset password</div><h2>' + esc(l.fullName) + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><form id="pf"><div class="field"><label>New password (min 8)</label><input name="newPassword" type="password" minlength="8" required /></div><div class="warn">The current password is never displayed. The new password is hashed with scrypt on the server.</div><div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-primary btn-small" type="submit">Reset password</button></div></form></div>');
      bd.querySelector("[data-x]").addEventListener("click", function () { bd.remove(); });
      bd.querySelector("#pf").addEventListener("submit", function (e) { e.preventDefault(); var pw = new FormData(this).get("newPassword"); api("/api/admin/lecturers/" + encodeURIComponent(id) + "/password", { method: "POST", body: { newPassword: pw } }).then(function () { bd.remove(); toast("Password reset."); }).catch(function (err) { toast(err.message, "err"); }); });
    } else if (a === "del") {
      var msg = l.ticketCount > 0 ? "This lecturer owns " + l.ticketCount + " tickets. Deleting will soft-delete the account: the lecturer can no longer sign in and their sessions are revoked. You must choose a lecturer to reassign those tickets to. Historical messages are preserved." : "This lecturer has no tickets. The account will be soft-deleted: the lecturer can no longer sign in and their sessions are revoked. History remains intact.";
      var bd2 = modal('<div class="modal-head"><div><div class="eyebrow">Delete lecturer</div><h2>' + esc(l.fullName) + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><div class="warn">' + esc(msg) + '</div>' + (l.ticketCount > 0 ? '<div class="field"><label>Reassign tickets to (Staff ID)</label><input id="reassign" placeholder="e.g. STAFF-1042" /></div>' : "") + '<div style="display:flex;justify-content:flex-end;gap:9px"><button class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-danger btn-small" data-y>Delete account</button></div></div>');
      bd2.querySelector("[data-x]").addEventListener("click", function () { bd2.remove(); });
      bd2.querySelector("[data-y]").addEventListener("click", function () {
        var reassignEl = bd2.querySelector("#reassign");
        api("/api/admin/lecturers/" + encodeURIComponent(id), { method: "DELETE", body: { reassignTo: reassignEl ? reassignEl.value.trim() : "" } }).then(function () { bd2.remove(); toast("Lecturer deleted."); loadLecturers(); }).catch(function (e) { toast(e.message, "err"); });
      });
    }
  }

  /* ---------- students ---------- */
  function loadStudents() {
    var params = new URLSearchParams(sr);
    api("/api/admin/students?" + params.toString()).then(function (d) {
      var rows = d.students;
      $("#stu-table tbody").innerHTML = rows.length ? rows.map(function (s) {
        return '<tr><td><strong>' + esc(s.fullName) + '</strong><div style="font-size:11px;color:var(--muted2)">' + esc(s.matricNumber) + '</div></td><td>' + esc(s.email) + '</td><td>' + esc(s.department) + '</td><td>' + (s.active ? '<span class="pill on">Active</span>' : '<span class="pill off">Suspended</span>') + '</td><td>' + s.ticketCount + '</td><td><div class="row-actions"><button class="btn btn-secondary btn-small" data-a="view" data-id="' + s.id + '">View</button><button class="btn btn-secondary btn-small" data-a="edit" data-id="' + s.id + '">Edit</button><button class="btn btn-secondary btn-small" data-a="pass" data-id="' + s.id + '">Reset password</button><button class="btn btn-secondary btn-small" data-a="toggle" data-id="' + s.id + '">' + (s.active ? "Suspend" : "Activate") + '</button><button class="btn btn-danger btn-small" data-a="del" data-id="' + s.id + '">Delete</button></div></td></tr>';
      }).join("") : '<tr><td colspan="6"><div class="empty">No students found.</div></td></tr>';
      $$("[data-a]", $("#stu-table")).forEach(function (b) { b.addEventListener("click", function () { studentAction(b.getAttribute("data-a"), b.getAttribute("data-id"), rows); }); });
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function pageStudents() {
    var c = $("#content");
    c.innerHTML = '<div class="toolbar"><h2>Student management</h2><button class="btn btn-primary btn-small" id="add-stu">+ Admit student</button></div><div class="warn" style="margin-bottom:14px">Public self-registration is disabled. Create each student account here during school admission — they can sign in immediately with the matric number and password you set.</div><div class="panel"><div class="panel-head"><div class="filters"><input class="input" id="f-q" placeholder="Search name, matric, email, department…" value="' + esc(sr.q) + '" /><select class="input" id="f-dept"><option value="">All departments</option></select></div></div><div style="overflow:auto"><table id="stu-table"><thead><tr><th>Student</th><th>Email</th><th>Department</th><th>Status</th><th>Tickets</th><th>Actions</th></tr></thead><tbody></tbody></table></div></div>';
    api("/api/admin/students").then(function (d) {
      var depts = Array.from(new Set(d.students.map(function (s) { return s.department; })));
      var sel = $("#f-dept"); depts.forEach(function (x) { var o = document.createElement("option"); o.value = x; o.textContent = x; if (sr.department === x) o.selected = true; sel.appendChild(o); });
    }).catch(function () {});
    var t; $("#f-q").addEventListener("input", function (e) { clearTimeout(t); t = setTimeout(function () { sr.q = e.target.value; loadStudents(); }, 250); });
    $("#f-dept").addEventListener("change", function (e) { sr.department = e.target.value; loadStudents(); });
    $("#add-stu").addEventListener("click", function () { studentForm(null); });
    loadStudents();
  }
  function studentForm(student) {
    var isEdit = !!student;
    var bd = modal('<div class="modal-head"><div><div class="eyebrow">' + (isEdit ? "Edit student" : "Admit student") + '</div><h2>' + (isEdit ? esc(student.fullName) : "Create student account") + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><form id="sf"><div class="field"><label>Full name</label><input name="fullName" required value="' + esc(isEdit ? student.fullName : "") + '" /></div><div class="field"><label>Matric number (unique)</label><input name="matricNumber" required value="' + esc(isEdit ? student.matricNumber : "") + '" /></div><div class="field"><label>Email</label><input name="email" type="email" required value="' + esc(isEdit ? student.email : "") + '" /></div><div class="field"><label>Department</label><input name="department" required value="' + esc(isEdit ? student.department : "") + '" /></div>' + (isEdit ? "" : '<div class="field"><label>Password (min 8 characters) — student can sign in immediately</label><input name="password" type="password" minlength="8" required /></div>') + (!isEdit ? '<div class="field"><label>Account status</label><select name="active"><option value="1">Active</option><option value="0">Inactive</option></select></div><div class="warn">The account becomes available for student login immediately. Students cannot self-register — only the admin creates accounts.</div>' : "") + '<div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-primary btn-small" type="submit">' + (isEdit ? "Save changes" : "Admit student") + '</button></div></form></div>');
    bd.querySelector("[data-x]").addEventListener("click", function () { bd.remove(); });
    bd.querySelector("#sf").addEventListener("submit", function (e) {
      e.preventDefault(); var f = Object.fromEntries(new FormData(this).entries());
      var p = isEdit ? api("/api/admin/students/" + encodeURIComponent(student.id), { method: "PATCH", body: f }) : api("/api/admin/students", { method: "POST", body: { fullName: f.fullName, matricNumber: f.matricNumber, email: f.email, department: f.department, password: f.password, active: f.active === "1" } });
      p.then(function () { bd.remove(); toast(isEdit ? "Student updated." : "Student admitted and can sign in now."); loadStudents(); }).catch(function (err) { toast(err.message, "err"); });
    });
  }
  function studentAction(a, id, rows) {
    var s = rows.find(function (x) { return x.id === id; }); if (!s) return;
    if (a === "view") {
      api("/api/admin/students/" + encodeURIComponent(id) + "/tickets").then(function (d) {
        modal('<div class="modal-head"><div><div class="eyebrow">Student profile</div><h2>' + esc(s.fullName) + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><dl class="kv"><dt>Matric</dt><dd>' + esc(s.matricNumber) + '</dd><dt>Email</dt><dd>' + esc(s.email) + '</dd><dt>Department</dt><dd>' + esc(s.department) + '</dd><dt>Status</dt><dd>' + (s.active ? "Active" : "Suspended") + '</dd><dt>Registered</dt><dd>' + fmt(s.createdAt) + '</dd><dt>Last login</dt><dd>' + (s.lastLoginAt ? fmt(s.lastLoginAt, true) : "—") + '</dd></dl><h3 style="margin:8px 0 4px">Ticket history (' + d.tickets.length + ')</h3>' + (d.tickets.length ? d.tickets.map(function (t) { return '<div class="check-row"><span class="mono">' + esc(t.id) + '</span><span>' + esc(t.subject) + '</span><span style="margin-left:auto">' + statusPill(t.status) + '</span></div>'; }).join("") : '<div class="empty">No tickets.</div>') + "</div>");
      });
    } else if (a === "edit") { studentForm(s); } else if (a === "toggle") {
      confirmDlg(s.active ? "Suspend student?" : "Activate student?", s.active ? "The student will no longer be able to sign in. Their tickets are preserved." : "The student will be able to sign in again.", s.active ? "Suspend" : "Activate").then(function (ok) { if (!ok) return; api("/api/admin/students/" + encodeURIComponent(id) + (s.active ? "/deactivate" : "/activate"), { method: "POST" }).then(function () { toast("Done."); loadStudents(); }).catch(function (e) { toast(e.message, "err"); }); });
    } else if (a === "pass") {
      var bd2 = modal('<div class="modal-head"><div><div class="eyebrow">Reset password</div><h2>' + esc(s.fullName) + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><form id="pf"><div class="field"><label>New password (min 8)</label><input name="newPassword" type="password" minlength="8" required /></div><div class="warn">Hashed with scrypt on the server. Never displayed in plain text.</div><div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-primary btn-small" type="submit">Reset</button></div></form></div>');
      bd2.querySelector("[data-x]").addEventListener("click", function () { bd2.remove(); });
      bd2.querySelector("#pf").addEventListener("submit", function (e) { e.preventDefault(); api("/api/admin/students/" + encodeURIComponent(id) + "/password", { method: "POST", body: { newPassword: new FormData(this).get("newPassword") } }).then(function () { bd2.remove(); toast("Password reset."); }).catch(function (err) { toast(err.message, "err"); }); });
    } else if (a === "del") {
      confirmDlg("Delete student?", "The account will be soft-deleted: the student can no longer sign in and their active sessions are revoked. Ticket history is preserved.", "Delete permanently", true).then(function (ok) { if (!ok) return; api("/api/admin/students/" + encodeURIComponent(id), { method: "DELETE" }).then(function () { toast("Student deleted — login blocked."); loadStudents(); }).catch(function (e) { toast(e.message, "err"); }); });
    }
  }

  /* ---------- tickets ---------- */
  function loadTickets() {
    var params = new URLSearchParams(tr);
    api("/api/admin/tickets?" + params.toString()).then(function (d) {
      var rows = d.tickets;
      $("#tick-table tbody").innerHTML = rows.length ? rows.map(function (t) {
        var detail = expandedTicket === t.id ? '<tr><td colspan="6" style="background:#f8f3ea"><div style="font-size:12px;color:var(--muted)">' + esc(t.messages.map(function (m) { return "<strong>" + esc(m.authorName) + " (" + esc(m.authorType) + ")</strong> " + fmt(m.createdAt, true) + ": " + esc(m.message); }).join("<br>")) + '</div></td></tr>' : "";
        return '<tr><td class="mono">' + esc(t.id) + '</td><td><strong>' + esc(t.subject) + '</strong><div style="font-size:11px;color:var(--muted2)">' + esc(t.category) + '</div></td><td>' + esc(t.student.fullName) + '</td><td>' + esc(t.lecturer.fullName) + '</td><td>' + statusPill(t.status) + '</td><td><div class="row-actions"><button class="btn btn-secondary btn-small" data-a="view" data-id="' + t.id + '">' + (expandedTicket === t.id ? "Hide" : "View history") + '</button><button class="btn btn-secondary btn-small" data-a="status" data-id="' + t.id + '">Change status</button><button class="btn btn-secondary btn-small" data-a="reassign" data-id="' + t.id + '">Reassign</button></div></td></tr>' + detail;
      }).join("") : '<tr><td colspan="6"><div class="empty">No tickets found.</div></td></tr>';
      $$("[data-a]", $("#tick-table")).forEach(function (b) { b.addEventListener("click", function () { ticketAction(b.getAttribute("data-a"), b.getAttribute("data-id"), rows); }); });
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function pageTickets() {
    var c = $("#content");
    c.innerHTML = '<div class="toolbar"><h2>Ticket management</h2><a class="btn btn-secondary btn-small" href="/api/admin/tickets/export">Export CSV ↓</a></div><div class="panel"><div class="panel-head"><div class="filters"><input class="input" id="f-q" placeholder="Search ID, student, lecturer, subject…" value="' + esc(tr.q) + '" /><select class="input" id="f-status"><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><select class="input" id="f-dept"><option value="">All departments</option></select><input class="input" id="f-lec" placeholder="Lecturer Staff ID…" value="' + esc(tr.lecturer) + '" /></div></div><div style="overflow:auto"><table id="tick-table"><thead><tr><th>ID</th><th>Ticket</th><th>Student</th><th>Lecturer</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table></div></div>';
    api("/api/admin/students").then(function (d) {
      var depts = Array.from(new Set(d.students.map(function (s) { return s.department; })));
      var sel = $("#f-dept"); depts.forEach(function (x) { var o = document.createElement("option"); o.value = x; o.textContent = x; if (tr.department === x) o.selected = true; sel.appendChild(o); });
    }).catch(function () {});
    var t; $("#f-q").addEventListener("input", function (e) { clearTimeout(t); t = setTimeout(function () { tr.q = e.target.value; loadTickets(); }, 250); });
    $("#f-status").addEventListener("change", function (e) { tr.status = e.target.value; loadTickets(); $("#f-status").value = tr.status; });
    $("#f-dept").addEventListener("change", function (e) { tr.department = e.target.value; loadTickets(); });
    $("#f-lec").addEventListener("change", function (e) { tr.lecturer = e.target.value.trim(); loadTickets(); });
    loadTickets();
  }
  function ticketAction(a, id, rows) {
    var t = rows.find(function (x) { return x.id === id; }); if (!t) return;
    if (a === "view") { expandedTicket = expandedTicket === id ? null : id; loadTickets(); }
    else if (a === "status") {
      var bd = modal('<div class="modal-head"><div><div class="eyebrow">Ticket ' + esc(id) + '</div><h2>Change status</h2></div><button class="close-x">×</button></div><div class="modal-body"><form id="sf"><div class="field"><label>Status</label><select name="status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div><div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-primary btn-small" type="submit">Save</button></div></form></div>');
      bd.querySelector("[data-x]").addEventListener("click", function () { bd.remove(); });
      bd.querySelector("select[name=status]").value = t.status;
      bd.querySelector("#sf").addEventListener("submit", function (e) { e.preventDefault(); var st = new FormData(this).get("status"); api("/api/admin/tickets/" + encodeURIComponent(id), { method: "PATCH", body: { status: st } }).then(function () { bd.remove(); toast("Status updated."); loadTickets(); }).catch(function (err) { toast(err.message, "err"); }); });
    } else if (a === "reassign") {
      var bd2 = modal('<div class="modal-head"><div><div class="eyebrow">Ticket ' + esc(id) + '</div><h2>Reassign ticket</h2></div><button class="close-x">×</button></div><div class="modal-body"><form id="rf"><div class="field"><label>New lecturer (Staff ID)</label><input name="reassignTo" required placeholder="e.g. STAFF-1042" /></div><div class="warn">Original messages are preserved. The reassignment is recorded in the audit log.</div><div style="display:flex;justify-content:flex-end;gap:9px"><button type="button" class="btn btn-secondary btn-small" data-x>Cancel</button><button class="btn btn-primary btn-small" type="submit">Reassign</button></div></form></div>');
      bd2.querySelector("[data-x]").addEventListener("click", function () { bd2.remove(); });
      bd2.querySelector("#rf").addEventListener("submit", function (e) { e.preventDefault(); api("/api/admin/tickets/" + encodeURIComponent(id), { method: "PATCH", body: { reassignTo: new FormData(this).get("reassignTo") } }).then(function () { bd2.remove(); toast("Ticket reassigned."); loadTickets(); }).catch(function (err) { toast(err.message, "err"); }); });
    }
  }

  /* ---------- notifications ---------- */
  function countSelected() { return Object.keys(nsel.selected).length; }
  function pageNotifications() {
    var c = $("#content");
    c.innerHTML =
      '<div class="toolbar"><h2>Notification center</h2><span class="selected-count" id="sel-count">' + countSelected() + ' selected</span></div>' +
      '<div class="two-col"><div class="panel"><div class="panel-head"><div><h2>Compose</h2></div></div><div style="padding:18px"><form id="nf"><div class="field"><label>Title</label><input name="title" required /></div><div class="field"><label>Message</label><textarea name="message" required rows="4"></textarea></div>' +
      '<div class="field"><label>Recipient type</label><select name="recipientType" id="rtype"><option value="all_students">All students</option><option value="selected_students">Selected students</option><option value="all_lecturers">All lecturers</option><option value="selected_lecturers">Selected lecturers</option><option value="everyone">Everyone</option><option value="specific">One specific user</option></select></div>' +
      '<div class="field"><label>Category</label><input name="category" placeholder="e.g. Announcement, Exam, Emergency" /></div>' +
      '<div class="field"><label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></div>' +
      '<div class="field"><label>Sound</label><select name="sound" id="sound-sel"><option value="none">No sound</option><option value="default">Default</option><option value="chime">Chime</option><option value="alert">Alert</option><option value="gentle">Gentle</option></select><div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="btn btn-secondary btn-small" id="preview-sound">▶ Preview sound</button></div></div>' +
      '<div class="field"><label>Schedule for later (optional)</label><input name="scheduledAt" type="datetime-local" /></div>' +
      '<div class="field"><label>Expires at (optional)</label><input name="expiresAt" type="datetime-local" /></div>' +
      '<div class="warn">Before sending, you will see a confirmation summary — prevents accidental delivery to the wrong audience. Sends are idempotent (retries will not duplicate).</div>' +
      '<button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Review &amp; send →</button></form></div></div>' +
      '<div class="panel"><div class="panel-head"><div><h2>Recipients</h2><p>Select All = every eligible account, not just visible rows.</p></div></div><div style="padding:16px 18px;display:grid;gap:10px"><div class="filters"><input class="input" id="rf-q" placeholder="Search recipients…" value="' + esc(nsel.q) + '" /><select class="input" id="rf-dept"><option value="">All departments</option></select></div><div class="check-row"><input type="checkbox" id="select-all" /><label for="select-all"><strong>Select All</strong> <span style="color:var(--muted);font-size:11px">(all eligible in current scope)</span></label><button type="button" class="btn btn-quiet btn-small" id="clear-all" style="margin-left:auto">Clear Selection</button></div><div id="recipient-list" style="display:grid;gap:8px;max-height:380px;overflow:auto"></div><div id="specific-box" class="hidden"><div class="field"><label>Search one user (student or lecturer)</label><input id="specific-q" placeholder="Name, matric, or staff ID…" /><div id="specific-results" style="display:grid;gap:6px;margin-top:8px"></div></div></div></div></div></div>' +
      '<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>Send history</h2></div></div><div style="overflow:auto"><table id="hist-table"><thead><tr><th>Title</th><th>Audience</th><th>Sound</th><th>Sent</th><th>Recipients</th><th>Read</th></tr></thead><tbody></tbody></table></div></div>';
    nsel.type = "all_students";
    $("#rtype").addEventListener("change", function (e) { nsel.type = e.target.value; nsel.selected = {}; $("#specific-box").classList.toggle("hidden", nsel.type !== "specific"); paintRecipients(); });
    $("#preview-sound").addEventListener("click", function () { var v = $("#sound-sel").value; if (v === "none") return; new Audio("/assets/sounds/" + v + ".wav").play().catch(function () { toast("Browser blocked audio autoplay — interact with the page first.", "err"); }); });
    $("#rf-q").addEventListener("input", function (e) { nsel.q = e.target.value; paintRecipients(); });
    $("#rf-dept").addEventListener("change", function (e) { nsel.dept = e.target.value; paintRecipients(); });
    $("#select-all").addEventListener("change", function (e) { toggleSelectAll(e.target.checked); });
    $("#clear-all").addEventListener("click", function () { nsel.selected = {}; paintRecipients(); });
    $("#nf").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = Object.fromEntries(new FormData(this).entries());
      var userIds = Object.keys(nsel.selected).map(function (k) { var parts = k.split(":"); return { userType: parts[0], userId: parts[1] }; });
      var payload = { title: f.title.trim(), message: f.message.trim(), category: f.category, priority: f.priority, sound: f.sound, recipientType: nsel.type, userIds: userIds, scheduledAt: f.scheduledAt || null, expiresAt: f.expiresAt || null };
      payloadCount(payload).then(function (count) {
        openConfirm(payload, count);
      }).catch(function (err) { toast(err.message, "err"); });
    });
    loadRecipientDepartments();
    paintRecipients();
    loadHistory();
  }
  function payloadCount(payload) {
    if (payload.recipientType === "all_students" || payload.recipientType === "all_lecturers" || payload.recipientType === "everyone") {
      return api("/api/admin/notifications/count?type=" + encodeURIComponent(payload.recipientType)).then(function (d) { return d.count; });
    }
    return api("/api/admin/notifications/count?type=" + encodeURIComponent(payload.recipientType) + "&ids=" + encodeURIComponent(JSON.stringify(payload.userIds))).then(function (d) { return d.count; });
  }
  function openConfirm(payload, count) {
    var bd = modal('<div class="modal-head"><div><div class="eyebrow">Confirm send</div><h2>' + esc(payload.title) + '</h2></div><button class="close-x">×</button></div><div class="modal-body"><p style="margin:0;font-size:13px;color:var(--muted)">"' + esc(payload.message) + '"</p><dl class="kv"><dt>Audience</dt><dd>' + esc(payload.recipientType.replace(/_/g, " ")) + '</dd><dt>Recipients</dt><dd>' + count + " eligible accounts</dd><dt>Sound</dt><dd>" + esc(payload.sound) + '</dd><dt>Scheduled</dt><dd>' + (payload.scheduledAt ? fmt(payload.scheduledAt, true) : "Now") + '</dd><dt>Expires</dt><dd>' + (payload.expiresAt ? fmt(payload.expiresAt, true) : "Never") + '</dd></dl><div style="display:flex;justify-content:flex-end;gap:9px"><button class="btn btn-secondary btn-small" data-x>Back</button><button class="btn btn-primary btn-small" data-y>Send to ' + count + " recipient(s)</button></div></div>");
    bd.querySelector("[data-x]").addEventListener("click", function () { bd.remove(); });
    bd.querySelector("[data-y]").addEventListener("click", function () {
      payload.idempotencyKey = "n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
      api("/api/admin/notifications", { method: "POST", body: payload }).then(function (d) {
        bd.remove(); toast(d.duplicate ? "Already sent (duplicate prevented)." : "Notification sent to " + d.recipientCount + " recipients."); nsel.selected = {}; paintRecipients(); loadHistory();
      }).catch(function (err) { toast(err.message, "err"); });
    });
  }
  function loadRecipientDepartments() {
    Promise.all([api("/api/admin/students"), api("/api/admin/lecturers")]).then(function (res) {
      var depts = Array.from(new Set(res[0].students.map(function (s) { return s.department; }).concat(res[1].lecturers.map(function (l) { return l.department; }))));
      var sel = $("#rf-dept"); depts.forEach(function (x) { var o = document.createElement("option"); o.value = x; o.textContent = x; if (nsel.dept === x) o.selected = true; sel.appendChild(o); });
    }).catch(function () {});
  }
  function eligibleUsers() {
    return Promise.all([api("/api/admin/students"), api("/api/admin/lecturers")]).then(function (res) {
      var students = res[0].students.filter(function (s) { return s.active; }).map(function (s) { return { userType: "student", userId: s.id, name: s.fullName, idLabel: s.matricNumber, dept: s.department, search: (s.fullName + " " + s.matricNumber + " " + s.email + " " + s.department).toLowerCase() }; });
      var lecturers = res[1].lecturers.filter(function (l) { return l.active; }).map(function (l) { return { userType: "lecturer", userId: l.id, name: l.fullName, idLabel: l.staffId, dept: l.department, search: (l.fullName + " " + l.staffId + " " + l.email + " " + l.department).toLowerCase() }; });
      return { students: students, lecturers: lecturers };
    });
  }
  function paintRecipients() {
    var list = $("#recipient-list"); if (!list) return;
    var showStudents = nsel.type === "selected_students" || nsel.type === "specific";
    var showLecturers = nsel.type === "selected_lecturers" || nsel.type === "specific";
    if (nsel.type === "all_students" || nsel.type === "all_lecturers" || nsel.type === "everyone") { list.innerHTML = '<div class="empty">This audience is resolved on the server — all eligible accounts will receive the notification.</div>'; $("#sel-count").textContent = countSelected() + " selected"; return; }
    if (nsel.type === "specific") { list.innerHTML = ""; bindSpecific(); return; }
    list.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    eligibleUsers().then(function (data) {
      var arr = [];
      if (showStudents) arr = arr.concat(data.students);
      if (showLecturers) arr = arr.concat(data.lecturers);
      var q = nsel.q.toLowerCase();
      var filtered = arr.filter(function (x) { return (!q || x.search.includes(q)) && (!nsel.dept || x.dept === nsel.dept); });
      list.innerHTML = filtered.length ? filtered.map(function (x) {
        var key = x.userType + ":" + x.userId;
        return '<label class="check-row"><input type="checkbox" value="' + key + '" ' + (nsel.selected[key] ? "checked" : "") + ' /><span><strong>' + esc(x.name) + '</strong> <span style="color:var(--muted);font-size:11px">' + esc(x.idLabel) + " · " + esc(x.dept) + " (" + x.userType + ")</span></span></label>";
      }).join("") : '<div class="empty">No matches.</div>';
      $$("input[type=checkbox]", list).forEach(function (cb) { cb.addEventListener("change", function () { var key = cb.value; if (cb.checked) nsel.selected[key] = true; else delete nsel.selected[key]; $("#sel-count").textContent = countSelected() + " selected"; var all = $("#select-all"); if (all) all.checked = filtered.every(function (x) { return nsel.selected[x.userType + ":" + x.userId]; }); }); });
      $("#sel-count").textContent = countSelected() + " selected";
    }).catch(function () { list.innerHTML = '<div class="empty">Failed to load recipients.</div>'; });
  }
  function toggleSelectAll(on) {
    if (!on) { nsel.selected = {}; $("#sel-count").textContent = "0 selected"; paintRecipients(); return; }
    eligibleUsers().then(function (data) {
      var arr = [];
      if (nsel.type === "selected_students" || nsel.type === "specific") arr = arr.concat(data.students);
      if (nsel.type === "selected_lecturers" || nsel.type === "specific") arr = arr.concat(data.lecturers);
      var q = nsel.q.toLowerCase();
      var filtered = arr.filter(function (x) { return (!q || x.search.includes(q)) && (!nsel.dept || x.dept === nsel.dept); });
      filtered.forEach(function (x) { nsel.selected[x.userType + ":" + x.userId] = true; });
      $("#sel-count").textContent = countSelected() + " selected"; paintRecipients();
    });
  }
  function bindSpecific() {
    var box = $("#specific-box"); box.classList.remove("hidden");
    var qi = $("#specific-q"); var res = $("#specific-results");
    var t; qi.addEventListener("input", function () {
      clearTimeout(t); t = setTimeout(function () {
        var q = qi.value.trim().toLowerCase();
        if (q.length < 2) { res.innerHTML = ""; return; }
        api("/api/admin/users/search?q=" + encodeURIComponent(q)).then(function (d) {
          var all = d.students.concat(d.lecturers);
          res.innerHTML = all.length ? all.map(function (u) { return '<label class="check-row"><input type="checkbox" value="' + u.userType + ":" + u.userId + '" ' + (nsel.selected[u.userType + ":" + u.userId] ? "checked" : "") + ' /><span>' + esc(u.label) + '</span></label>'; }).join("") : '<div class="empty">No user found.</div>';
          $$("input[type=checkbox]", res).forEach(function (cb) { cb.addEventListener("change", function () { if (cb.checked) nsel.selected[cb.value] = true; else delete nsel.selected[cb.value]; $("#sel-count").textContent = countSelected() + " selected"; }); });
        });
      }, 250);
    });
    setTimeout(function () { qi.focus(); }, 100);
  }
  function loadHistory() {
    api("/api/admin/notifications/history").then(function (d) {
      $("#hist-table tbody").innerHTML = d.notifications.length ? d.notifications.map(function (n) {
        return '<tr><td><strong>' + esc(n.title) + '</strong><div style="font-size:11px;color:var(--muted2);max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(n.message) + '</div></td><td>' + esc(n.recipientType.replace(/_/g, " ")) + '</td><td>' + esc(n.sound) + '</td><td>' + fmt(n.createdAt, true) + '</td><td>' + n.recipients + '</td><td>' + n.readCount + " read</td></tr>";
      }).join("") : '<tr><td colspan="6"><div class="empty">No notifications sent yet.</div></td></tr>';
    }).catch(function () {});
  }

  /* ---------- website control ---------- */
  function pageWebsite() {
    var c = $("#content");
    c.innerHTML = '<div class="two-col"><div class="panel"><div class="panel-head"><div><h2>Maintenance mode</h2><p>Blocks student and lecturer logins. Admin panel stays accessible. Nothing is deleted.</p></div></div><div style="padding:20px"><div class="switch-row"><input class="switch" type="checkbox" id="m-toggle" /><label for="m-toggle" id="m-label">Maintenance OFF</label></div><div class="field" style="margin-top:14px"><label>Custom title</label><input id="m-title" /></div><div class="field"><label>Maintenance message</label><textarea id="m-msg" rows="3"></textarea></div><div class="field"><label>Estimated reopening time (optional)</label><input id="m-reopen" type="datetime-local" /></div><button class="btn btn-primary btn-small" id="m-save">Apply changes</button></div></div>' +
      '<div class="panel"><div class="panel-head"><div><h2>Emergency recovery</h2></div></div><div style="padding:20px"><p style="font-size:13px;color:var(--muted);line-height:1.7">If the admin session is lost, setting <code>ADMIN_USERNAME</code> / <code>ADMIN_PASSWORD</code> environment variables before starting the server will create an admin when none exists. To reset maintenance without the UI, stop the server and set <code>enabled=0</code> in the <code>maintenance</code> table in <code>data/helpdesk.sqlite</code> (log in to SQLite manually during an incident only).</p><div class="warn">Never share session cookies, env files, or database backups publicly. DATABASE_PATH env can point the server at a backed-up copy for recovery.</div></div></div></div>';
    api("/api/admin/overview").then(function (d) {
      var m = d.maintenance; var tg = $("#m-toggle");
      tg.checked = !!m.enabled; $("#m-label").textContent = m.enabled ? "Maintenance ON — normal users blocked" : "Maintenance OFF";
      $("#m-title").value = m.title; $("#m-msg").value = m.message;
      if (m.reopeningAt) $("#m-reopen").value = m.reopeningAt.slice(0, 16);
    }).catch(function () {});
    $("#m-save").addEventListener("click", function () {
      var enabled = $("#m-toggle").checked;
      confirmDlg(enabled ? "Enable maintenance mode?" : "Disable maintenance mode?", enabled ? "Students and lecturers will see the maintenance page. Admin remains available. All data is preserved." : "Normal access will be restored immediately.", enabled ? "Enable" : "Disable").then(function (ok) {
        if (!ok) return;
        api("/api/admin/maintenance", { method: "PATCH", body: { enabled: enabled, title: $("#m-title").value.trim(), message: $("#m-msg").value.trim(), reopeningAt: $("#m-reopen").value ? new Date($("#m-reopen").value).toISOString() : null } }).then(function () {
          window.__maintOn = enabled; toast(enabled ? "Maintenance enabled." : "Maintenance disabled."); renderShell();
        }).catch(function (e) { toast(e.message, "err"); });
      });
    });
    $("#m-toggle").addEventListener("change", function () { $("#m-label").textContent = this.checked ? "Maintenance ON — normal users blocked" : "Maintenance OFF"; });
  }

  /* ---------- settings ---------- */
  function pageSettings() {
    var c = $("#content");
    c.innerHTML = '<div class="panel"><div class="panel-head"><div><h2>Branding &amp; settings</h2><p>Preview live as you type. Saved values persist in the shared database.</p></div></div><div style="padding:22px"><form id="sform" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="field"><label>Website brand name</label><input name="brand_name" required /></div>' +
      '<div class="field"><label>Application title</label><input name="app_title" required /></div>' +
      '<div class="field" style="grid-column:1/-1"><label>Welcome message (hero)</label><input name="welcome_message" /></div>' +
      '<div class="field"><label>Institution / department name</label><input name="institution" /></div>' +
      '<div class="field"><label>Primary brand color</label><input name="primary_color" placeholder="#23444a" /></div>' +
      '<div class="field" style="grid-column:1/-1"><label>Footer text</label><input name="footer_text" /></div>' +
      '<div class="field"><label>Contact email</label><input name="contact_email" type="email" /></div>' +
      '<div class="field"><label>Contact phone</label><input name="contact_phone" /></div>' +
      '<div class="field"><label>Logo URL (applied automatically)</label><input name="logo_path" placeholder="Leave empty to use the default mark" /></div>' +
      '<div class="field"><label>Logo upload (PNG/JPG/WEBP/SVG, max 1MB)</label><input type="file" id="logo-upload" accept="image/*" /></div>' +
      '<div class="field" style="grid-column:1/-1;display:flex;gap:9px"><button type="submit" class="btn btn-primary btn-small">Save settings</button><span id="save-note" style="font-size:12px;color:var(--muted)"></span></div>' +
      "</form></div></div>";
    api("/api/admin/settings").then(function (d) { var s = d.settings; $$("#sform [name]").forEach(function (el) { el.value = s[el.name] || ""; }); }).catch(function () {});
    $("#logo-upload").addEventListener("change", function () {
      var f = this.files[0]; if (!f) return;
      if (f.size > 1024 * 1024) return toast("Image must be under 1MB.", "err");
      var r = new FileReader();
      r.onload = function () { api("/api/admin/uploads", { method: "POST", body: { kind: "image", dataBase64: String(r.result).split(",")[1] } }).then(function (res) { document.querySelector("input[name=logo_path]").value = res.url; toast("Logo uploaded."); }).catch(function (e) { toast(e.message, "err"); }); };
      r.readAsDataURL(f);
    });
    $("#sform").addEventListener("submit", function (e) {
      e.preventDefault();
      var body = Object.fromEntries(new FormData(this).entries());
      api("/api/admin/settings", { method: "PATCH", body: body }).then(function () { $("#save-note").textContent = "Saved " + new Date().toLocaleTimeString() + " — refresh the main site to see changes."; toast("Settings saved."); }).catch(function (err) { toast(err.message, "err"); });
    });
  }

  /* ---------- logs & profile ---------- */
  function pageLogs() {
    var c = $("#content");
    c.innerHTML = '<div class="panel"><div class="panel-head"><div><h2>Audit logs</h2><p>Only administrators can view this. Passwords are never recorded.</p></div></div><div id="log-list">' + '<div class="empty"><div class="spinner"></div></div>' + "</div></div>";
    api("/api/admin/audit-logs").then(function (d) {
      $("#log-list").innerHTML = d.logs.length ? d.logs.map(function (l) {
        return '<div class="log-row"><span>' + fmt(l.created_at, true) + '</span><strong>' + esc(l.admin_username) + '</strong><span>' + esc(l.action) + " — " + esc(l.target) + '</span><span style="color:var(--muted)">' + esc(l.details) + '</span></div>';
      }).join("") : '<div class="empty">No logs yet.</div>';
    }).catch(function (e) { $("#log-list").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
  }
  function pageProfile() { profileForm(); }
  function profileForm() {
    var c = $("#content"); if (!c) return;
    c.innerHTML = '<div class="panel" style="max-width:520px"><div class="panel-head"><div><h2>Admin profile</h2></div></div><div style="padding:20px"><dl class="kv" style="margin-bottom:18px"><dt>Username</dt><dd>' + esc(me.username) + '</dd><dt>Display name</dt><dd>' + esc(me.displayName) + '</dd><dt>Must change password</dt><dd>' + (me.mustChangePassword ? "Yes — change it below" : "No") + '</dd></dl><form id="pw-form"><div class="field"><label>Current password</label><input name="currentPassword" type="password" required /></div><div class="field"><label>New password (min 10)</label><input name="newPassword" type="password" minlength="10" required /></div><button class="btn btn-primary btn-small" type="submit">Change password</button></form></div></div>';
    $("#pw-form").addEventListener("submit", function (e) { e.preventDefault(); var f = Object.fromEntries(new FormData(this).entries()); api("/api/admin/me/password", { method: "POST", body: f }).then(function () { me.mustChangePassword = false; toast("Password changed."); }).catch(function (err) { toast(err.message, "err"); }); });
  }

  /* ---------- bootstrap ---------- */
  fetch("/api/public", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
    csrfToken = d.csrf;
    return api("/api/admin/me").catch(function () { return null; });
  }).then(function () {
    if (me) { route = "dashboard"; renderShell(); } else pageLogin();
  }).catch(function () { pageLogin(); });
})();
