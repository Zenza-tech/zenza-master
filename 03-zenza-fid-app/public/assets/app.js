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
/**
 * Attaches a "recent inputs" suggestion dropdown to a text input or
 * textarea. Only used on fields the backend whitelists as non-sensitive
 * (see server/services/inputHistory.js) — the field name passed here must
 * match that whitelist or the API simply returns an empty list.
 */
function attachSuggestions(el, fieldName) {
  const wrapper = el.closest(".field");
  if (wrapper) wrapper.style.position = "relative";

  let dropdown = null;
  let debounceTimer = null;

  function closeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  async function showSuggestions() {
    const q = el.value.trim();
    let suggestions;
    try {
      const data = await api(`/suggestions/${fieldName}?q=${encodeURIComponent(q)}`);
      suggestions = data.suggestions;
    } catch {
      return; // suggestions are a convenience, never worth surfacing an error for
    }
    closeDropdown();
    if (!suggestions || suggestions.length === 0) return;

    dropdown = document.createElement("div");
    dropdown.className = "suggest-dropdown";
    suggestions.forEach((s) => {
      const item = document.createElement("div");
      item.className = "suggest-item";
      item.textContent = s;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus on el through the click
        el.value = s;
        el.dispatchEvent(new Event("input"));
        closeDropdown();
      });
      dropdown.appendChild(item);
    });
    (wrapper || el.parentElement).appendChild(dropdown);
  }

  el.addEventListener("focus", showSuggestions);
  el.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(showSuggestions, 250);
  });
  el.addEventListener("blur", () => setTimeout(closeDropdown, 150));
}

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

/** Uploads files to a watchlist entry. Separate from api() because file
 *  uploads use multipart/form-data, not JSON — the browser sets the
 *  correct Content-Type (with boundary) automatically when FormData is
 *  used, so we must NOT set it manually here. */
async function uploadAttachments(watchlistId, fileList) {
  const formData = new FormData();
  Array.from(fileList).forEach((f) => formData.append("files", f));

  const res = await fetch(`/api/watchlist/${watchlistId}/attachments`, {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Invalid server response" }));
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Not authenticated");
  }
  if (!data.ok) throw new Error(data.error || "Upload failed");
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

  if (can("alerts.view")) document.getElementById("navAlerts").style.display = "";
  if (can("rules.view")) document.getElementById("navRules").style.display = "";
  if (can("audit.view")) document.getElementById("navAudit").style.display = "";
  if (can("users.manage")) document.getElementById("navUsers").style.display = "";
  if (can("audit.view") || can("users.manage")) document.getElementById("adminSep").style.display = "";

  // Which organization am I in? Matters more now that one deployment
  // serves several — an analyst should never have to guess whose data
  // they're looking at.
  const orgBadge = document.getElementById("orgBadge");
  if (orgBadge && state.user.org_name) orgBadge.textContent = state.user.org_name;

  if (state.user.is_platform_admin) {
    document.getElementById("platformSep").style.display = "";
    document.getElementById("navPlatform").style.display = "";
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  });

  initGlobalSearch();
  window.addEventListener("hashchange", route);
  route();
}

function initGlobalSearch() {
  const input = document.getElementById("globalSearch");
  const dropdown = document.getElementById("globalSearchResults");
  let debounceTimer = null;

  function closeResults() {
    dropdown.classList.remove("show");
    dropdown.innerHTML = "";
  }

  async function runSearch() {
    const q = input.value.trim();
    if (q.length < 2) { closeResults(); return; }

    let data;
    try {
      data = await api(`/search?q=${encodeURIComponent(q)}`);
    } catch {
      return;
    }

    const totalResults = data.entities.length + data.watchlist.length;
    if (totalResults === 0) {
      dropdown.innerHTML = `<div class="sr-empty">No matches for "${esc(q)}"</div>`;
      dropdown.classList.add("show");
      return;
    }

    let html = "";
    if (data.entities.length > 0) {
      html += `<div class="sr-group-label">Repository (${data.entities.length})</div>`;
      html += data.entities.map(e => `
        <div class="sr-item" data-type="entity" data-id="${e.id}">
          <div class="sr-title">${esc(e.full_name)}</div>
          <div class="sr-meta">${esc(e.entity_type)} · ${esc(e.status)}${e.keywords ? ` · ${esc(e.keywords.split(" ").slice(0,4).join(", "))}` : ""}</div>
        </div>`).join("");
    }
    if (data.watchlist.length > 0) {
      html += `<div class="sr-group-label">Watchlist (${data.watchlist.length})</div>`;
      html += data.watchlist.map(w => `
        <div class="sr-item" data-type="watchlist" data-id="${w.id}">
          <div class="sr-title">${esc(w.entity_name)} <span class="badge sev-${w.severity}" style="margin-left:6px;">${esc(w.severity)}</span></div>
          <div class="sr-meta">${esc(w.category)} · ${esc(w.status)}</div>
        </div>`).join("");
    }
    dropdown.innerHTML = html;
    dropdown.classList.add("show");

    dropdown.querySelectorAll(".sr-item").forEach((item) => {
      item.addEventListener("click", () => {
        closeResults();
        input.value = "";
        if (item.dataset.type === "entity") openEntityDetailModal(item.dataset.id);
        else openWatchlistDetailModal(item.dataset.id);
      });
    });
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 300);
  });
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) runSearch(); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".topbar-search")) closeResults();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeResults(); input.blur(); } });
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
    alerts: renderAlerts,
    rules: renderRules,
    audit: renderAudit,
    users: renderUsers,
    platform: renderPlatform,
  };
  (renderers[view] || renderDashboard)();
}

// ---------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------
async function renderDashboard() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="view-head"><div><h1>Dashboard</h1><p>Overview of the fraud intelligence repository.</p></div></div><div class="stat-cards" id="statCards"><div class="sc"><span class="n">…</span><span class="l">Loading</span></div></div>`;

  const [entities, activeWl, pendingWl, openAlerts] = await Promise.all([
    api("/entities?limit=1"),
    api("/watchlist?status=active&limit=1"),
    api("/watchlist?status=pending_approval&limit=1"),
    can("alerts.view") ? api("/alerts?status=open&limit=1") : Promise.resolve({ total: null }),
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
    ${openAlerts.total !== null ? `<div class="sc"><span class="n">${openAlerts.total}</span><span class="l">Open Alerts</span></div>` : ""}
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

const IDENTIFIER_PLACEHOLDERS = {
  BVN: "11 digits, e.g. 22212345678",
  NIN: "11 digits, e.g. 22212345678",
  EMAIL: "e.g. name@example.com",
  PHONE: "e.g. 08012345678",
  ACCOUNT: "10-digit NUBAN, e.g. 0123456789",
  DEVICE: "6-128 chars, letters/numbers/-/_/:",
};

function identifierRowsHtml(identifiers = [{ type: "BVN", value: "" }]) {
  return identifiers.map((id, i) => `
    <div class="identifier-row" data-row>
      <select data-id-type>
        ${["BVN","NIN","EMAIL","PHONE","ACCOUNT","DEVICE"].map(t => `<option ${t === id.type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <input type="text" data-id-value placeholder="${IDENTIFIER_PLACEHOLDERS[id.type || "BVN"]}" value="${esc(id.value || "")}">
      <button type="button" class="icon-btn" data-remove-row>&times;</button>
    </div>
  `).join("");
}

function bindIdentifierTypeHints() {
  document.querySelectorAll("[data-id-type]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const valueInput = sel.closest("[data-row]").querySelector("[data-id-value]");
      valueInput.placeholder = IDENTIFIER_PLACEHOLDERS[sel.value] || "Value";
    });
  });
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

  attachSuggestions(document.getElementById("ef_name"), "entity_full_name");
  attachSuggestions(document.getElementById("ef_notes"), "entity_risk_notes");

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
  bindIdentifierTypeHints();
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

  loadNetworkPanel(entity.id); // async, fills in once the modal is on screen
  openModal(`
    <h2>${esc(entity.full_name)}</h2>
    <div class="detail-section">
      <h3>Identifiers</h3>
      ${entity.identifiers.map(i => `<div class="kv-row"><span class="k">${esc(i.identifier_type)}</span><span>${esc(i.identifier_value)}</span></div>`).join("") || `<p class="muted">None on file</p>`}
      <div id="netPanel"></div>
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
  attachSuggestions(document.getElementById("ef_name"), "entity_full_name");
  attachSuggestions(document.getElementById("ef_notes"), "entity_risk_notes");
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
        <option value="recalled">Recalled</option>
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
          <option value="__other__">Other (please specify) →</option>
        </select>
      </div>
      <div class="field" id="wf_customCategoryField" style="display:none;">
        <label>Custom Category</label>
        <input type="text" id="wf_customCategory" placeholder="e.g. Synthetic Identity, Card Skimming">
      </div>
      <div class="field"><label>Severity</label>
        <select id="wf_severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
      </div>
      <div class="field"><label>Reason</label><textarea id="wf_reason" required placeholder="Evidence / justification for this flag (at least 20 characters)" minlength="20"></textarea></div>
      <div class="field"><label>Supporting Documents (optional)</label>
        <input type="file" id="wf_files" multiple accept=".pdf,.docx,.txt,.png,.jpg,.jpeg">
        <p class="form-note" style="margin-top:6px;">PDF, DOCX, TXT, PNG, or JPEG — up to 5 files, 10MB each.</p>
      </div>
      <div class="field"><label>Expires (optional)</label><input type="date" id="wf_expires"></div>
      <p class="muted" style="font-size:12px; margin-bottom:14px;">This submits for approval — it won't take effect until a fraud manager or admin (not you) approves it.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit for Approval</button>
      </div>
    </form>
  `);

  attachSuggestions(document.getElementById("wf_customCategory"), "watchlist_category");
  attachSuggestions(document.getElementById("wf_reason"), "watchlist_reason");

  document.getElementById("wf_category").addEventListener("change", (e) => {
    const customField = document.getElementById("wf_customCategoryField");
    const customInput = document.getElementById("wf_customCategory");
    if (e.target.value === "__other__") {
      customField.style.display = "";
      customInput.required = true;
    } else {
      customField.style.display = "none";
      customInput.required = false;
    }
  });

  document.getElementById("wlForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const expires = document.getElementById("wf_expires").value;
    const rawCategory = document.getElementById("wf_category").value;
    const category = rawCategory === "__other__"
      ? document.getElementById("wf_customCategory").value.trim()
      : rawCategory;

    if (rawCategory === "__other__" && !category) {
      return modalError("Please specify a custom category.");
    }

    try {
      const result = await api("/watchlist", {
        method: "POST",
        body: JSON.stringify({
          entity_id: entity.id,
          category,
          severity: document.getElementById("wf_severity").value,
          reason: document.getElementById("wf_reason").value.trim(),
          expires_at: expires ? new Date(expires).toISOString() : null,
        }),
      });

      const files = document.getElementById("wf_files").files;
      if (files.length > 0) {
        toast("Uploading and analyzing attachment(s)…");
        try {
          await uploadAttachments(result.entry.id, files);
        } catch (uploadErr) {
          toast(`Request created, but file upload failed: ${uploadErr.message}`, "error");
        }
      }

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
  const { results: attachments } = await api(`/watchlist/${id}/attachments`);
  const isOwn = entry.requested_by === state.user.id;

  const actions = [];
  const RECALL_WINDOW_MS = 10 * 60 * 1000;
  const ageMs = Date.now() - new Date(entry.created_at).getTime();
  const withinRecallWindow = ageMs <= RECALL_WINDOW_MS;

  if (entry.status === "pending_approval" && can("watchlist.approve")) {
    if (isOwn) {
      actions.push(`<p class="muted" style="font-size:12px;">You submitted this request — another fraud manager or admin must review it.</p>`);
    } else {
      actions.push(`<button type="button" class="btn btn-ghost" id="wlRejectBtn">Reject</button>`);
      actions.push(`<button type="button" class="btn btn-primary" id="wlApproveBtn">Approve</button>`);
    }
  }
  if (entry.status === "pending_approval" && isOwn && can("watchlist.create")) {
    if (withinRecallWindow) {
      const remainingMin = Math.ceil((RECALL_WINDOW_MS - ageMs) / 60000);
      actions.push(`<button type="button" class="btn btn-ghost" id="wlRecallBtn">Recall (${remainingMin}m left)</button>`);
    } else {
      actions.push(`<p class="muted" style="font-size:11.5px;">Recall window has passed — ask a fraud manager to reject this if it was a mistake.</p>`);
    }
  }
  if (entry.status === "active" && can("watchlist.suspend")) {
    actions.push(`<button type="button" class="btn btn-primary" id="wlSuspendBtn">Suspend</button>`);
  }
  if (entry.status === "suspended" && can("watchlist.suspend")) {
    actions.push(`<button type="button" class="btn btn-primary" id="wlReactivateBtn">Reactivate</button>`);
  }

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function summaryLineHtml(a) {
    if (a.summary_status === "done" && a.ai_summary) {
      return `<div style="font-size:11.5px; color:var(--text-dim); margin:2px 0 8px 22px; font-style:italic;">🤖 ${esc(a.ai_summary)}</div>`;
    }
    if (a.summary_status === "failed") {
      return `<div style="font-size:11px; color:var(--text-dim); margin:2px 0 8px 22px;">AI summary unavailable (request failed — see server logs)</div>`;
    }
    if (a.summary_status === "skipped") {
      return `<div style="font-size:11px; color:var(--text-dim); margin:2px 0 8px 22px;">AI summary not available for this file type</div>`;
    }
    return "";
  }

  const attachmentsHtml = attachments.length
    ? attachments.map(a => `
        <div class="kv-row" style="align-items:flex-start;">
          <span class="k">📎 ${esc(a.original_filename)} <span class="muted">(${fmtBytes(a.size_bytes)})</span></span>
          <a href="/api/watchlist/${id}/attachments/${a.id}/download" style="font-size:12px; color:var(--teal-ink); text-decoration:none;">Download</a>
        </div>
        ${summaryLineHtml(a)}
      `).join("")
    : `<p class="muted" style="font-size:12.5px;">No supporting documents attached.</p>`;

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
      <h3>Supporting Documents</h3>
      ${attachmentsHtml}
      ${can("watchlist.create") ? `
        <div style="margin-top:10px;">
          <input type="file" id="wlAddFiles" multiple accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" style="font-size:12px;">
          <button type="button" class="btn btn-ghost" id="wlAddFilesBtn" style="padding:6px 12px; font-size:12px; margin-top:6px;">Add File(s)</button>
        </div>` : ""}
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

  document.getElementById("wlAddFilesBtn")?.addEventListener("click", async (e) => {
    const files = document.getElementById("wlAddFiles").files;
    if (files.length === 0) return modalError("Choose at least one file first.");
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Analyzing…";
    try {
      await uploadAttachments(id, files);
      toast("File(s) uploaded and analyzed");
      openWatchlistDetailModal(id); // refresh with the new attachment list
    } catch (err) {
      modalError(err.message);
      btn.disabled = false;
      btn.textContent = "Add File(s)";
    }
  });

  document.getElementById("wlApproveBtn")?.addEventListener("click", async () => {
    try { await api(`/watchlist/${id}/approve`, { method: "POST" }); closeModal(); toast("Approved"); loadWatchTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("wlRecallBtn")?.addEventListener("click", async () => {
    if (!confirm("Recall this request? It will be withdrawn and no longer pending approval.")) return;
    try { await api(`/watchlist/${id}/recall`, { method: "POST" }); closeModal(); toast("Request recalled"); loadWatchTable(); }
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
// RULES
// ---------------------------------------------------------------------
state.rules = { status: "", rule_type: "" };

const RULE_TYPE_LABELS = {
  threshold: "Threshold",
  velocity: "Velocity",
  pattern: "Pattern Match",
  cross_entity: "Cross-Entity Link",
};

async function renderRules() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head">
      <div><h1>Detection Rules</h1><p>Automated checks that scan the repository and raise alerts when they match.</p></div>
      ${can("rules.manage") ? `<button class="btn btn-primary" id="newRuleBtn">+ New Rule</button>` : ""}
    </div>
    <div class="toolbar">
      <select id="ruleStatus">
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
      <div class="spacer"></div>
    </div>
    <div id="rulesTableWrap"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("newRuleBtn")?.addEventListener("click", openRuleFormModal);
  document.getElementById("ruleStatus").addEventListener("change", (e) => { state.rules.status = e.target.value; loadRulesTable(); });
  loadRulesTable();
}

async function loadRulesTable() {
  const wrap = document.getElementById("rulesTableWrap");
  const params = new URLSearchParams();
  if (state.rules.status) params.set("status", state.rules.status);
  const data = await api(`/rules?${params}`);

  if (data.results.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No rules yet. ${can("rules.manage") ? "Create the first one with \u201c+ New Rule.\u201d" : ""}</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Name</th><th>Type</th><th>Severity</th><th>Status</th><th>Open Alerts</th><th>Last Run</th></tr></thead>
      <tbody>
        ${data.results.map(r => `
          <tr data-id="${r.id}">
            <td><strong>${esc(r.name)}</strong></td>
            <td class="muted">${RULE_TYPE_LABELS[r.rule_type] || esc(r.rule_type)}</td>
            <td><span class="badge sev-${r.severity}">${esc(r.severity)}</span></td>
            <td><span class="badge status-${r.status === 'active' ? 'active' : r.status === 'disabled' ? 'suspended' : 'pending_approval'}">${esc(r.status)}</span></td>
            <td>${r.open_alert_count > 0 ? `<span class="badge status-pending_approval">${r.open_alert_count}</span>` : `<span class="muted">0</span>`}</td>
            <td class="muted">${r.last_run_at ? fmtDate(r.last_run_at) : "Never"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => openRuleDetailModal(tr.dataset.id)));
}

function ruleConfigFieldsHtml(ruleType, config = {}) {
  switch (ruleType) {
    case "threshold":
      return `
        <div class="field"><label>Identifier Type (optional — blank means any type)</label>
          <select id="rf_identifier_type">
            <option value="" ${!config.identifier_type ? "selected" : ""}>Any</option>
            ${["BVN","NIN","EMAIL","PHONE","ACCOUNT","DEVICE"].map(t => `<option ${config.identifier_type===t?"selected":""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Count (fires at or above this many)</label><input type="number" id="rf_count" min="1" value="${config.count || 2}"></div>`;
    case "velocity":
      return `
        <div class="field"><label>Metric</label>
          <select id="rf_metric">
            <option value="watchlist_entries" ${config.metric==="watchlist_entries"?"selected":""}>Watchlist submissions</option>
            <option value="entity_edits" ${config.metric==="entity_edits"?"selected":""}>Profile edits</option>
          </select>
        </div>
        <div class="field"><label>Window (hours)</label><input type="number" id="rf_window" min="1" value="${config.window_hours || 24}"></div>
        <div class="field"><label>Count (fires at or above this many, within the window)</label><input type="number" id="rf_count" min="1" value="${config.count || 2}"></div>`;
    case "pattern":
      return `
        <div class="field"><label>Identifier Type</label>
          <select id="rf_identifier_type">
            ${["BVN","NIN","EMAIL","PHONE","ACCOUNT","DEVICE"].map(t => `<option ${config.identifier_type===t?"selected":""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Pattern (regular expression)</label><input type="text" id="rf_pattern" value="${esc(config.pattern || "")}" placeholder="e.g. ^.*@tempmail\\.com$"></div>`;
    case "cross_entity":
      return `<p class="muted" style="font-size:13px;">No configuration needed — this rule flags any entity that shares an identifier (BVN, email, phone, etc.) with another entity that already has an active watchlist entry.</p>`;
    default:
      return "";
  }
}

function collectRuleConfig(ruleType) {
  switch (ruleType) {
    case "threshold":
      return {
        identifier_type: document.getElementById("rf_identifier_type").value || null,
        count: Number(document.getElementById("rf_count").value),
      };
    case "velocity":
      return {
        metric: document.getElementById("rf_metric").value,
        window_hours: Number(document.getElementById("rf_window").value),
        count: Number(document.getElementById("rf_count").value),
      };
    case "pattern":
      return {
        identifier_type: document.getElementById("rf_identifier_type").value,
        pattern: document.getElementById("rf_pattern").value,
      };
    case "cross_entity":
      return {};
    default:
      return {};
  }
}

function openRuleFormModal() {
  openModal(`
    <h2>New Detection Rule</h2>
    <div class="modal-error"></div>
    <form id="ruleForm">
      <div class="field"><label>Name</label><input type="text" id="rf_name" required></div>
      <div class="field"><label>Description</label><textarea id="rf_description" placeholder="What is this rule looking for, and why?"></textarea></div>
      <div class="field"><label>Rule Type</label>
        <select id="rf_type">
          <option value="threshold">Threshold — entity has N+ identifiers of a type</option>
          <option value="velocity">Velocity — N+ events within a time window</option>
          <option value="pattern">Pattern Match — identifier matches a regex</option>
          <option value="cross_entity">Cross-Entity Link — shares an identifier with a watchlisted entity</option>
        </select>
      </div>
      <div id="rf_configFields">${ruleConfigFieldsHtml("threshold")}</div>
      <div class="field"><label>Severity (applied to alerts this rule creates)</label>
        <select id="rf_severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
      </div>
      <p class="muted" style="font-size:12px; margin-bottom:14px;">New rules start as a draft. You can simulate a draft rule before activating it — nothing runs for real until you activate it.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Rule (Draft)</button>
      </div>
    </form>
  `);

  document.getElementById("rf_type").addEventListener("change", (e) => {
    document.getElementById("rf_configFields").innerHTML = ruleConfigFieldsHtml(e.target.value);
  });

  document.getElementById("ruleForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ruleType = document.getElementById("rf_type").value;
    try {
      await api("/rules", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("rf_name").value.trim(),
          description: document.getElementById("rf_description").value.trim(),
          rule_type: ruleType,
          config: collectRuleConfig(ruleType),
          severity: document.getElementById("rf_severity").value,
        }),
      });
      closeModal();
      toast("Rule created as draft");
      loadRulesTable();
    } catch (err) {
      modalError(err.message);
    }
  });
}

async function openRuleDetailModal(id) {
  const { rule } = await api(`/rules/${id}`);
  const actions = [];
  if (can("rules.manage")) {
    if (rule.status === "draft" || rule.status === "disabled") {
      actions.push(`<button type="button" class="btn btn-primary" id="ruleActivateBtn">Activate</button>`);
    }
    if (rule.status === "active") {
      actions.push(`<button type="button" class="btn btn-ghost" id="ruleDisableBtn">Disable</button>`);
      actions.push(`<button type="button" class="btn btn-primary" id="ruleRunBtn">Run Now</button>`);
    }
  }
  actions.push(`<button type="button" class="btn btn-ghost" id="ruleSimulateBtn">Simulate</button>`);

  openModal(`
    <h2>${esc(rule.name)}</h2>
    <div class="modal-error"></div>
    <div class="detail-section">
      <div class="kv-row"><span class="k">Type</span><span>${RULE_TYPE_LABELS[rule.rule_type]}</span></div>
      <div class="kv-row"><span class="k">Status</span><span class="badge status-${rule.status === 'active' ? 'active' : rule.status === 'disabled' ? 'suspended' : 'pending_approval'}">${esc(rule.status)}</span></div>
      <div class="kv-row"><span class="k">Severity</span><span class="badge sev-${rule.severity}">${esc(rule.severity)}</span></div>
      <div class="kv-row"><span class="k">Last Run</span><span>${rule.last_run_at ? fmtDate(rule.last_run_at) : "Never"}</span></div>
    </div>
    <div class="detail-section">
      <h3>Description</h3>
      <p style="font-size:13.5px;">${esc(rule.description) || "—"}</p>
    </div>
    <div class="detail-section">
      <h3>Configuration</h3>
      <p style="font-size:12.5px; font-family:'IBM Plex Mono'; color:var(--text-dim);">${esc(JSON.stringify(rule.config))}</p>
    </div>
    <div id="simResults"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
      ${actions.join("")}
    </div>
  `);

  document.getElementById("ruleActivateBtn")?.addEventListener("click", async () => {
    try { await api(`/rules/${id}/activate`, { method: "POST" }); closeModal(); toast("Rule activated"); loadRulesTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("ruleDisableBtn")?.addEventListener("click", async () => {
    try { await api(`/rules/${id}/disable`, { method: "POST" }); closeModal(); toast("Rule disabled"); loadRulesTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("ruleRunBtn")?.addEventListener("click", async () => {
    try {
      const result = await api(`/rules/${id}/run`, { method: "POST" });
      toast(`Run complete — ${result.created} new alert(s), ${result.skipped} already open`);
      closeModal();
      loadRulesTable();
    } catch (err) { modalError(err.message); }
  });
  document.getElementById("ruleSimulateBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("simResults");
    box.innerHTML = `<p class="muted" style="font-size:12.5px;">Simulating…</p>`;
    try {
      const result = await api(`/rules/${id}/simulate`, { method: "POST" });
      box.innerHTML = `
        <div class="detail-section">
          <h3>Simulation Result — ${result.matchCount} match(es), no alerts created</h3>
          ${result.matches.slice(0, 10).map(m => `<div class="kv-row"><span class="k">${esc(m.entity_name)}</span><span style="font-size:12px; color:var(--text-dim);">${esc(m.reason)}</span></div>`).join("") || `<p class="muted">No entities currently match this rule.</p>`}
          ${result.matchCount > 10 ? `<p class="muted" style="font-size:12px; margin-top:8px;">+ ${result.matchCount - 10} more</p>` : ""}
        </div>`;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red-ink); font-size:12.5px;">${esc(err.message)}</p>`;
    }
  });
}

// ---------------------------------------------------------------------
// ALERTS
// ---------------------------------------------------------------------
state.alertsState = { status: "open", severity: "" };

async function renderAlerts() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head"><div><h1>Alerts</h1><p>Entities flagged automatically by active detection rules.</p></div></div>
    <div class="toolbar">
      <select id="alertStatus">
        <option value="open" selected>Open</option>
        <option value="escalated">Escalated</option>
        <option value="dismissed">Dismissed</option>
        <option value="">All statuses</option>
      </select>
      <select id="alertSeverity">
        <option value="">All severities</option>
        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
      </select>
      <div class="spacer"></div>
    </div>
    <div id="alertsTableWrap"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("alertStatus").addEventListener("change", (e) => { state.alertsState.status = e.target.value; loadAlertsTable(); });
  document.getElementById("alertSeverity").addEventListener("change", (e) => { state.alertsState.severity = e.target.value; loadAlertsTable(); });
  loadAlertsTable();
}

async function loadAlertsTable() {
  const wrap = document.getElementById("alertsTableWrap");
  const params = new URLSearchParams();
  if (state.alertsState.status) params.set("status", state.alertsState.status);
  if (state.alertsState.severity) params.set("severity", state.alertsState.severity);
  const data = await api(`/alerts?${params}`);

  if (data.results.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No alerts match these filters.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Entity</th><th>Rule</th><th>Severity</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>
        ${data.results.map(a => `
          <tr data-id="${a.id}">
            <td><strong>${esc(a.entity_name)}</strong></td>
            <td class="muted">${esc(a.rule_name)}</td>
            <td><span class="badge sev-${a.severity}">${esc(a.severity)}</span></td>
            <td><span class="badge status-${a.status === 'open' ? 'pending_approval' : a.status === 'escalated' ? 'active' : 'suspended'}">${esc(a.status)}</span></td>
            <td class="muted">${fmtDate(a.created_at)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  wrap.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => openAlertDetailModal(tr.dataset.id)));
}

async function openAlertDetailModal(id) {
  const { alert } = await api(`/alerts/${id}`);
  const actions = [];
  if (alert.status === "open" && can("alerts.action")) {
    actions.push(`<button type="button" class="btn btn-ghost" id="alertDismissBtn">Dismiss</button>`);
    actions.push(`<button type="button" class="btn btn-primary" id="alertEscalateBtn">Escalate to Watchlist</button>`);
  }

  openModal(`
    <h2>${esc(alert.entity_name)}</h2>
    <div class="modal-error"></div>
    <div class="detail-section">
      <div class="kv-row"><span class="k">Triggered By</span><span>${esc(alert.rule_name)}</span></div>
      <div class="kv-row"><span class="k">Severity</span><span class="badge sev-${alert.severity}">${esc(alert.severity)}</span></div>
      <div class="kv-row"><span class="k">Status</span><span class="badge status-${alert.status === 'open' ? 'pending_approval' : alert.status === 'escalated' ? 'active' : 'suspended'}">${esc(alert.status)}</span></div>
      <div class="kv-row"><span class="k">Created</span><span>${fmtDate(alert.created_at)}</span></div>
      ${alert.reviewed_by_name ? `<div class="kv-row"><span class="k">Reviewed By</span><span>${esc(alert.reviewed_by_name)}</span></div>` : ""}
    </div>
    <div class="detail-section">
      <h3>Reason</h3>
      <p style="font-size:13.5px;">${esc(alert.triggered_reason)}</p>
    </div>
    ${alert.review_notes ? `<div class="detail-section"><h3>Review Notes</h3><p style="font-size:13.5px;">${esc(alert.review_notes)}</p></div>` : ""}
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
      ${actions.join("")}
    </div>
  `);

  document.getElementById("alertDismissBtn")?.addEventListener("click", async () => {
    const notes = prompt("Reason for dismissing this alert (required):");
    if (!notes) return;
    try { await api(`/alerts/${id}/dismiss`, { method: "POST", body: JSON.stringify({ notes }) }); closeModal(); toast("Alert dismissed"); loadAlertsTable(); }
    catch (err) { modalError(err.message); }
  });
  document.getElementById("alertEscalateBtn")?.addEventListener("click", async () => {
    try {
      const result = await api(`/alerts/${id}/escalate`, { method: "POST", body: JSON.stringify({ category: "other" }) });
      closeModal();
      toast(`Escalated to watchlist request #${result.watchlist_id} — pending approval`);
      loadAlertsTable();
    } catch (err) { modalError(err.message); }
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
const ROLE_DESCRIPTIONS = {
  admin: "Full system access — user management, audit log, everything analysts and fraud managers can do.",
  fraud_manager: "Approves watchlist requests, manages detection rules, reviews the audit log. Cannot manage other users.",
  analyst: "Creates and investigates entities, submits watchlist requests, handles alerts. Cannot approve their own requests or manage rules.",
};
const ROLE_LABELS = { admin: "Admin", fraud_manager: "Fraud Manager", analyst: "Analyst" };

state.usersState = { q: "", role: "", status: "" };

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
    <div class="stat-cards" id="userStatCards"><div class="sc"><span class="n">…</span><span class="l">Loading</span></div></div>

    <div class="callout" style="margin-bottom:22px;">
      <h3 style="font-size:14px; margin-bottom:10px;">What each role can do</h3>
      <div class="role-legend">
        ${Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => `
          <div class="role-legend-item">
            <span class="badge status-active" style="margin-bottom:6px; display:inline-block;">${ROLE_LABELS[role]}</span>
            <p>${desc}</p>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="toolbar">
      <input type="text" id="userSearch" placeholder="Search name or email…" style="min-width:220px;">
      <select id="userRoleFilter">
        <option value="">All roles</option>
        <option value="admin">Admin</option>
        <option value="fraud_manager">Fraud Manager</option>
        <option value="analyst">Analyst</option>
      </select>
      <select id="userStatusFilter">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
      <div class="spacer"></div>
    </div>
    <div id="usersTableWrap"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("newUserBtn").addEventListener("click", openNewUserModal);
  document.getElementById("changePwBtn").addEventListener("click", openChangePasswordModal);
  document.getElementById("userSearch").addEventListener("input", debounce((e) => { state.usersState.q = e.target.value.toLowerCase(); loadUsersTable(); }, 250));
  document.getElementById("userRoleFilter").addEventListener("change", (e) => { state.usersState.role = e.target.value; loadUsersTable(); });
  document.getElementById("userStatusFilter").addEventListener("change", (e) => { state.usersState.status = e.target.value; loadUsersTable(); });
  loadUsersTable();
}

async function loadUsersTable() {
  const { results, roles } = await Promise.all([api("/users"), api("/users/roles")]).then(([a,b]) => ({ results: a.results, roles: b.roles }));

  const activeCount = results.filter(u => u.status === "active").length;
  const byRole = results.reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {});
  document.getElementById("userStatCards").innerHTML = `
    <div class="sc"><span class="n">${results.length}</span><span class="l">Total Users</span></div>
    <div class="sc"><span class="n">${activeCount}</span><span class="l">Active</span></div>
    <div class="sc"><span class="n">${byRole.admin || 0}</span><span class="l">Admins</span></div>
    <div class="sc"><span class="n">${(byRole.fraud_manager || 0) + (byRole.analyst || 0)}</span><span class="l">Analysts + Fraud Managers</span></div>
  `;

  const { q, role, status } = state.usersState;
  const filtered = results.filter(u =>
    (!q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
    (!role || u.role === role) &&
    (!status || u.status === status)
  );

  const wrap = document.getElementById("usersTableWrap");
  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No users match these filters.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th></th></tr></thead>
      <tbody>
        ${filtered.map(u => `
          <tr>
            <td><strong>${esc(u.full_name)}</strong>${u.id === state.user.id ? ` <span class="muted" style="font-size:11px;">(you)</span>` : ""}</td>
            <td class="muted">${esc(u.email)}</td>
            <td>
              <select data-role-select data-uid="${u.id}" data-prev="${u.role}" title="${esc(ROLE_DESCRIPTIONS[u.role] || "")}" ${u.id === state.user.id ? "disabled" : ""}>
                ${roles.map(r => `<option value="${r.name}" ${r.name === u.role ? "selected" : ""}>${ROLE_LABELS[r.name] || r.name}</option>`).join("")}
              </select>
            </td>
            <td><span class="badge ${u.status === "active" ? "status-active" : "status-suspended"}">${u.status}</span></td>
            <td class="muted">${fmtDate(u.last_login_at)}</td>
            <td>
              <button class="btn btn-ghost" style="padding:6px 10px; font-size:12px;" data-toggle-status data-uid="${u.id}" data-status="${u.status}" data-name="${esc(u.full_name)}" ${u.id === state.user.id ? "disabled" : ""}>
                ${u.status === "active" ? "Disable" : "Enable"}
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <p class="muted" style="font-size:11.5px; margin-top:12px;">Showing ${filtered.length} of ${results.length} users. Hover a role to see what it can do.</p>
  `;
  wrap.querySelectorAll("[data-role-select]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const name = sel.closest("tr").querySelector("td strong").textContent;
      if (!confirm(`Change ${name}'s role from ${ROLE_LABELS[sel.dataset.prev]} to ${ROLE_LABELS[sel.value]}?\n\n${ROLE_DESCRIPTIONS[sel.value]}`)) {
        sel.value = sel.dataset.prev;
        return;
      }
      try {
        await api(`/users/${sel.dataset.uid}/role`, { method: "PUT", body: JSON.stringify({ role: sel.value }) });
        toast("Role updated");
        sel.dataset.prev = sel.value;
        sel.title = ROLE_DESCRIPTIONS[sel.value] || "";
      } catch (err) {
        toast(err.message, "error");
        sel.value = sel.dataset.prev;
      }
    });
  });
  wrap.querySelectorAll("[data-toggle-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.status === "active" ? "disabled" : "active";
      if (next === "disabled" && !confirm(`Disable ${btn.dataset.name}'s account? They'll be signed out and unable to log back in until re-enabled.`)) return;
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
        <select id="nu_role">
          <option value="analyst">Analyst</option>
          <option value="fraud_manager">Fraud Manager</option>
          <option value="admin">Admin</option>
        </select>
        <p class="muted" style="font-size:12px; margin-top:6px;" id="nu_roleDesc">${ROLE_DESCRIPTIONS.analyst}</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create User</button>
      </div>
    </form>
  `);
  document.getElementById("nu_role").addEventListener("change", (e) => {
    document.getElementById("nu_roleDesc").textContent = ROLE_DESCRIPTIONS[e.target.value] || "";
  });
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

// ---------------------------------------------------------------------
// CROSS-INSTITUTION NETWORK CHECK
// ---------------------------------------------------------------------
/**
 * Asks the network whether other institutions have flagged this entity's
 * identifiers. Deliberately shows counts and categories only — the API
 * never returns which institution reported, or their notes, so there's
 * nothing more to render even if we wanted to.
 */
async function loadNetworkPanel(entityId) {
  const panel = document.getElementById("netPanel");
  if (!panel) return;

  let data;
  try {
    data = await api(`/network/check/${entityId}`);
  } catch {
    return; // network check is additive; never break the profile view over it
  }

  if (!data.participating) {
    panel.innerHTML = `<div class="net-panel clean"><h4>Cross-institution network</h4>
      <p class="net-note">Your organization isn't enrolled in the shared intelligence network. Contact your Zenza administrator to enable it.</p></div>`;
    return;
  }

  if (data.matches.length === 0) {
    panel.innerHTML = `<div class="net-panel clean"><h4>✓ No other institution has flagged these identifiers</h4>
      <p class="net-note">Checked against the shared network. A clean result isn't proof of good standing — only that no participating institution has reported these identifiers.</p></div>`;
    return;
  }

  panel.innerHTML = `
    <div class="net-panel">
      <h4>⚠ Flagged by other institutions</h4>
      ${data.matches.map(m => `
        <div class="net-match">
          <span><strong>${esc(m.identifier_type)}</strong> ${esc(m.identifier_value)}</span>
          <span>
            <span class="badge sev-${m.highest_severity}">${esc(m.highest_severity)}</span>
            ${m.reporting_institution_count} institution${m.reporting_institution_count === 1 ? "" : "s"} ·
            ${m.categories.map(c => esc(c.replace(/_/g, " "))).join(", ")}
          </span>
        </div>`).join("")}
      <p class="net-note">Reporting institutions are not identified, and their case details are never shared — only that a match exists. Treat this as a signal to investigate, not as evidence on its own.</p>
    </div>`;
}

// ---------------------------------------------------------------------
// PLATFORM ADMINISTRATION (Zenza operators only — not customers)
// ---------------------------------------------------------------------
function fmtBytesShort(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderPlatform() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Organizations</h1>
        <p>Customer accounts on this deployment — operational status only, never their case data.</p>
      </div>
      <button class="btn btn-primary" id="newOrgBtn">+ Onboard Organization</button>
    </div>
    <div class="stat-cards" id="platStats"><div class="sc"><span class="n">…</span><span class="l">Loading</span></div></div>
    <div class="callout" style="margin-bottom:20px;">
      <p style="font-size:12.5px; color:var(--text-dim); line-height:1.55;">
        You can see how much each organization is using the platform, and manage their access and plan.
        You <strong>cannot</strong> see the entities they've profiled, the identifiers they hold, or what their
        analysts wrote — that boundary is enforced in the API, not by convention.
      </p>
    </div>
    <div class="toolbar">
      <select id="orgStatusFilter">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="archived">Archived</option>
      </select>
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="platAuditBtn" style="padding:8px 14px; font-size:12.5px;">Platform Audit Log</button>
    </div>
    <div id="orgList"><div class="empty-state">Loading…</div></div>
  `;
  document.getElementById("newOrgBtn").addEventListener("click", openNewOrgModal);
  document.getElementById("platAuditBtn").addEventListener("click", openPlatformAuditModal);
  document.getElementById("orgStatusFilter").addEventListener("change", loadOrgList);
  loadPlatformStats();
  loadOrgList();
}

async function loadPlatformStats() {
  const s = await api("/platform/stats");
  document.getElementById("platStats").innerHTML = `
    <div class="sc"><span class="n">${s.organizations.active}</span><span class="l">Active Organizations</span></div>
    <div class="sc"><span class="n">${s.users}</span><span class="l">Total Users</span></div>
    <div class="sc"><span class="n">${s.network.participating_organizations}</span><span class="l">In Fraud Network</span></div>
    <div class="sc"><span class="n">${s.network.active_signals}</span><span class="l">Network Signals</span></div>
  `;
}

async function loadOrgList() {
  const status = document.getElementById("orgStatusFilter").value;
  const { results } = await api(`/platform/organizations${status ? `?status=${status}` : ""}`);
  const wrap = document.getElementById("orgList");

  if (results.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No organizations match this filter.</div>`;
    return;
  }

  wrap.innerHTML = results.map(o => {
    const m = o.metrics || {};
    const statusBadge = o.status === "active" ? "status-active" : o.status === "suspended" ? "status-suspended" : "status-rejected";
    return `
    <div class="plat-org">
      <div class="plat-org-head">
        <div>
          <h3>${esc(o.name)} ${o.id === state.user.org_id ? `<span class="muted" style="font-size:11px;">(your organization)</span>` : ""}</h3>
          <p class="muted" style="font-size:12px; margin-top:3px;">
            ${esc(o.slug)} · ${esc(o.plan)} plan · onboarded ${fmtDate(o.created_at)}
            ${o.users.last_login ? ` · last login ${fmtDate(o.users.last_login)}` : " · never signed in"}
          </p>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${o.network_enabled ? `<span class="badge status-active">network on</span>` : `<span class="badge status-rejected">network off</span>`}
          <span class="badge ${statusBadge}">${esc(o.status)}</span>
        </div>
      </div>
      <div class="plat-metrics">
        <div class="plat-metric"><span class="n">${o.users.active}</span><span class="l">Users</span></div>
        <div class="plat-metric"><span class="n">${m.entities ?? "—"}</span><span class="l">Entities</span></div>
        <div class="plat-metric"><span class="n">${m.watchlist_active ?? "—"}</span><span class="l">Watchlisted</span></div>
        <div class="plat-metric"><span class="n">${m.alerts_open ?? "—"}</span><span class="l">Open Alerts</span></div>
        <div class="plat-metric"><span class="n">${m.rules_active ?? "—"}</span><span class="l">Active Rules</span></div>
        <div class="plat-metric"><span class="n">${fmtBytesShort(o.storage_bytes)}</span><span class="l">Storage</span></div>
      </div>
      <p class="muted" style="font-size:11.5px;">Last activity: ${m.last_activity ? fmtDate(m.last_activity) : "none recorded"}</p>
      <div class="plat-actions">
        <button class="btn btn-ghost" data-org-edit="${o.id}">Edit Plan / Network</button>
        ${o.status === "active" ? `<button class="btn btn-ghost" data-org-suspend="${o.id}" data-name="${esc(o.name)}">Suspend</button>` : ""}
        ${o.status !== "active" ? `<button class="btn btn-primary" data-org-reactivate="${o.id}">Reactivate</button>` : ""}
        ${o.status !== "archived" ? `<button class="btn btn-ghost" data-org-archive="${o.id}" data-name="${esc(o.name)}">Archive</button>` : ""}
        ${o.status === "archived" ? `<button class="btn btn-ghost" style="color:var(--red-ink);" data-org-purge="${o.id}" data-name="${esc(o.name)}">Purge Permanently</button>` : ""}
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll("[data-org-edit]").forEach(b => b.addEventListener("click", () => openEditOrgModal(b.dataset.orgEdit)));
  wrap.querySelectorAll("[data-org-suspend]").forEach(b => b.addEventListener("click", async () => {
    const reason = prompt(`Suspend ${b.dataset.name}? Everyone there is signed out immediately and network sharing stops. Reason:`);
    if (reason === null) return;
    try { await api(`/platform/organizations/${b.dataset.orgSuspend}/suspend`, { method: "POST", body: JSON.stringify({ reason }) }); toast("Organization suspended"); loadOrgList(); loadPlatformStats(); }
    catch (e) { toast(e.message, "error"); }
  }));
  wrap.querySelectorAll("[data-org-reactivate]").forEach(b => b.addEventListener("click", async () => {
    try { await api(`/platform/organizations/${b.dataset.orgReactivate}/reactivate`, { method: "POST" }); toast("Organization reactivated"); loadOrgList(); loadPlatformStats(); }
    catch (e) { toast(e.message, "error"); }
  }));
  wrap.querySelectorAll("[data-org-archive]").forEach(b => b.addEventListener("click", async () => {
    const reason = prompt(`Archive ${b.dataset.name}? Access is revoked but their data is retained on disk. Reason:`);
    if (reason === null) return;
    try { await api(`/platform/organizations/${b.dataset.orgArchive}/archive`, { method: "POST", body: JSON.stringify({ reason }) }); toast("Organization archived"); loadOrgList(); loadPlatformStats(); }
    catch (e) { toast(e.message, "error"); }
  }));
  wrap.querySelectorAll("[data-org-purge]").forEach(b => b.addEventListener("click", async () => {
    const typed = prompt(`PERMANENT DELETION — this cannot be undone.\n\nThis erases ${b.dataset.name}'s entire fraud repository, every uploaded file, and all their user accounts.\n\nType the organization name exactly to confirm:`);
    if (!typed) return;
    try {
      const r = await api(`/platform/organizations/${b.dataset.orgPurge}/purge`, { method: "DELETE", body: JSON.stringify({ confirm_name: typed }) });
      toast(`Purged — ${r.purged.users} user(s), ${r.purged.files} file(s), database removed`);
      loadOrgList(); loadPlatformStats();
    } catch (e) { toast(e.message, "error"); }
  }));
}

function openNewOrgModal() {
  openModal(`
    <h2>Onboard Organization</h2>
    <div class="modal-error"></div>
    <form id="newOrgForm">
      <div class="field"><label>Organization Name</label><input type="text" id="no_name" required placeholder="e.g. Acme Microfinance Bank"></div>
      <div class="field"><label>Plan</label>
        <select id="no_plan"><option value="starter">Starter</option><option value="growth">Growth</option><option value="enterprise">Enterprise</option></select>
      </div>
      <div class="field"><label>First Admin — Full Name</label><input type="text" id="no_adminName" required></div>
      <div class="field"><label>First Admin — Email</label><input type="email" id="no_adminEmail" required></div>
      <div class="field">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="no_network" style="width:auto;">
          Enrol in the cross-institution fraud network
        </label>
        <p class="muted" style="font-size:11.5px; margin-top:6px;">
          Off by default, deliberately. Only enable this once the customer has actually agreed to
          contribute and consume shared signals — enrolling someone's data in a sharing scheme
          without their say-so isn't a defensible consent position.
        </p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Organization</button>
      </div>
    </form>
  `);
  document.getElementById("newOrgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/platform/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("no_name").value.trim(),
          plan: document.getElementById("no_plan").value,
          admin_name: document.getElementById("no_adminName").value.trim(),
          admin_email: document.getElementById("no_adminEmail").value.trim(),
          network_enabled: document.getElementById("no_network").checked,
        }),
      });
      closeModal();
      openModal(`
        <h2>Organization Created</h2>
        <div class="detail-section">
          <div class="kv-row"><span class="k">Organization</span><span>${esc(r.organization.name)}</span></div>
          <div class="kv-row"><span class="k">Admin email</span><span>${esc(r.admin.email)}</span></div>
          <div class="kv-row"><span class="k">Temporary password</span><span style="font-family:'IBM Plex Mono';">${esc(r.admin.temporary_password)}</span></div>
        </div>
        <p class="muted" style="font-size:12px;">This password is shown once. Share it through a secure channel and have them change it at first login.</p>
        <div class="modal-actions"><button type="button" class="btn btn-primary" onclick="closeModal()">Done</button></div>
      `);
      loadOrgList(); loadPlatformStats();
    } catch (err) { modalError(err.message); }
  });
}

async function openEditOrgModal(id) {
  const { organization } = await api(`/platform/organizations/${id}`);
  openModal(`
    <h2>${esc(organization.name)}</h2>
    <div class="modal-error"></div>
    <form id="editOrgForm">
      <div class="field"><label>Organization Name</label><input type="text" id="eo_name" value="${esc(organization.name)}"></div>
      <div class="field"><label>Plan</label>
        <select id="eo_plan">
          ${["starter","growth","enterprise"].map(p => `<option value="${p}" ${organization.plan===p?"selected":""}>${p[0].toUpperCase()+p.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="eo_network" ${organization.network_enabled ? "checked" : ""} style="width:auto;">
          Enrolled in the cross-institution fraud network
        </label>
        <p class="muted" style="font-size:11.5px; margin-top:6px;">
          Turning this OFF immediately purges every signal this organization has contributed —
          opting out has to actually mean opting out, not just hiding the toggle.
        </p>
      </div>
      <div class="field"><label>Internal Notes</label><textarea id="eo_notes" placeholder="Account notes — visible to Zenza operators only">${esc(organization.notes || "")}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `);
  document.getElementById("editOrgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/platform/organizations/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: document.getElementById("eo_name").value.trim(),
          plan: document.getElementById("eo_plan").value,
          network_enabled: document.getElementById("eo_network").checked,
          notes: document.getElementById("eo_notes").value.trim(),
        }),
      });
      closeModal();
      toast(r.changes.network_signals_purged !== undefined
        ? `Saved — ${r.changes.network_signals_purged} network signal(s) purged`
        : "Organization updated");
      loadOrgList(); loadPlatformStats();
    } catch (err) { modalError(err.message); }
  });
}

async function openPlatformAuditModal() {
  const { results, total } = await api("/platform/audit?limit=50");
  openModal(`
    <h2>Platform Audit Log</h2>
    <p class="muted" style="font-size:12px; margin-bottom:14px;">
      Actions taken by Zenza operators on customer accounts (${total} total). Separate from each
      organization's own audit trail, which we don't read. Insert-only — entries here can't be edited or removed.
    </p>
    <div class="timeline-mini">
      ${results.map(r => `
        <div class="t-item">
          <div class="t-action">${esc(r.action.replace("platform.", "").replace(/_/g, " "))}${r.target_org_id ? ` — org #${r.target_org_id}` : ""}</div>
          <div class="t-meta">${esc(r.actor_name)} · ${fmtDate(r.created_at)}${r.details ? ` · ${esc(JSON.stringify(r.details).slice(0, 90))}` : ""}</div>
        </div>`).join("") || `<p class="muted">No platform actions recorded yet.</p>`}
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button></div>
  `);
}
