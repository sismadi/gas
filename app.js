/**
 * =========================================================
 * APP.JS — Frontend dinamis LMS
 * Tidak ada nama field tabel yang di-hardcode untuk tabel CRUD
 * biasa (kursus, modul, enrollments, progress, users, menu).
 * Table & form dibangun murni dari JSON yang dikembalikan
 * oleh /api/meta/:table (schema) dan /api/:table (data).
 *
 * Halaman "khusus" (katalog, dashboard per-role, profil, login)
 * adalah komposisi UI di atas endpoint generik yang sama —
 * pola yang sama seperti halaman dashboard bawaan project ini.
 *
 * Routing: berbasis URL slug lewat location.hash, format:
 *   #/nama-route   -> contoh: #/katalog, #/kursus, #/login
 * =========================================================
 */

// ---- Konfigurasi ----
const CONFIG = {
  API_BASE: window.API_BASE || "/api",
  PAGE_SIZE: 10,
};

const SESSION_KEY = "lms_session";

// ---- State aplikasi ----
const state = {
  route: null,
  schema: null,
  page: 1,
  search: "",
  sort: null,
  order: "asc",
  drawerMode: null,
  drawerRow: null,
};

const SPECIAL_ROUTES = new Set([
  "katalog",
  "login",
  "profil",
  "dashboard_admin",
  "dashboard-instruktur",
  "dashboard-peserta",
]);

const DASHBOARD_VIEW_BY_ROLE = {
  admin: "dashboard_admin",
  instruktur: "dashboard-instruktur",
  peserta: "dashboard-peserta",
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
  userBox: document.getElementById("user-box"),
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

function formatCurrency(value) {
  const n = Number(value) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
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
// SESSION (peserta | instruktur | admin)
// =========================================================
function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch (_) {
    return null;
  }
}

function setSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// =========================================================
// ROUTER (URL slug via hash)
// =========================================================
function getHashRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return raw || null;
}

function setHashRoute(route) {
  const target = "#/" + route;
  if (window.location.hash !== target) window.location.hash = target;
}

window.addEventListener("hashchange", () => {
  const route = getHashRoute();
  if (route) navigate(route, false);
});

// =========================================================
// NAVIGASI / SIDEBAR (dinamis dari /api/menu, difilter per role)
// =========================================================
function menuVisible(item) {
  const roles = (item.roles || "public").split(",").map((r) => r.trim());
  const session = getSession();
  if (!session) return roles.includes("public");
  return roles.includes(session.role) || roles.includes("public");
}

async function loadMenu(initialRoute) {
  try {
    const res = await apiFetch(`/menu?limit=100&sort=urutan&order=asc`);
    const items = (res.data || [])
      .filter((m) => (m.status || "aktif") === "aktif")
      .filter(menuVisible);
    renderNav(items);
    renderUserBox();

    const session = getSession();
    let route = initialRoute;
    const routeIsVisible = route && items.some((m) => m.route === route);
    if (!routeIsVisible) {
      route = session ? DASHBOARD_VIEW_BY_ROLE[session.role] || "katalog" : "katalog";
    }
    navigate(route);
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

function iconGlyph(name) {
  const map = {
    "layout-dashboard": "◧",
    list: "≡",
    users: "◍",
    book: "▤",
  };
  return map[name] || "•";
}

function setActiveNav(route) {
  el.nav.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.route === route);
  });
}

function renderUserBox() {
  const session = getSession();
  if (!session) {
    el.userBox.innerHTML = `
      <span class="dot dot--live"></span> Tamu
      <button class="btn btn--sm btn--ghost" id="btn-goto-login">Masuk</button>
    `;
    const btn = document.getElementById("btn-goto-login");
    if (btn) btn.addEventListener("click", () => navigate("login"));
    return;
  }
  el.userBox.innerHTML = `
    <span class="dot dot--live"></span>
    <span class="user-box-name">${escapeHtml(session.nama)} <em>(${escapeHtml(session.role)})</em></span>
    <button class="btn btn--sm btn--ghost" id="btn-logout">Keluar</button>
  `;
  const btn = document.getElementById("btn-logout");
  if (btn)
    btn.addEventListener("click", () => {
      clearSession();
      showToast("Berhasil keluar");
      loadMenu("katalog");
    });
}

// =========================================================
// ROUTER INTERNAL (frontend)
// =========================================================
async function navigate(route, pushHash = true) {
  state.route = route;
  state.page = 1;
  state.search = "";
  setActiveNav(route);
  el.topbarActions.innerHTML = "";
  if (pushHash) setHashRoute(route);

  try {
    if (route === "login") {
      el.pageTitle.textContent = "Masuk";
      el.pageSub.textContent = "Login sebagai peserta, instruktur, atau admin";
      renderLogin();
      return;
    }
    if (route === "katalog") {
      el.pageTitle.textContent = "Katalog Kursus";
      el.pageSub.textContent = "Semua kursus yang sedang dibuka";
      await renderKatalog();
      return;
    }
    if (route === "profil") {
      el.pageTitle.textContent = "Profil Saya";
      el.pageSub.textContent = "Kelola data akun Anda";
      await renderProfil();
      return;
    }
    if (route === "dashboard-instruktur") {
      el.pageTitle.textContent = "Dashboard Instruktur";
      el.pageSub.textContent = "Ringkasan kursus yang Anda ampu";
      await renderDashboardInstruktur();
      return;
    }
    if (route === "dashboard-peserta") {
      el.pageTitle.textContent = "Dashboard Peserta";
      el.pageSub.textContent = "Ringkasan belajar Anda";
      await renderDashboardPeserta();
      return;
    }

    // Semua route lain (termasuk 'dashboard_admin' via view) memakai
    // engine generik: meta -> table/form, tanpa hardcode field.
    const schema = await apiFetch(`/meta/${route}`);
    state.schema = schema.data;
    el.pageTitle.textContent = state.schema.label;

    if (route === "dashboard_admin") {
      el.pageSub.textContent = "Ringkasan sistem";
      await renderDashboardGeneric();
    } else {
      el.pageSub.textContent = state.schema.readonly
        ? `Data ${state.schema.label.toLowerCase()} (read-only)`
        : `Kelola data ${state.schema.label.toLowerCase()}`;
      renderToolbar();
      await renderTablePage();
    }
  } catch (err) {
    el.content.innerHTML = `<div class="empty-state">Gagal memuat modul: ${escapeHtml(err.message)}</div>`;
  }
}

// =========================================================
// LOGIN
// =========================================================
function renderLogin() {
  el.content.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <h2>Masuk ke LMS</h2>
        <p class="muted">Gunakan akun peserta, instruktur, atau admin.</p>
        <div class="field">
          <label>Email</label>
          <input type="email" name="email" required />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" name="password" required />
        </div>
        <div class="drawer-error" id="login-error"></div>
        <button type="submit" class="btn btn--primary" style="width:100%">Masuk</button>
      </form>
    </div>
  `;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("login-error");
    errBox.textContent = "";
    try {
      const res = await apiFetch(`/login`, {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      setSession(res.data);
      showToast(`Selamat datang, ${res.data.nama}`);
      await loadMenu(DASHBOARD_VIEW_BY_ROLE[res.data.role] || "katalog");
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
}

// =========================================================
// KATALOG KURSUS (halaman publik, card: nama, periode,
// instruktur, harga, deskripsi, tombol enrol)
// =========================================================
async function renderKatalog() {
  el.content.innerHTML = `<div class="empty-state">Memuat katalog…</div>`;
  el.topbarActions.innerHTML = `<input type="text" class="search" id="katalog-search" placeholder="Cari kursus…" />`;
  document
    .getElementById("katalog-search")
    .addEventListener("input", debounce((e) => renderKatalogList(e.target.value), 300));

  await renderKatalogList("");
}

async function renderKatalogList(search) {
  const res = await apiFetch(`/katalog?limit=100&search=${encodeURIComponent(search || "")}`);
  const rows = res.data || [];
  const session = getSession();

  if (!rows.length) {
    el.content.innerHTML = `<div class="empty-state">Belum ada kursus yang dibuka.</div>`;
    return;
  }

  const cards = rows
    .map((r) => {
      const kuotaPenuh = r.kuota > 0 && r.jumlah_peserta >= r.kuota;
      let actionHtml = "";
      if (!session) {
        actionHtml = `<button class="btn btn--primary btn--sm" data-action="login-required">Daftar</button>`;
      } else if (session.role !== "peserta") {
        actionHtml = `<span class="muted" style="font-size:12px">Mode ${escapeHtml(session.role)}</span>`;
      } else if (kuotaPenuh) {
        actionHtml = `<button class="btn btn--sm" disabled>Kuota Penuh</button>`;
      } else {
        actionHtml = `<button class="btn btn--primary btn--sm" data-action="enroll" data-kursus-id="${r.id}">Daftar</button>`;
      }

      return `
      <div class="course-card">
        <div class="course-card-head">
          <span class="course-tag">${escapeHtml(r.kategori || "Umum")}</span>
          <span class="course-price">${formatCurrency(r.harga)}</span>
        </div>
        <h3 class="course-title">${escapeHtml(r.judul)}</h3>
        <p class="course-desc">${escapeHtml(r.deskripsi || "")}</p>
        <div class="course-meta">
          <div><span class="muted">Periode</span><br/>${formatDate(r.periode_mulai)} – ${formatDate(r.periode_selesai)}</div>
          <div><span class="muted">Instruktur</span><br/>${escapeHtml(r.instruktur || "-")}</div>
          <div><span class="muted">Peserta</span><br/>${r.jumlah_peserta}${r.kuota ? " / " + r.kuota : ""}</div>
        </div>
        <div class="course-foot">${actionHtml}</div>
      </div>`;
    })
    .join("");

  el.content.innerHTML = `<div class="course-grid">${cards}</div>`;

  el.content.querySelectorAll('[data-action="login-required"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      showToast("Silakan masuk sebagai peserta terlebih dahulu");
      navigate("login");
    });
  });

  el.content.querySelectorAll('[data-action="enroll"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kursusId = btn.dataset.kursusId;
      const s = getSession();
      try {
        await apiFetch(`/enrollments`, {
          method: "POST",
          body: JSON.stringify({ kursus_id: kursusId, user_id: s.id, status: "pending" }),
        });
        showToast("Pendaftaran terkirim, menunggu konfirmasi");
        renderKatalogList(document.getElementById("katalog-search")?.value || "");
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

// =========================================================
// DASHBOARD ADMIN — generik lewat VIEW dashboard_admin
// (kolom pertama = judul, kedua = nilai, ketiga = satuan)
// =========================================================
async function renderDashboardGeneric() {
  el.content.innerHTML = `<div class="empty-state">Memuat…</div>`;
  const listRes = await apiFetch(`/${state.route}?limit=100&sort=urutan&order=asc`);
  const rows = listRes.data || [];
  const fields = (state.schema.fields || [])
    .filter((f) => f.show_in_list && !f.is_pk)
    .sort((a, b) => a.urutan - b.urutan);

  if (!rows.length) {
    el.content.innerHTML = `<div class="empty-state">Belum ada data dashboard.</div>`;
    return;
  }

  el.content.innerHTML = `<div class="card-grid">${renderDashboardCards(rows, fields)}</div>`;
}

function renderDashboardCards(rows, fields) {
  return rows
    .map((row) => {
      const titleField = fields[0];
      const valueField = fields[1];
      const unitField = fields[2];
      const restFields = fields.slice(3);

      const title = titleField ? row[titleField.field_name] : "";
      const value = valueField ? row[valueField.field_name] : "";
      const unit = unitField ? row[unitField.field_name] : "";
      const restText = restFields
        .map((f) => `${f.label}: ${row[f.field_name] ?? ""}`)
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
}

// =========================================================
// DASHBOARD INSTRUKTUR — kartu dihitung dari endpoint generik
// yang difilter (?instruktur_id=..), tanpa endpoint khusus baru
// =========================================================
async function renderDashboardInstruktur() {
  el.content.innerHTML = `<div class="empty-state">Memuat…</div>`;
  const session = getSession();
  if (!session || session.role !== "instruktur") {
    el.content.innerHTML = `<div class="empty-state">Halaman ini khusus instruktur.</div>`;
    return;
  }

  const [kursusRes, pendaftaranRes] = await Promise.all([
    apiFetch(`/kursus?limit=1&instruktur_id=${session.id}`),
    apiFetch(`/pendaftaran?limit=1&instruktur_id=${session.id}`),
  ]);
  const kursusAktifRes = await apiFetch(
    `/kursus?limit=1&instruktur_id=${session.id}&status=published`
  );

  const rows = [
    { judul: "Kursus Saya", nilai: String(kursusRes.meta?.total ?? 0), satuan: "kursus" },
    {
      judul: "Kursus Published",
      nilai: String(kursusAktifRes.meta?.total ?? 0),
      satuan: "kursus",
    },
    {
      judul: "Total Pendaftaran",
      nilai: String(pendaftaranRes.meta?.total ?? 0),
      satuan: "pendaftaran",
    },
  ];
  const fields = [
    { field_name: "judul", label: "Judul" },
    { field_name: "nilai", label: "Nilai" },
    { field_name: "satuan", label: "Satuan" },
  ];

  el.content.innerHTML = `<div class="card-grid">${renderDashboardCards(rows, fields)}</div>`;
}

// =========================================================
// DASHBOARD PESERTA — kursus yang diikuti + progress ringkas
// =========================================================
async function renderDashboardPeserta() {
  el.content.innerHTML = `<div class="empty-state">Memuat…</div>`;
  const session = getSession();
  if (!session || session.role !== "peserta") {
    el.content.innerHTML = `<div class="empty-state">Halaman ini khusus peserta.</div>`;
    return;
  }

  const enrollRes = await apiFetch(`/pendaftaran?limit=100&user_id=${session.id}`);
  const enrollments = enrollRes.data || [];

  const summaryFields = [
    { field_name: "judul", label: "Judul" },
    { field_name: "nilai", label: "Nilai" },
    { field_name: "satuan", label: "Satuan" },
  ];
  const summaryRows = [
    { judul: "Kursus Diikuti", nilai: String(enrollments.length), satuan: "kursus" },
    {
      judul: "Kursus Aktif",
      nilai: String(enrollments.filter((e) => e.status === "aktif").length),
      satuan: "kursus",
    },
  ];

  const listHtml = enrollments.length
    ? `<div class="table-wrap" style="margin-top:16px">
        <table class="data-table">
          <thead><tr><th>Kursus</th><th>Tanggal Daftar</th><th>Status</th></tr></thead>
          <tbody>
            ${enrollments
              .map(
                (e) => `<tr>
                  <td>${escapeHtml(e.kursus)}</td>
                  <td>${formatDate(e.tanggal_daftar)}</td>
                  <td>${renderStatusBadge(e.status)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state" style="margin-top:16px">Anda belum mendaftar kursus apapun. Kunjungi Katalog Kursus.</div>`;

  el.content.innerHTML = `
    <div class="card-grid">${renderDashboardCards(summaryRows, summaryFields)}</div>
    ${listHtml}
  `;
}

// =========================================================
// PROFIL — form self-service, memakai users/:id milik sendiri
// =========================================================
async function renderProfil() {
  el.content.innerHTML = `<div class="empty-state">Memuat…</div>`;
  const session = getSession();
  if (!session) {
    navigate("login");
    return;
  }
  const [metaRes, rowRes] = await Promise.all([
    apiFetch(`/meta/users`),
    apiFetch(`/users/${session.id}`),
  ]);
  const schema = metaRes.data;
  const row = rowRes.data;

  const formFields = (schema.fields || [])
    .filter((f) => f.show_in_form && f.field_name !== "role" && f.field_name !== "status")
    .sort((a, b) => a.urutan - b.urutan);

  el.content.innerHTML = `
    <div class="profile-wrap">
      <form class="profile-form" id="profile-form">
        ${formFields.map((f) => renderFieldHtmlGeneric(f, row)).join("")}
        <div class="drawer-error" id="profile-error"></div>
        <button type="submit" class="btn btn--primary">Simpan Perubahan</button>
      </form>
    </div>
  `;

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {};
    for (const [k, v] of fd.entries()) {
      if (k === "password" && v === "") continue;
      body[k] = v;
    }
    const errBox = document.getElementById("profile-error");
    errBox.textContent = "";
    try {
      await apiFetch(`/users/${session.id}`, { method: "PUT", body: JSON.stringify(body) });
      const updated = { ...session, ...body };
      delete updated.password;
      setSession(updated);
      showToast("Profil berhasil diperbarui");
      renderUserBox();
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
}

// =========================================================
// TOOLBAR (search + tombol tambah) — generik untuk semua tabel
// =========================================================
function renderToolbar() {
  const addBtn = state.schema.readonly
    ? ""
    : `<button class="btn btn--primary" id="btn-add">+ Tambah</button>`;
  el.topbarActions.innerHTML = `
    <input type="text" class="search" id="search-input" placeholder="Cari data…" />
    ${addBtn}
  `;
  document
    .getElementById("search-input")
    .addEventListener("input", debounce((e) => {
      state.search = e.target.value;
      state.page = 1;
      renderTablePage();
    }, 350));

  const btnAdd = document.getElementById("btn-add");
  if (btnAdd) btnAdd.addEventListener("click", () => openDrawer("create", {}));
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
  const positif = ["aktif", "published", "selesai"];
  const cls = positif.includes(value) ? "badge--aktif" : "badge--nonaktif";
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

  if (!state.schema.readonly) {
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
  }

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
  const isEdit = state.drawerMode === "edit";
  return renderFieldHtmlGeneric(field, row, isEdit);
}

// Dipakai baik oleh drawer (create/edit) maupun halaman profil (selalu edit)
function renderFieldHtmlGeneric(field, row, isEdit = true) {
  const value = row && row[field.field_name] !== undefined ? row[field.field_name] : "";
  const requiredMark = field.required ? `<span class="req">*</span>` : "";
  const requiredAttr = field.required ? "required" : "";

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
    case "date":
      control = `<input type="date" name="${field.field_name}" value="${escapeHtml(String(value).slice(0, 10))}" ${requiredAttr} />`;
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
    if (key === "password" && val === "") continue;
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
    await renderTablePage();
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
    await renderTablePage();
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

loadMenu(getHashRoute());
