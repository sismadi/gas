/**
 * =========================================================
 * APP.JS — Frontend dinamis
 * Tidak ada nama field tabel yang di-hardcode di sini.
 * Table & form dibangun murni dari JSON yang dikembalikan
 * oleh /api/meta/:table (schema) dan /api/:table (data).
 * =========================================================
 */

// ---- Konfigurasi: ganti sesuai URL Worker Anda saat deploy ----
const CONFIG = {
  API_BASE: window.API_BASE || "/api", // contoh produksi: "https://sismadi-microservice.<subdomain>.workers.dev/api"
  PAGE_SIZE: 10,
};

// ---- State aplikasi ----
const state = {
  route: null,          // nama tabel aktif, ex: 'menu' | 'users' | 'dashboard' | tabel lain
  schema: null,          // hasil /api/meta/:route
  page: 1,
  search: "",
  sort: null,
  order: "asc",
  drawerMode: null,      // 'create' | 'edit'
  drawerRow: null,
};

// ---- DOM refs ----
const el = {
  nav: document.getElementById("nav-menu"),
  content: document.getElementById("content"),
  pageTitle: document.getElementById("page-title"),
  pageSub: document.getElementById("page-sub"),
  topbarActions: document.getElementById("topbar-actions"),
  overlay: document.getElementById("overlay"),
  drawer: document.getElementById("drawer"),
  drawerTitle: document.getElementById("drawer-title"),
  drawerForm: document.getElementById("drawer-form"),
  drawerError: document.getElementById("drawer-error"),
  drawerDelete: document.getElementById("drawer-delete"),
  drawerCancel: document.getElementById("drawer-cancel"),
  drawerClose: document.getElementById("drawer-close"),
  toast: document.getElementById("toast"),
};

// =========================================================
// UTIL
// =========================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("toast--error", isError);
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), 2600);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(CONFIG.API_BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let body;
  try {
    body = await res.json();
  } catch (_) {
    body = { success: false, message: "Respons server tidak valid" };
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Permintaan gagal (${res.status})`);
  }
  return body; // { success, data, meta? }
}

// =========================================================
// NAVIGASI / SIDEBAR (dinamis dari /api/menu)
// =========================================================
async function loadMenu() {
  try {
    const res = await apiFetch(`/menu?limit=100&sort=urutan&order=asc`);
    const items = (res.data || []).filter((m) => (m.status || "aktif") === "aktif");
    renderNav(items);
    const first = items[0];
    navigate(first ? first.route : "dashboard");
  } catch (err) {
    el.nav.innerHTML = `<div class="muted" style="padding:8px">Gagal memuat menu</div>`;
    showToast(err.message, true);
  }
}

function renderNav(items) {
  el.nav.innerHTML = items
    .map(
      (m) => `
      <div class="nav-item" data-route="${escapeHtml(m.route)}">
        <span class="nav-icon">${iconGlyph(m.icon)}</span>
        <span>${escapeHtml(m.nama)}</span>
      </div>`
    )
    .join("");

  el.nav.querySelectorAll(".nav-item").forEach((node) => {
    node.addEventListener("click", () => navigate(node.dataset.route));
  });
}

// Ikon disederhanakan jadi glyph teks/mono agar tidak butuh library icon eksternal
function iconGlyph(name) {
  const map = {
    "layout-dashboard": "◧",
    list: "≡",
    users: "◍",
  };
  return map[name] || "•";
}

function setActiveNav(route) {
  el.nav.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.route === route);
  });
}

// =========================================================
// ROUTER INTERNAL (frontend)
// =========================================================
async function navigate(route) {
  state.route = route;
  state.page = 1;
  state.search = "";
  setActiveNav(route);
  el.topbarActions.innerHTML = "";

  try {
    const schema = await apiFetch(`/meta/${route}`);
    state.schema = schema.data;
    el.pageTitle.textContent = state.schema.label;

    if (route === "dashboard") {
      el.pageSub.textContent = "Ringkasan sistem";
      await renderDashboard();
    } else {
      el.pageSub.textContent = `Kelola data ${state.schema.label.toLowerCase()}`;
      renderToolbar();
      await renderTablePage();
    }
  } catch (err) {
    el.content.innerHTML = `<div class="empty-state">Gagal memuat modul: ${escapeHtml(err.message)}</div>`;
  }
}

// =========================================================
// DASHBOARD — kartu ringkasan, murni generik dari schema
// (kolom pertama = judul, kedua = nilai, ketiga = satuan;
//  sisanya ditampilkan sebagai meta kecil)
// =========================================================
async function renderDashboard() {
  el.content.innerHTML = `<div class="empty-state">Memuat…</div>`;
  const listRes = await apiFetch(`/dashboard?limit=100&sort=urutan&order=asc`);
  const rows = listRes.data || [];
  const fields = (state.schema.fields || [])
    .filter((f) => f.show_in_list && !f.is_pk)
    .sort((a, b) => a.urutan - b.urutan);

  if (!rows.length) {
    el.content.innerHTML = `<div class="empty-state">Belum ada data dashboard.</div>`;
    return;
  }

  const cards = rows
    .map((row) => {
      const titleField = fields[0];
      const valueField = fields[1];
      const unitField = fields[2];
      const restFields = fields.slice(3);

      const title = titleField ? row[titleField.field_name] : "";
      const value = valueField ? row[valueField.field_name] : "";
      const unit = unitField ? row[unitField.field_name] : "";
      const restText = restFields
        .map((f) => `${f.label}: ${formatCellValue(row[f.field_name], f)}`)
        .join(" · ");

      return `
        <div class="card">
          <p class="card-title">${escapeHtml(title)}</p>
          <div>
            <span class="card-value">${escapeHtml(value)}</span>
            ${unit ? `<span class="card-unit">${escapeHtml(unit)}</span>` : ""}
          </div>
          ${restText ? `<div class="card-meta">${escapeHtml(restText)}</div>` : ""}
        </div>`;
    })
    .join("");

  el.content.innerHTML = `<div class="card-grid">${cards}</div>`;
}

// =========================================================
// TOOLBAR (search + tombol tambah) — generik untuk semua tabel
// =========================================================
function renderToolbar() {
  el.topbarActions.innerHTML = `
    <input type="text" class="search" id="search-input" placeholder="Cari data…" />
    <button class="btn btn--primary" id="btn-add">+ Tambah</button>
  `;
  document
    .getElementById("search-input")
    .addEventListener("input", debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      renderTablePage();
    }, 350));

  document.getElementById("btn-add").addEventListener("click", () => openDrawer("create", {}));
}

// =========================================================
// TABLE VIEW — generik, kolom & data 100% dari JSON
// =========================================================
function formatCellValue(value, field) {
  if (value === null || value === undefined || value === "") return "";
  if (field.input_type === "select" && field.options) {
    const opt = field.options.find((o) => o.value === value);
    return opt ? opt.label : value;
  }
  return value;
}

function renderStatusBadge(value) {
  const cls = value === "aktif" ? "badge--aktif" : "badge--nonaktif";
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

async function renderTablePage() {
  el.content.innerHTML = `<div class="empty-state">Memuat data…</div>`;

  const listFields = (state.schema.fields || [])
    .filter((f) => f.show_in_list)
    .sort((a, b) => a.urutan - b.urutan);

  const res = await apiFetch(
    `/${state.route}?page=${state.page}&limit=${CONFIG.PAGE_SIZE}` +
      `&search=${encodeURIComponent(state.search)}` +
      (state.sort ? `&sort=${state.sort}&order=${state.order}` : "")
  );
  const rows = res.data || [];
  const meta = res.meta || { page: 1, total_pages: 1, total: rows.length };

  if (!rows.length) {
    el.content.innerHTML = `<div class="empty-state">Tidak ada data untuk ditampilkan.</div>`;
    return;
  }

  const theadHtml = listFields
    .map((f) => `<th data-field="${f.field_name}">${escapeHtml(f.label)}</th>`)
    .join("");

  const tbodyHtml = rows
    .map((row) => {
      const cells = listFields
        .map((f) => {
          const raw = row[f.field_name];
          const display =
            f.field_name === "status"
              ? renderStatusBadge(raw)
              : escapeHtml(formatCellValue(raw, f));
          return `<td>${display}</td>`;
        })
        .join("");
      return `<tr data-id="${row[state.schema.primary_key]}">${cells}</tr>`;
    })
    .join("");

  el.content.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${theadHtml}</tr></thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
      <div class="pagination">
        <span>Halaman ${meta.page} dari ${meta.total_pages} · ${meta.total} total data</span>
        <div class="pagination-controls">
          <button class="btn btn--sm" id="btn-prev" ${meta.page <= 1 ? "disabled" : ""}>‹ Sebelumnya</button>
          <button class="btn btn--sm" id="btn-next" ${meta.page >= meta.total_pages ? "disabled" : ""}>Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  el.content.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const id = tr.dataset.id;
      try {
        const one = await apiFetch(`/${state.route}/${id}`);
        openDrawer("edit", one.data);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  const prevBtn = document.getElementById("btn-prev");
  const nextBtn = document.getElementById("btn-next");
  if (prevBtn) prevBtn.addEventListener("click", () => { state.page--; renderTablePage(); });
  if (nextBtn) nextBtn.addEventListener("click", () => { state.page++; renderTablePage(); });
}

// =========================================================
// DRAWER — form dinamis (create / edit), dibangun dari schema
// =========================================================
function openDrawer(mode, row) {
  state.drawerMode = mode;
  state.drawerRow = row;
  el.drawerError.textContent = "";
  el.drawerTitle.textContent = mode === "create" ? `Tambah ${state.schema.label}` : `Ubah ${state.schema.label}`;
  el.drawerDelete.hidden = mode !== "edit";

  const formFields = (state.schema.fields || [])
    .filter((f) => f.show_in_form)
    .sort((a, b) => a.urutan - b.urutan);

  el.drawerForm.innerHTML = formFields.map((f) => renderFieldHtml(f, row)).join("");

  document.body.classList.add("drawer-open");
  el.overlay.classList.add("show");
  el.drawer.classList.add("open");
}

function closeDrawer() {
  el.overlay.classList.remove("show");
  el.drawer.classList.remove("open");
  el.drawerForm.innerHTML = "";
  el.drawerError.textContent = "";
  state.drawerMode = null;
  state.drawerRow = null;
}

function renderFieldHtml(field, row) {
  const value = row && row[field.field_name] !== undefined ? row[field.field_name] : "";
  const requiredMark = field.required ? `<span class="req">*</span>` : "";
  const requiredAttr = field.required ? "required" : "";
  const isEdit = state.drawerMode === "edit";

  if (field.input_type === "hidden") {
    return `<input type="hidden" name="${field.field_name}" value="${escapeHtml(value)}" />`;
  }

  let control = "";
  switch (field.input_type) {
    case "select": {
      const options = (field.options || [])
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}" ${o.value === value ? "selected" : ""}>${escapeHtml(o.label)}</option>`
        )
        .join("");
      control = `<select name="${field.field_name}" ${requiredAttr}>
        <option value="" disabled ${!value ? "selected" : ""}>Pilih ${escapeHtml(field.label)}</option>
        ${options}
      </select>`;
      break;
    }
    case "textarea":
      control = `<textarea name="${field.field_name}" ${requiredAttr}>${escapeHtml(value)}</textarea>`;
      break;
    case "password":
      control = `<input type="password" name="${field.field_name}"
        placeholder="${isEdit ? "Kosongkan jika tidak diubah" : ""}"
        ${isEdit ? "" : requiredAttr} autocomplete="new-password" />`;
      break;
    case "datetime":
      control = `<input type="text" name="${field.field_name}" value="${escapeHtml(value)}" readonly />`;
      break;
    case "number":
      control = `<input type="number" name="${field.field_name}" value="${escapeHtml(value)}" ${requiredAttr} />`;
      break;
    case "email":
      control = `<input type="email" name="${field.field_name}" value="${escapeHtml(value)}" ${requiredAttr} />`;
      break;
    default:
      control = `<input type="text" name="${field.field_name}" value="${escapeHtml(value)}" ${requiredAttr} />`;
  }

  return `
    <div class="field">
      <label>${escapeHtml(field.label)}${requiredMark}</label>
      ${control}
    </div>`;
}

function collectFormData() {
  const formData = new FormData(el.drawerForm);
  const body = {};
  for (const [key, val] of formData.entries()) {
    if (key === "password" && val === "") continue; // jangan kirim password kosong saat edit
    body[key] = val;
  }
  return body;
}

async function handleDrawerSubmit(e) {
  e.preventDefault();
  el.drawerError.textContent = "";
  const body = collectFormData();

  try {
    if (state.drawerMode === "create") {
      await apiFetch(`/${state.route}`, { method: "POST", body: JSON.stringify(body) });
      showToast("Data berhasil ditambahkan");
    } else {
      const id = state.drawerRow[state.schema.primary_key];
      await apiFetch(`/${state.route}/${id}`, { method: "PUT", body: JSON.stringify(body) });
      showToast("Data berhasil diperbarui");
    }
    closeDrawer();
    if (state.route === "dashboard") await renderDashboard();
    else await renderTablePage();
  } catch (err) {
    el.drawerError.textContent = err.message;
  }
}

async function handleDrawerDelete() {
  if (!state.drawerRow) return;
  const id = state.drawerRow[state.schema.primary_key];
  if (!confirm(`Hapus data ini? Tindakan tidak dapat dibatalkan.`)) return;

  try {
    await apiFetch(`/${state.route}/${id}`, { method: "DELETE" });
    showToast("Data berhasil dihapus");
    closeDrawer();
    if (state.route === "dashboard") await renderDashboard();
    else await renderTablePage();
  } catch (err) {
    showToast(err.message, true);
  }
}

// =========================================================
// INIT
// =========================================================
el.drawerForm.addEventListener("submit", handleDrawerSubmit);
el.drawerDelete.addEventListener("click", handleDrawerDelete);
el.drawerCancel.addEventListener("click", closeDrawer);
el.drawerClose.addEventListener("click", closeDrawer);
el.overlay.addEventListener("click", closeDrawer);

loadMenu();
