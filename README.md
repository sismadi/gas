# Sismadi Microservice — CRUD Dinamis (Cloudflare Workers + D1)

Arsitektur ringkas:

```
backend/
  worker.js      -> router event-driven + CRUD generik multi-table + paging
  schema.sql     -> tabel data (menu, users, dashboard) + tabel meta (_meta_fields)
  wrangler.toml  -> konfigurasi deploy Cloudflare Workers + binding D1
frontend/
  index.html     -> shell: sidebar, konten, drawer form
  style.css      -> desain panel kontrol (gelap, aksen amber)
  app.js         -> merender table & form MURNI dari JSON schema, tanpa hardcode field
```

## Prinsip yang diterapkan

- **Reuse & DRY**: satu fungsi CRUD (`listData/getOneData/createData/updateData/removeData`) dipakai untuk semua tabel. Tambah tabel baru = tambah `CREATE TABLE` + baris `_meta_fields` saja, **tanpa ubah kode**.
- **Modular**: backend dan frontend terpisah bersih lewat kontrak JSON (`/api/meta/:table` untuk skema, `/api/:table` untuk data).
- **Scalable**: `getAllowedTables()` membaca `sqlite_master` secara dinamis, jadi tabel baru otomatis "terdaftar" ke router.
- **Konsisten**: semua respons API memakai amplop yang sama: `{ success, data, meta? }`.
- **Efisien**: paging wajib di setiap query list (`LIMIT`/`OFFSET`), pencarian hanya menyentuh kolom bertipe TEXT.

## Alur kerja dinamis

1. Frontend memuat menu dari `GET /api/menu` untuk membangun sidebar.
2. Saat menu diklik → frontend memanggil `GET /api/meta/:table` (skema field: label, tipe input, wajib/tidak, kolom yang tampil di tabel/form) lalu `GET /api/:table` (data + paging).
3. Tabel di-render otomatis dari `schema.fields` yang `show_in_list = 1`.
4. Klik baris atau tombol **+ Tambah** → membuka **drawer** berisi form yang dibangun otomatis dari `schema.fields` yang `show_in_form = 1` (text/number/email/password/select/textarea/hidden).
5. Simpan → `POST` (tambah) atau `PUT` (ubah); Hapus → `DELETE`. Semua lewat endpoint generik yang sama.

## Cara menjalankan backend

```bash
cd backend
npm install -g wrangler        # jika belum ada
wrangler login
wrangler d1 create sismadi_db  # salin database_id ke wrangler.toml
wrangler d1 execute sismadi_db --remote --file=./schema.sql
wrangler deploy
```

Setelah deploy, catat URL Worker Anda, misalnya:
`https://sismadi-microservice.<subdomain>.workers.dev`

## Cara menjalankan frontend

Buka `frontend/index.html` langsung di browser, **atau** host sebagai static site (Cloudflare Pages/Netlify/dll). Set base API di `app.js`:

```js
// di index.html, sebelum <script src="app.js">
<script>window.API_BASE = "https://sismadi-microservice.<subdomain>.workers.dev/api";</script>
```

## Menambah tabel/modul baru (tanpa ubah worker.js / app.js)

1. Tambahkan `CREATE TABLE nama_tabel (...)` di `schema.sql`.
2. Tambahkan baris metadata field di `_meta_fields` untuk `nama_tabel` (label, input_type, show_in_list, show_in_form, dst).
3. Tambahkan baris baru di tabel `menu` dengan `route = 'nama_tabel'`.
4. Jalankan ulang `wrangler d1 execute ... --file=./schema.sql`.
5. Modul baru langsung muncul di sidebar dan bisa CRUD penuh — tanpa menyentuh kode backend/frontend.

## Endpoint API

| Method | Path                     | Keterangan                                  |
|--------|--------------------------|----------------------------------------------|
| GET    | `/api/tables`            | Daftar semua tabel yang tersedia              |
| GET    | `/api/meta/:table`       | Skema field (untuk render table & form)       |
| GET    | `/api/:table?page=&limit=&search=&sort=&order=` | List data + paging |
| GET    | `/api/:table/:id`        | Detail satu baris                             |
| POST   | `/api/:table`            | Tambah data                                   |
| PUT/PATCH | `/api/:table/:id`     | Ubah data                                     |
| DELETE | `/api/:table/:id`        | Hapus data                                    |
