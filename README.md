# LMS Microservice — CRUD Dinamis (Cloudflare Workers + D1)

Dibangun di atas arsitektur *zero dependency, event-driven, routing berbasis slug URL* yang sudah ada, tanpa menambah library eksternal maupun hardcode nama tabel/field baru di `worker.js` / `app.js`.

```
backend/
  worker.js      -> router event-driven + CRUD generik multi-table/VIEW + paging + filter
  schema.sql     -> tabel LMS + VIEW read-only + tabel meta (_meta_fields)
  wrangler.toml  -> konfigurasi deploy Cloudflare Workers + binding D1
frontend/
  index.html     -> shell: sidebar, konten, drawer form, user-box (sesi login)
  style.css      -> desain panel kontrol (gelap, aksen amber) + katalog kursus, login, profil
  app.js         -> render table/form dari JSON schema + routing URL slug (#/route) + sesi
```

## Apa yang baru dibanding versi sebelumnya

1. **Routing berbasis URL slug** — `app.js` sekarang sinkron dengan `location.hash` (`#/katalog`, `#/kursus`, `#/login`, dst). Refresh halaman / share link tetap membuka route yang sama.
2. **Tabel LMS**: `kursus`, `modul`, `enrollments` (pendaftaran), `progress` — semuanya CRUD generik penuh, tanpa kode tambahan di backend.
3. **VIEW read-only** (fitur baru di `worker.js`, generik untuk semua VIEW, bukan hanya LMS):
   - `katalog` — kursus published + nama instruktur + jumlah peserta (JOIN).
   - `pendaftaran` — enrollments + nama kursus/peserta (JOIN), untuk admin/instruktur.
   - `progress_detail` — progress + nama modul/kursus/peserta (JOIN).
   - `dashboard_admin` — kartu ringkasan agregat (COUNT), dipakai ulang oleh renderer dashboard yang sama.
   `getAllowedTables()` sekarang membaca `type IN ('table','view')`, jadi VIEW baru otomatis "terdaftar" tanpa ubah kode. `worker.js` otomatis menolak `POST/PUT/DELETE` ke VIEW (405).
4. **Filter generik lewat query string** — endpoint list menerima query param apapun yang cocok nama kolom (`?instruktur_id=2&status=published`), dipakai untuk dashboard instruktur/peserta tanpa endpoint khusus baru.
5. **Halaman Katalog Kursus** — card publik berisi **nama, periode, instruktur, harga, deskripsi**, dan jumlah peserta/kuota, dengan tombol **Daftar** (mengirim `POST /api/enrollments`).
6. **Role pengguna**: `admin`, `instruktur`, `peserta` — masing-masing dapat **dashboard sendiri**:
   - Admin → `#/dashboard-admin` (VIEW `dashboard_admin`, reuse renderer dashboard generik).
   - Instruktur → `#/dashboard-instruktur` (kartu dihitung dari `kursus`/`pendaftaran` yang difilter `instruktur_id`).
   - Peserta → `#/dashboard-peserta` (daftar kursus yang diikuti dari VIEW `pendaftaran` difilter `user_id`).
7. **Login sederhana** (`POST /api/login`) — mencocokkan email/password di tabel `users`. Sesi disimpan di `localStorage` (bukan token/JWT — cocok untuk demo, **bukan untuk produksi**; lihat catatan keamanan di bawah).
8. **Menu berbasis role** — kolom baru `menu.roles` (daftar role dipisah koma, atau `public`) menentukan item sidebar mana yang tampil untuk sesi yang sedang aktif.
9. **Halaman Profil** (`#/profil`) — form self-service untuk edit data akun sendiri (nama, email, telepon, bio, avatar, password opsional).

## Akun demo (lihat seed di schema.sql)

| Role       | Email             | Password       |
|------------|-------------------|----------------|
| Admin      | admin@lms.id      | admin123       |
| Instruktur | budi@lms.id       | instruktur123  |
| Instruktur | sari@lms.id       | instruktur123  |
| Peserta    | ani@lms.id        | peserta123     |
| Peserta    | dedi@lms.id       | peserta123     |

## Cara menjalankan backend

```bash
cd backend
npm install -g wrangler        # jika belum ada
wrangler login
wrangler d1 create lms_db      # salin database_id ke wrangler.toml
wrangler d1 execute lms_db --remote --file=./schema.sql
wrangler deploy
```

## Cara menjalankan frontend

Buka `frontend/index.html` langsung di browser, **atau** host sebagai static site. Set base API di `index.html`:

```html
<script>window.API_BASE = "https://lms-microservice.<subdomain>.workers.dev/api";</script>
```

## Menambah tabel/modul baru (tanpa ubah worker.js / app.js)

1. Tambahkan `CREATE TABLE nama_tabel (...)` — atau `CREATE VIEW nama_view AS SELECT ...` untuk data gabungan/agregat — di `schema.sql`.
2. Tambahkan baris metadata field di `_meta_fields` (opsional untuk VIEW, karena akan pakai default cerdas dari `PRAGMA table_info`).
3. Tambahkan baris baru di tabel `menu` dengan `route = 'nama_tabel'` dan `roles = 'admin,instruktur'` (atau role lain).
4. Jalankan ulang `wrangler d1 execute ... --file=./schema.sql`.
5. Modul baru langsung muncul di sidebar (sesuai role) dan bisa CRUD penuh (atau read-only jika VIEW) — tanpa menyentuh kode backend/frontend.

## Endpoint API

| Method | Path                     | Keterangan                                  |
|--------|--------------------------|----------------------------------------------|
| GET    | `/api/tables`            | Daftar semua tabel & view yang tersedia       |
| GET    | `/api/meta/:table`       | Skema field (untuk render table & form)       |
| GET    | `/api/:table?page=&limit=&search=&sort=&order=&<kolom>=<nilai>` | List data + paging + filter exact per kolom |
| GET    | `/api/:table/:id`        | Detail satu baris                             |
| POST   | `/api/:table`            | Tambah data (ditolak 405 jika `:table` adalah VIEW) |
| PUT/PATCH | `/api/:table/:id`     | Ubah data (ditolak 405 jika VIEW)             |
| DELETE | `/api/:table/:id`        | Hapus data (ditolak 405 jika VIEW)            |
| POST   | `/api/login`              | `{ email, password }` → data user (tanpa password) |

## Catatan keamanan (penting sebelum produksi)

- Password disimpan **plaintext** di seed & dicocokkan langsung di `handleLogin` — ganti dengan hashing (mis. bcrypt via Worker-compatible lib atau Web Crypto `subtle.digest`) sebelum dipakai sungguhan.
- Sesi login memakai `localStorage` tanpa token/expiry — cukup untuk demo/prototipe, belum aman untuk data sensitif. Untuk produksi, pertimbangkan JWT/HttpOnly cookie + validasi di `worker.js` pada setiap request (bukan hanya di frontend).
- Endpoint CRUD generik saat ini **tidak memeriksa role di backend** — pemfilteran menu per role hanya di frontend. Untuk produksi, tambahkan pemeriksaan otorisasi di `worker.js` (mis. header `Authorization` + tabel sesi) sebelum mengizinkan write ke tabel sensitif seperti `users`.
