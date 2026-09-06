/**
 * =========================================================
 * WORKER.JS — Microservice API Dinamis LMS (Cloudflare Workers + D1)
 * Prinsip: reuse, DRY, modular, scalable, konsisten, efisien
 *
 * - Routing berbasis tabel event (routes[]) => "event driven routing"
 * - Semua keluaran JSON dengan amplop response konsisten
 * - CRUD generik: bisa dipakai untuk TABEL maupun VIEW apapun
 *   tanpa hardcode, selama terdaftar di sqlite_master
 *   (bukan tabel "_meta_*"). VIEW otomatis read-only.
 * - Filter generik: query param apapun yang cocok dengan nama
 *   kolom tabel otomatis jadi filter exact-match (?kursus_id=1)
 * - Paging wajib pada setiap list data (page, limit)
 * - Metadata field (/api/meta/:table) dipakai frontend untuk
 *   merender table & form secara dinamis
 * - /api/login: satu-satunya endpoint "khusus", dipakai untuk
 *   otentikasi peserta/instruktur/admin (masih memakai tabel
 *   `users` secara generik, tidak menambah field/tabel baru)
 * =========================================================
 */

// ---------- Helper: response JSON konsisten + CORS ----------
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function ok(data, meta = null) {
  return json({ success: true, data, ...(meta ? { meta } : {}) });
}

function fail(message, status = 400) {
  return json({ success: false, message }, status);
}

// ---------- Helper: introspeksi skema tabel/view (tanpa hardcode) ----------

/** Ambil semua nama tabel & view data (exclude _meta_* dan sqlite_*) */
async function getAllowedTables(env) {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type IN ('table','view')
       AND name NOT GLOB '_*'
       AND name NOT LIKE 'sqlite_%'`
  ).all();
  return results.map((r) => r.name);
}

/** Tipe objek: 'table' atau 'view' (view = read-only otomatis) */
async function getTableType(env, table) {
  const row = await env.DB.prepare(
    `SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table','view')`
  )
    .bind(table)
    .first();
  return row ? row.type : null;
}

async function assertTableAllowed(env, table) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new HttpError(`Nama tabel tidak valid: ${table}`, 400);
  }
  const tables = await getAllowedTables(env);
  if (!tables.includes(table)) {
    throw new HttpError(`Tabel '${table}' tidak ditemukan / tidak diizinkan`, 404);
  }
  return true;
}

async function assertWritable(env, table) {
  const type = await getTableType(env, table);
  if (type === "view") {
    throw new HttpError(`'${table}' adalah view (read-only), tidak bisa diubah`, 405);
  }
}

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** PRAGMA table_info: cid, name, type, notnull, dflt_value, pk */
async function getColumns(env, table) {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return results;
}

function toLabel(name) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function defaultInputType(colType, name) {
  if (name === "password") return "password";
  if (name === "email") return "email";
  if (name.endsWith("_at")) return "datetime";
  const t = (colType || "").toUpperCase();
  if (t.includes("INT")) return "number";
  if (name === "status") return "select";
  return "text";
}

/** Bangun schema gabungan: kolom asli (PRAGMA) + metadata (_meta_fields) + default cerdas */
async function buildSchema(env, table) {
  const columns = await getColumns(env, table);
  const type = await getTableType(env, table);
  let metaList = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM _meta_fields WHERE table_name = ? ORDER BY urutan ASC`
    )
      .bind(table)
      .all();
    metaList = results;
  } catch (_) {
    metaList = []; // tabel _meta_fields belum ada / kosong -> fallback total ke default
  }
  const metaMap = {};
  metaList.forEach((m) => (metaMap[m.field_name] = m));

  const pkCol = columns.find((c) => c.pk === 1);
  const readonly = type === "view";

  const fields = columns
    .map((c, idx) => {
      const meta = metaMap[c.name];
      return {
        field_name: c.name,
        label: meta ? meta.label : toLabel(c.name),
        input_type: meta ? meta.input_type : defaultInputType(c.type, c.name),
        options: meta && meta.options ? JSON.parse(meta.options) : null,
        show_in_list: meta
          ? !!meta.show_in_list
          : !["created_at", "updated_at", "password"].includes(c.name),
        show_in_form: readonly ? false : meta ? !!meta.show_in_form : c.pk !== 1,
        required: meta ? !!meta.required : !!c.notnull && c.pk !== 1,
        sortable: meta ? !!meta.sortable : true,
        urutan: meta ? meta.urutan : idx,
        is_pk: c.pk === 1,
      };
    })
    .sort((a, b) => a.urutan - b.urutan);

  return {
    table,
    label: toLabel(table),
    primary_key: pkCol ? pkCol.name : "id",
    readonly,
    fields,
  };
}

// ---------- CRUD generik (dipakai untuk SEMUA tabel & view) ----------

const RESERVED_QUERY_KEYS = new Set(["page", "limit", "search", "sort", "order"]);

async function listData(
  env,
  table,
  { page = 1, limit = 10, search = "", sort, order = "asc", filters = {} } = {}
) {
  page = Math.max(1, parseInt(page) || 1);
  limit = Math.min(200, Math.max(1, parseInt(limit) || 10));
  const offset = (page - 1) * limit;

  const columns = await getColumns(env, table);
  const colNames = columns.map((c) => c.name);

  const clauses = [];
  const params = [];

  if (search) {
    const textCols = columns
      .filter((c) => (c.type || "").toUpperCase().includes("TEXT") || (c.type || "") === "")
      .map((c) => c.name);
    if (textCols.length) {
      clauses.push("(" + textCols.map((c) => `${c} LIKE ?`).join(" OR ") + ")");
      params.push(...textCols.map(() => `%${search}%`));
    }
  }

  // Filter generik: setiap query param yang cocok nama kolom -> WHERE col = ?
  // Tidak ada nama field yang di-hardcode di sini.
  Object.entries(filters).forEach(([key, val]) => {
    if (colNames.includes(key) && val !== undefined && val !== "") {
      clauses.push(`${key} = ?`);
      params.push(val);
    }
  });

  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

  let orderBy = "";
  if (sort && colNames.includes(sort)) {
    orderBy = `ORDER BY ${sort} ${order === "desc" ? "DESC" : "ASC"}`;
  }

  const countRow = await env.DB.prepare(`SELECT COUNT(*) as total FROM ${table} ${where}`)
    .bind(...params)
    .first();
  const total = countRow ? countRow.total : 0;

  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} ${where} ${orderBy} LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return {
    data: results,
    meta: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function getOneData(env, table, id) {
  const columns = await getColumns(env, table);
  const pk = (columns.find((c) => c.pk === 1) || {}).name || "id";
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).bind(id).first();
  return row || null;
}

async function createData(env, table, body) {
  const columns = await getColumns(env, table);
  const pk = (columns.find((c) => c.pk === 1) || {}).name;
  const allowedCols = columns.map((c) => c.name).filter((n) => n !== pk);

  const keys = Object.keys(body || {}).filter((k) => allowedCols.includes(k));
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (allowedCols.includes("created_at") && !keys.includes("created_at")) {
    keys.push("created_at");
    body.created_at = now;
  }
  if (allowedCols.includes("updated_at") && !keys.includes("updated_at")) {
    keys.push("updated_at");
    body.updated_at = now;
  }
  if (!keys.length) throw new HttpError("Tidak ada data valid untuk disimpan", 400);

  const placeholders = keys.map(() => "?").join(",");
  const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`;
  const res = await env.DB.prepare(sql)
    .bind(...keys.map((k) => body[k]))
    .run();
  return { [pk || "id"]: res.meta.last_row_id };
}

async function updateData(env, table, id, body) {
  const columns = await getColumns(env, table);
  const pk = (columns.find((c) => c.pk === 1) || {}).name || "id";
  const allowedCols = columns.map((c) => c.name).filter((n) => n !== pk);

  const keys = Object.keys(body || {}).filter(
    (k) => allowedCols.includes(k) && !(k === "password" && !body[k])
  );
  if (allowedCols.includes("updated_at")) {
    keys.push("updated_at");
    body.updated_at = new Date().toISOString().slice(0, 19).replace("T", " ");
  }
  if (!keys.length) throw new HttpError("Tidak ada data valid untuk diupdate", 400);

  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${pk} = ?`;
  await env.DB.prepare(sql)
    .bind(...keys.map((k) => body[k]), id)
    .run();
  return { [pk]: id };
}

async function removeData(env, table, id) {
  const columns = await getColumns(env, table);
  const pk = (columns.find((c) => c.pk === 1) || {}).name || "id";
  await env.DB.prepare(`DELETE FROM ${table} WHERE ${pk} = ?`).bind(id).run();
  return { [pk]: id };
}

// ---------- Handlers (dipetakan lewat routing table di bawah) ----------

async function handleTables({ env }) {
  const tables = await getAllowedTables(env);
  return ok(tables);
}

async function handleMeta({ env, params }) {
  const [table] = params;
  await assertTableAllowed(env, table);
  const schema = await buildSchema(env, table);
  return ok(schema);
}

async function handleList({ env, url, params }) {
  const [table] = params;
  await assertTableAllowed(env, table);
  const q = url.searchParams;
  const filters = {};
  for (const [key, val] of q.entries()) {
    if (!RESERVED_QUERY_KEYS.has(key)) filters[key] = val;
  }
  const { data, meta } = await listData(env, table, {
    page: q.get("page") || 1,
    limit: q.get("limit") || 10,
    search: q.get("search") || "",
    sort: q.get("sort") || undefined,
    order: q.get("order") || "asc",
    filters,
  });
  return ok(data, meta);
}

async function handleGetOne({ env, params }) {
  const [table, id] = params;
  await assertTableAllowed(env, table);
  const row = await getOneData(env, table, id);
  if (!row) throw new HttpError("Data tidak ditemukan", 404);
  return ok(row);
}

async function handleCreate({ env, request, params }) {
  const [table] = params;
  await assertTableAllowed(env, table);
  await assertWritable(env, table);
  const body = await safeJson(request);
  const result = await createData(env, table, body);
  return json({ success: true, data: result }, 201);
}

async function handleUpdate({ env, request, params }) {
  const [table, id] = params;
  await assertTableAllowed(env, table);
  await assertWritable(env, table);
  const existing = await getOneData(env, table, id);
  if (!existing) throw new HttpError("Data tidak ditemukan", 404);
  const body = await safeJson(request);
  const result = await updateData(env, table, id, body);
  return ok(result);
}

async function handleDelete({ env, params }) {
  const [table, id] = params;
  await assertTableAllowed(env, table);
  await assertWritable(env, table);
  const existing = await getOneData(env, table, id);
  if (!existing) throw new HttpError("Data tidak ditemukan", 404);
  const result = await removeData(env, table, id);
  return ok(result);
}

/**
 * Login — memvalidasi email/password terhadap tabel `users`.
 * Ini tetap "generik" dalam arti hanya memakai konvensi kolom
 * email/password/status/role yang sudah ada di skema, tanpa
 * membuat tabel/endpoint khusus per-role.
 */
async function handleLogin({ env, request }) {
  const body = await safeJson(request);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    throw new HttpError("Email dan password wajib diisi", 400);
  }
  const row = await env.DB.prepare(`SELECT * FROM users WHERE lower(email) = ?`)
    .bind(email)
    .first();
  if (!row || row.password !== password) {
    throw new HttpError("Email atau password salah", 401);
  }
  if ((row.status || "aktif") !== "aktif") {
    throw new HttpError("Akun tidak aktif, hubungi admin", 403);
  }
  const { password: _pw, ...safeUser } = row;
  return ok(safeUser);
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

// ---------- Routing table (event driven) ----------
// Setiap event (method + pattern URL) dipetakan ke satu handler generik.
// Menambah tabel/view baru TIDAK perlu menambah routing baru.
const routes = [
  { method: "GET", pattern: /^\/api\/tables\/?$/, handler: handleTables },
  { method: "GET", pattern: /^\/api\/meta\/([a-zA-Z_][a-zA-Z0-9_]*)\/?$/, handler: handleMeta },
  { method: "POST", pattern: /^\/api\/login\/?$/, handler: handleLogin },
  { method: "GET", pattern: /^\/api\/([a-zA-Z_][a-zA-Z0-9_]*)\/(\d+)\/?$/, handler: handleGetOne },
  { method: "GET", pattern: /^\/api\/([a-zA-Z_][a-zA-Z0-9_]*)\/?$/, handler: handleList },
  { method: "POST", pattern: /^\/api\/([a-zA-Z_][a-zA-Z0-9_]*)\/?$/, handler: handleCreate },
  { method: "PUT", pattern: /^\/api\/([a-zA-Z_][a-zA-Z0-9_]*)\/(\d+)\/?$/, handler: handleUpdate },
  { method: "PATCH", pattern: /^\/api\/([a-zA-Z_][a-zA-Z0-9_]*)\/(\d+)\/?$/, handler: handleUpdate },
  { method: "DELETE", pattern: /^\/api\/([a-zA-Z_][a-zA-Z0-9_]*)\/(\d+)\/?$/, handler: handleDelete },
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return ok({ status: "ok", app: env.APP_NAME || "LMS Microservice" });
    }

    try {
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = url.pathname.match(route.pattern);
        if (match) {
          return await route.handler({ request, env, url, params: match.slice(1) });
        }
      }
      return fail(`Route tidak ditemukan: ${request.method} ${url.pathname}`, 404);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return fail(err.message || "Terjadi kesalahan pada server", status);
    }
  },
};
