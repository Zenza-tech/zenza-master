/* Zenza FID — Console application logic (vanilla JS, no build step) */

const state = {
  user: null,
  view: "dashboard",
  // simple client-side caches for the currently open list views
  repo: { page: 1, q: "", status: "", type: "" },
  watch: { page: 1, status: "", severity: "" },
  audit: { page: 1, action: "", resource_type: "" },
};

// ---------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Invalid server response" }));
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Not authenticated");
  }
  if (!data.ok) {
    const err = new Error(data.error || "Request failed");
    err.payload = data;
    throw err;
  }
  return data;
}

function toast(message, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove("show"), 3200);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function can(code) {
  return state.user && state.user.permissions.includes(code);
}

// ---------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------
function openModal(html) {
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modalOverlay").classList.add("show");
}
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("show");
  document.getElementById("modalBody").innerHTML = "";
}
document.getElementById("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") closeModal();
});

function modalError(msg) {
  const box = document.querySelector("#modalBody .modal-error");
  if (!box) return;
  box.textContent = msg;
  box.classList.add("show");
}

// ---------------------------------------------------------------------
// Bootstrap: auth check, shell setup
// ---------------------------------------------------------------------
async function boot() {
  try {
    const { user } = await api("/auth/me");
    state.user = user;
  } catch {
    return; // api() already redirected to login
  }

  document.getElementById("userChip").innerHTML =
    `${esc(state.user.full_name)} <span class="role-pill">${esc(state.user.role)}</span>`;

  if (can("audit.view")) document.getElementById("navAudit").style.display = "";
  if (can("users.manage")) document.getElementById("navUsers").style.display = "";
  if (can("audit.view") || can("users.manage")) document.getElementById("adminSep").style.display = "";

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  });

  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const hash = (window.location.hash || "#/dashboard").replace("#/", "");
  const view = hash.split("?")[0] || "dashboard";
  state.view = view;
  document.querySelectorAll("#sidebarNav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === view);
  });
  const renderers = {
    dashboard: renderDashboard,
    repository: renderRepository,
    watchlist: renderWatchlist,
    audit: renderAudit,
    users: renderUsers,
  };
  (renderers[view] || renderDashboard)();
}

// ---------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------
async function renderDashboard() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="view-head"><div><h1>Dashboard</h1><p>Overview of the fraud intelligence repository.</p></div></div><div class="stat-cards" id="statCards"><div class="sc"><span class="n">…</span><span class="l">Loading</span></div></div>`;

  const [entities, activeWl, pendingWl] = await Promise.all([
    api("/entities?limit=1"),
    api("/watchlist?status=active&limit=1"),
    api("/watchlist?status=pending_approval&limit=1"),
  ]);

  let auditHtml = "";
  if (can("audit.view")) {
    const recent = await api("/audit?limit=6");
    auditHtml = `
      <div class="detail-section">
        <h3>Recent Activity</h3>
        <div class="timeline-mini">
          ${recent.results.map(r => `
            <div class="t-item">
              <div class="t-action">${esc(r.action)}</div>
              <div class="t-meta">${esc(r.actor_name || "system")} · ${fmtDate(r.created_at)}</div>
            </div>
          `).join("") || `<p class="muted">No activity yet.</p>`}
        </div>
      </div>`;
  }

  document.getElementById("statCards").innerHTML = `
    <div class="sc"><span class="n">${entities.total}</span><span class="l">Entities in Repository</span></div>
    <div class="sc"><span class="n">${activeWl.total}</span><span class="l">Active Watchlist Entries</span></div>
    <div class="sc"><span class="n">${pendingWl.total}</span><span class="l">Pending Approval</span></div>
  `;
  document.getElementById("mainContent").insertAdjacentHTML("beforeend", auditHtml);
}

// ---------------------------------------------------------------------
// REPOSITORY
// ---------------------------------------------------------------------
async function renderRepository() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head">
      <div><h1>Fraud Intelligence Repository</h1><p>Every known bad actor, one governed profile each.</p></div>
      ${can("entities.create") ? `<button class="btn btn-primary" id="newEntityBtn">+ New Entity</button>` : ""}
    </div>
    <div class="toolbar">
      <input type="text" id="repoSearch" placeholder="Search name or identifier…" value="${esc(state.repo.q)}" style="min-width:220px;">
      <select id="repoStatus">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      <div class="spacer"></div>
    </div>
    <div id="repoTableWrap"><div class="empty-state">Loading…</div></div>
  `;

  document.getElementById("newEntityBtn")?.addEventListener("click", openEntityFormModal);
  document.getElementById("repoSearch").addEventListener("input", debounce((e) => {
    state.repo.q = e.target.value; state.repo.page = 1; loadRepoTable();
  }, 350));
  document.getElementById("repoStatus").addEventListener("change", (e) => {
    state.repo.status = e.target.value; state.repo.page = 1; loadRepoTable();
  });

  loadRepoTable();
}

async function loadRepoTable() {
  const wrap = document.getElementById("repoTableWrap");
  const params = new URLSearchParams({ page: state.repo.page, limit: 15 });
  if (state.repo.q) params.set("q", state.repo.q);
  if (state.repo.status) params.set("status", state.repo.status);
  const data = await api(`/entities?${params}`);

  if (data.results.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No entities found. ${can("entities.create") ? "Create the first one with \u201c+ New Entity.\u201d" : ""}</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Name</th><th>Type</th><th>Identifiers</th><th>Watchlist</th><th>Updated</th></tr></thead>
      <tbody>
        ${data.results.map(e => `
          <tr data-id="${e.id}">
            <td><strong>${esc(e.full_name)}</strong></td>
            <td class="muted">${esc(e.entity_type)}</td>
            <td class="muted">${e.identifiers.map(i => esc(i.identifier_type)).join(", ") || "—"}</td>
            <td>${e.active_watchlist_count > 0 ? `<span class="badge status-active">${e.active_watchlist_count} active</span>` : `<span class="muted">none</span>`}</td>
            <td class="muted">${fmtDate(e.updated_at)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${pagerHtml(data, () => { state.repo.page--; loadRepoTable(); }, () => { state.repo.page++; loadRepoTable(); })}
  `;
  wrap.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => openEntityDetailModal(tr.dataset.id));
  });
}

function pagerHtml(data, onPrev, onNext) {
  const totalPages = Math.max(Math.ceil(data.total / data.limit), 1);
  window.__pagerPrev = onPrev;
  window.__pagerNext = onNext;
  return `
    <div class="pager">
      <span>Page ${data.page} of ${totalPages} · ${data.total} total</span>
      <div style="display:flex; gap:8px;">
        <button ${data.page <= 1 ? "disabled" : ""} onclick="window.__pagerPrev()">← Prev</button>
        <button ${data.page >= totalPages ? "disabled" : ""} onclick="window.__pagerNext()">Next →</button>
      </div>
    </div>`;
}

function identifierRowsHtml(identifiers = [{ type: "BVN", value: "" }]) {
  return identifiers.map((id, i) => `
    <div class="identifier-row" data-row>
      <select data-id-type>
        ${["BVN","NIN","EMAIL","PHONE","ACCOUNT","DEVICE"].map(t => `<option ${t === id.type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <input type="text" data-id-value placeholder="Value" value="${esc(id.value || "")}">
      <button type="button" class="icon-btn" data-remove-row>&times;</button>
    </div>
  `).join("");
}

function openEntityFormModal() {
  openModal(`
    <h2>New Entity</h2>
    <div class="modal-error"></div>
    <form id="entityForm">
      <div class="field"><label>Full Name</label><input type="text" id="ef_name" required></div>
      <div class="field"><label>Type</label>
        <select id="ef_type"><option value="individual">Individual</option><option value="organization">Organization</option></select>
      </div>
      <div class="field"><label>Risk Notes</label><textarea id="ef_notes" placeholder="What do we know about this entity?"></textarea></div>
      <div class="field">
        <label>Identifiers</label>
        <div id="idRows">${identifierRowsHtml()}</div>
        <button type="button" class="add-row-btn" id="addIdRow">+ Add identifier</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Entity</button>
      </div>
    </form>
  `);

  document.getElementById("addIdRow").addEventListener("click", () => {
    document.getElementById("idRows").insertAdjacentHTML("beforeend", identifierRowsHtml([{ type: "BVN", value: "" }]));
    bindRemoveButtons();
  });
  bindRemoveButtons();

  document.getElementById("entityForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifiers = collectIdentifierRows();
    try {
      await api("/entities", {
        method: "POST",
        body: JSON.stringify({
          full_name: document.getElementById("ef_name").value.trim(),
          entity_type: document.getElementById("ef_type").value,
          risk_notes: document.getElementById("ef_notes").value.trim(),
          identifiers,
        }),
      });
      closeModal();
      toast("Entity created");
      loadRepoTable();
    } catch (err) {
      if (err.payload?.duplicates) {
        modalError(`Possible duplicate: "${err.payload.duplicates[0].full_name}" already has this ${err.payload.duplicates[0].identifier_type}. Use a different identifier or search the repository for the existing profile.`);
      } else {
        modalError(err.message);
      }
    }
  });
}

function bindRemoveButtons() {
  document.querySelectorAll("[data-remove-row]").forEach((btn) => {
    btn.onclick = () => {
      if (document.querySelectorAll("[data-row]").length > 1) btn.closest("[data-row]").remove();
    };
  });
}

function collectIdentifierRows() {
  return [...document.querySelectorAll("[data-row]")]
    .map((row) => ({
      type: row.querySelector("[data-id-type]").value,
      value: row.querySelector("[data-id-value]").value.trim(),
    }))
    .filter((r) => r.value);
}

async function openEntityDetailModal(id) {
  const { entity, watchlist, versions } = await api(`/entities/${id}`);
  openModal(`
    <h2>${esc(entity.full_name)}</h2>
    <div class="detail-section">
      <h3>Identifiers</h3>
      ${entity.identifiers.map(i => `<div class="kv-row"><span class="k">${esc(i.identifier_type)}</span><span>${esc(i.identifier_value)}</span></div>`).join("") || `<p class="muted">None on file</p>`}
    </div>
    <div class="detail-section">
      <h3>Risk Notes</h3>
      <p style="font-size:13.5px;">${esc(entity.risk_notes) || "—"}</p>
    </div>
    <div class="detail-section">
      <h3>Watchlist History (${watchlist.length})</h3>
      ${watchlist.map(w => `<div class="kv-row"><span class="k">${esc(w.category)} · ${esc(w.severity)}</span><span class="badge status-${w.status}">${w.status.replace("_"," ")}</span></div>`).join("") || `<p class="muted">Never watchlisted</p>`}
    </div>
    <div class="detail-section">
      <h3>Change History (${versions.length})</h3>
      <div class="timeline-mini">
        ${versions.map(v => `<div class="t-item"><div class="t-action">${esc(v.change_summary)}</div><div class="t-meta">${fmtDate(v.created_at)}</div></div>`).join("")}
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
      ${can("entities.edit") ? `<button type="button" class="btn btn-primary" id="editEntityBtn">Edit</button>` : ""}
      ${can("watchlist.create") ? `<button type="button" class="btn btn-primary" id="watchlistEntityBtn">Add to Watchlist</button>` : ""}
    </div>
  `);
  document.getElementById("editEntityBtn")?.addEventListener("click", () => openEntityEditModal(entity));
  document.getElementById("watchlistEntityBtn")?.addEventListener("click", () => openWatchlistFormModal(entity));
}

function openEntityEditModal(entity) {
  openModal(`
    <h2>Edit Entity</h2>
    <div class="modal-error"></div>
    <form id="entityEditForm">
      <div class="field"><label>Full Name</label><input type="text" id="ef_name" value="${esc(entity.full_name)}" required></div>
      <div class="field"><label>Status</label>
        <select id="ef_status"><option value="active" ${entity.status==="active"?"selected":""}>Active</option><option value="archived" ${entity.status==="archived"?"selected":""}>Archived</option></select>
      </div>
      <div class="field"><label>Risk Notes</label><textarea id="ef_notes">${esc(entity.risk_notes)}</textarea></div>
      <div class="field">
        <label>Identifiers</label>
        <div id="idRows">${identifierRowsHtml(entity.identifiers.map(i => ({ type: i.identifier_type, value: i.identifier_value })))}</div>
        <button type="button" class="add-row-btn" id="addIdRow">+ Add identifier</button>
      </div>
      <div class="field"><label>Change Summary</label><input type="text" id="ef_summary" placeholder="Why this update?" required></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `);
  document.getElementById("addIdRow").addEventListener("click", () => {
    document.getElementById("idRows").insertAdjacentHTML("beforeend", identifierRowsHtml([{ type: "BVN", value: "" }]));
    bindRemoveButtons();
  });
  bindRemoveButtons();

  document.getElementById("entityEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/entities/${entity.id}`, {
        method: "PUT",
        body: JSON.stringify({
          full_name: document.getElementById("ef_name").value.trim(),
          status: document.getElementById("ef_status").value,
          risk_notes: document.getElementById("ef_notes").value.trim(),
          identifiers: collectIdentifierRows(),
          change_summary: document.getElementById("ef_summary").value.trim(),
        }),
      });
      closeModal();
      toast("Entity updated");
      loadRepoTable();
    } catch (err) {
      modalError(err.message);
    }
  });
}

// ---------------------------------------------------------------------
// WATCHLIST
// ---------------------------------------------------------------------
async function renderWatchlist() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head">
      <div><h1>Watchlist</h1><p>Every flagged entity, with full maker-checker history.</p></div>
    </div>
    <div class="toolbar">
      <select id="wlStatus">
        <option value="">All statuses</option>
        <option value="pending_approval">Pending Approval</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="rejected">Rejected</option>
        <option value="expired">Expired</option>
      </select>
      <select id="wlSeverity">
        <option value="">All severities</option>
        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
      </select>
      <div class="spacer"></div>
    </div>
    <div id="wlTableWrap"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("wlStatus").addEventListener("change", (e) => { state.watch.status = e.target.value; state.watch.page = 1; loadWatchTable(); });
  document.getElementById("wlSeverity").addEventListener("change", (e) => { state.watch.severity = e.target.value; state.watch.page = 1; loadWatchTable(); });
  loadWatchTable();
}

async function loadWatchTable() {
  const wrap = document.getElementById("wlTableWrap");
  const params = new URLSearchParams({ page: state.watch.page, limit: 15 });
  if (state.watch.status) params.set("status", state.watch.status);
  if (state.watch.severity) params.set("severity", state.watch.severity);
  const data = await api(`/watchlist?${params}`);

  if (data.results.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No watchlist entries match these filters.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Entity</th><th>Category</th><th>Severity</th><th>Status</th><th>Requested By</th><th>Created</th></tr></thead>
      <tbody>
        ${data.results.map(w => `
          <tr data-id="${w.id}">
            <td><strong>${esc(w.entity_name)}</strong></td>
            <td class="muted">${esc(w.category)}</td>
            <td><span class="badge sev-${w.severity}">${esc(w.severity)}</span></td>
            <td><span class="badge status-${w.status}">${w.status.replace("_"," ")}</span></td>
            <td class="muted">${esc(w.requested_by_name)}</td>
            <td class="muted">${fmtDate(w.created_at)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${pagerHtml(data, () => { state.watch.page--; loadWatchTable(); }, () => { state.watch.page++; loadWatchTable(); })}
  `;
  wrap.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => openWatchlistDetailModal(tr.dataset.id)));
}

function openWatchlistFormModal(entity) {
  openModal(`
    <h2>Add "${esc(entity.full_name)}" to Watchlist</h2>
    <div class="modal-error"></div>
    <form id="wlForm">
      <div class="field"><label>Category</label>
        <select id="wf_category">
          <option value="account_takeover">Account Takeover</option>
          <option value="identity_fraud">Identity Fraud</option>
          <option value="mule_account">Mule Account</option>
          <option value="payment_fraud">Payment Fraud</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field"><label>Severity</label>
        <select id="wf_severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
      </div>
      <div class="field"><label>Reason</label><textarea id="wf_reason" required placeholder="Evidence / justification for this flag"></textarea></div>
      <div class="field"><label>Expires (optional)</label><input type="date" id="wf_expires"></div>
      <p class="muted" style="font-size:12px; margin-bottom:14px;">This submits for approval — it won't take effect until a fraud manager or admin (not you) approves it.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit for Approval</button>
      </div>
    </form>
  `);
  document.getElementById("wlForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const expires = document.getElementById("wf_expires").value;
    try {
      await api("/watchlist", {
        method: "POST",
        body: JSON.stringify({
          entity_id: entity.id,
          category: document.getElementById("wf_category").value,
          severity: document.getElementById("wf_severity").value,
          reason: document.getElementById("wf_reason").value.trim(),
          expires_at: expires ? new Date(expires).toISOString() : null,
        }),
      });
      closeModal();
      toast("Watchlist request submitted for approval");
      if (state.view === "watchlist") loadWatchTable();
    } catch (err) {
      modalError(err.message);
    }
  });
}

async function openWatchlistDetailModal(id) {
  const { entry } = await api(`/watchlist/${id}`);
  const isOwn = entry.requested_by === state.user.id;

  const actions = [];
  if (entry.status === "pending_approval" && can("watchlist.approve")) {
    if (isOwn) {
      actions.push(`<p class="muted" style="font-size:12px;">You submitted this request — another fraud manager or admin must review it.</p>`);
    } else {
      actions.push(`<button type="button" class="btn btn-ghost" id="wlRejectBtn">Reject</button>`);
      actions.push(`<button type="button" class="btn btn-primary" id="wlApproveBtn">Approve</button>`);
    }
  }
  if (entry.status === "active" && can("watchlist.suspend")) {
    actions.push(`<button type="button" class="btn btn-primary" id="wlSuspendBtn">Suspend</button>`);
  }
  if (entry.status === "suspended" && can("watchlist.suspend")) {
    actions.push(`<button type="button" class="btn btn-primary" id="wlReactivateBtn">Reactivate</button>`);
  }

  openModal(`
    <h2>${esc(entry.entity.full_name)}</h2>
    <div class="modal-error"></div>
    <div class="detail-section">
      <div class="kv-row"><span class="k">Status</span><span class="badge status-${entry.status}">${entry.status.replace("_"," ")}</span></div>
      <div class="kv-row"><span class="k">Category</span><span>${esc(entry.category)}</span></div>
      <div class="kv-row"><span class="k">Severity</span><span class="badge sev-${entry.severity}">${esc(entry.severity)}</span></div>
      <div class="kv-row"><span class="k">Expires</span><span>${entry.expires_at ? fmtDate(entry.expires_at) : "No expiry set"}</span></div>
    </div>
    <div class="detail-section">
      <h3>Reason</h3>
      <p style="font-size:13.5px;">${esc(entry.reason)}</p>
    </div>
    <div class="detail-section">
      <h3>History</h3>
      <div class="timeline-mini">
        ${entry.history.map(h => `<div class="t-item"><div class="t-action">${esc(h.action)}${h.notes ? ` — ${esc(h.notes)}` : ""}</div><div class="t-meta">${esc(h.actor_name || "system")} · ${fmtDate(h.created_at)}</div></div>`).join("")}
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
      ${actions.join("")}
    </div>
  `);

  document.getElementById("wlApproveBtn")?.addEventListener("click", async () => {
    try { await api(`/watchlist/${id}/approve`, { method: "POST" }); closeModal(); toast("Approved"); loadWatchTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("wlRejectBtn")?.addEventListener("click", async () => {
    const notes = prompt("Reason for rejection (required):");
    if (!notes) return;
    try { await api(`/watchlist/${id}/reject`, { method: "POST", body: JSON.stringify({ notes }) }); closeModal(); toast("Rejected"); loadWatchTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("wlSuspendBtn")?.addEventListener("click", async () => {
    try { await api(`/watchlist/${id}/suspend`, { method: "POST" }); closeModal(); toast("Suspended"); loadWatchTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("wlReactivateBtn")?.addEventListener("click", async () => {
    try { await api(`/watchlist/${id}/reactivate`, { method: "POST" }); closeModal(); toast("Reactivated"); loadWatchTable(); }
    catch (err) { modalError(err.message); }
  });
}

// ---------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------
async function renderAudit() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head"><div><h1>Audit Log</h1><p>Every recorded system action. Read-only, by design.</p></div></div>
    <div class="toolbar">
      <input type="text" id="auditAction" placeholder="Filter by action (e.g. watchlist.approve)…" style="min-width:260px;">
      <div class="spacer"></div>
    </div>
    <div id="auditTableWrap"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("auditAction").addEventListener("input", debounce((e) => {
    state.audit.action = e.target.value; state.audit.page = 1; loadAuditTable();
  }, 350));
  loadAuditTable();
}

async function loadAuditTable() {
  const wrap = document.getElementById("auditTableWrap");
  const params = new URLSearchParams({ page: state.audit.page, limit: 20 });
  if (state.audit.action) params.set("action", state.audit.action);
  const data = await api(`/audit?${params}`);

  if (data.results.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No matching audit events.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>IP</th></tr></thead>
      <tbody>
        ${data.results.map(r => `
          <tr>
            <td class="muted">${fmtDate(r.created_at)}</td>
            <td>${esc(r.actor_name || "system")}</td>
            <td><span class="mono">${esc(r.action)}</span></td>
            <td class="muted">${r.resource_type ? `${esc(r.resource_type)} #${r.resource_id}` : "—"}</td>
            <td class="muted">${esc(r.ip_address || "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${pagerHtml(data, () => { state.audit.page--; loadAuditTable(); }, () => { state.audit.page++; loadAuditTable(); })}
  `;
}

// ---------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------
async function renderUsers() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head">
      <div><h1>Users</h1><p>Manage who has access, and what they can do.</p></div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost" id="changePwBtn">Change My Password</button>
        <button class="btn btn-primary" id="newUserBtn">+ New User</button>
      </div>
    </div>
    <div id="usersTableWrap"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("newUserBtn").addEventListener("click", openNewUserModal);
  document.getElementById("changePwBtn").addEventListener("click", openChangePasswordModal);
  loadUsersTable();
}

async function loadUsersTable() {
  const { results, roles } = await Promise.all([api("/users"), api("/users/roles")]).then(([a,b]) => ({ results: a.results, roles: b.roles }));
  const wrap = document.getElementById("usersTableWrap");
  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th></th></tr></thead>
      <tbody>
        ${results.map(u => `
          <tr>
            <td><strong>${esc(u.full_name)}</strong></td>
            <td class="muted">${esc(u.email)}</td>
            <td>
              <select data-role-select data-uid="${u.id}" ${u.id === state.user.id ? "disabled" : ""}>
                ${roles.map(r => `<option value="${r.name}" ${r.name === u.role ? "selected" : ""}>${r.name}</option>`).join("")}
              </select>
            </td>
            <td><span class="badge ${u.status === "active" ? "status-active" : "status-suspended"}">${u.status}</span></td>
            <td class="muted">${fmtDate(u.last_login_at)}</td>
            <td>
              <button class="btn btn-ghost" style="padding:6px 10px; font-size:12px;" data-toggle-status data-uid="${u.id}" data-status="${u.status}" ${u.id === state.user.id ? "disabled" : ""}>
                ${u.status === "active" ? "Disable" : "Enable"}
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll("[data-role-select]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try { await api(`/users/${sel.dataset.uid}/role`, { method: "PUT", body: JSON.stringify({ role: sel.value }) }); toast("Role updated"); }
      catch (err) { toast(err.message, "error"); loadUsersTable(); }
    });
  });
  wrap.querySelectorAll("[data-toggle-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.status === "active" ? "disabled" : "active";
      try { await api(`/users/${btn.dataset.uid}/status`, { method: "PUT", body: JSON.stringify({ status: next }) }); toast("Status updated"); loadUsersTable(); }
      catch (err) { toast(err.message, "error"); }
    });
  });
}

function openNewUserModal() {
  openModal(`
    <h2>New User</h2>
    <div class="modal-error"></div>
    <form id="newUserForm">
      <div class="field"><label>Full Name</label><input type="text" id="nu_name" required></div>
      <div class="field"><label>Email</label><input type="email" id="nu_email" required></div>
      <div class="field"><label>Temporary Password</label><input type="text" id="nu_password" required minlength="8" placeholder="At least 8 characters"></div>
      <div class="field"><label>Role</label>
        <select id="nu_role"><option value="analyst">Analyst</option><option value="fraud_manager">Fraud Manager</option><option value="admin">Admin</option></select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create User</button>
      </div>
    </form>
  `);
  document.getElementById("newUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          full_name: document.getElementById("nu_name").value.trim(),
          email: document.getElementById("nu_email").value.trim(),
          password: document.getElementById("nu_password").value,
          role: document.getElementById("nu_role").value,
        }),
      });
      closeModal();
      toast("User created");
      loadUsersTable();
    } catch (err) {
      modalError(err.message);
    }
  });
}

function openChangePasswordModal() {
  openModal(`
    <h2>Change My Password</h2>
    <div class="modal-error"></div>
    <form id="pwForm">
      <div class="field"><label>Current Password</label><input type="password" id="cp_current" required></div>
      <div class="field"><label>New Password</label><input type="password" id="cp_new" required minlength="8"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Update Password</button>
      </div>
    </form>
  `);
  document.getElementById("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/users/me/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: document.getElementById("cp_current").value,
          new_password: document.getElementById("cp_new").value,
        }),
      });
      closeModal();
      toast("Password updated");
    } catch (err) {
      modalError(err.message);
    }
  });
}

// ---------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------
// PWA: service worker registration + install prompt
// ---------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker registration failed:", err));
  });
}

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById("installBtn");
  if (btn) btn.style.display = "";
});

document.getElementById("installBtn")?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("installBtn").style.display = "none";
  if (outcome === "accepted") toast("Zenza FID installed");
});

window.addEventListener("appinstalled", () => {
  const btn = document.getElementById("installBtn");
  if (btn) btn.style.display = "none";
});

boot();
