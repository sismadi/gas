-- =========================================================
-- SCHEMA.SQL — LMS Microservice (Cloudflare D1)
-- Arsitektur: reuse, DRY, modular, event-driven routing,
-- ZERO hardcode field/tabel di worker.js & app.js.
--
-- Cara kerja:
-- 1) Tabel data biasa (kursus, modul, users, dst) otomatis
--    ter-detect worker.js lewat sqlite_master + PRAGMA table_info.
-- 2) VIEW (katalog, dashboard_*, pendaftaran, progress_detail)
--    dipakai untuk data gabungan/agregat (JOIN, COUNT) — tetap
--    lewat endpoint CRUD generik yang SAMA, hanya read-only
--    (worker.js otomatis menolak POST/PUT/DELETE ke VIEW).
-- 3) _meta_fields mendeskripsikan label/tipe input/urutan field
--    tiap tabel supaya frontend bisa merender table & form
--    100% dinamis.
-- =========================================================

-- ---------------------------------------------------------
-- TABEL META
-- ---------------------------------------------------------
DROP TABLE IF EXISTS _meta_fields;
CREATE TABLE _meta_fields (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name    TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  label         TEXT NOT NULL,
  input_type    TEXT NOT NULL DEFAULT 'text', -- text|number|email|password|select|textarea|date|datetime|hidden
  options       TEXT,                          -- JSON array: [{"value":"aktif","label":"Aktif"}]
  show_in_list  INTEGER NOT NULL DEFAULT 1,
  show_in_form  INTEGER NOT NULL DEFAULT 1,
  sortable      INTEGER NOT NULL DEFAULT 1,
  required      INTEGER NOT NULL DEFAULT 0,
  urutan        INTEGER NOT NULL DEFAULT 0,
  UNIQUE(table_name, field_name)
);

-- =========================================================
-- TABEL: menu (navigasi sidebar + kontrol akses per-role)
-- Kolom `roles` = daftar role yang boleh melihat menu ini,
-- dipisah koma. 'public' = boleh dilihat tanpa login.
-- =========================================================
DROP TABLE IF EXISTS menu;
CREATE TABLE menu (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER NOT NULL DEFAULT 0,
  nama        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'circle',
  route       TEXT NOT NULL,              -- nama tabel/view/route tujuan
  roles       TEXT NOT NULL DEFAULT 'admin,instruktur,peserta,public',
  urutan      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'aktif',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: users (peserta | instruktur | admin)
-- =========================================================
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'peserta', -- admin|instruktur|peserta
  telepon     TEXT,
  bio         TEXT,
  avatar_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'aktif',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: kursus (mata pelajaran / course)
-- =========================================================
DROP TABLE IF EXISTS kursus;
CREATE TABLE kursus (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  judul           TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  kategori        TEXT,
  deskripsi       TEXT,
  instruktur_id   INTEGER NOT NULL,
  periode_mulai   TEXT NOT NULL,
  periode_selesai TEXT NOT NULL,
  harga           INTEGER NOT NULL DEFAULT 0,
  kuota           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft', -- draft|published|nonaktif
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: modul (materi per kursus)
-- =========================================================
DROP TABLE IF EXISTS modul;
CREATE TABLE modul (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kursus_id     INTEGER NOT NULL,
  judul         TEXT NOT NULL,
  urutan        INTEGER NOT NULL DEFAULT 0,
  tipe          TEXT NOT NULL DEFAULT 'materi', -- materi|video|kuis|tugas
  konten_url    TEXT,
  durasi_menit  INTEGER,
  status        TEXT NOT NULL DEFAULT 'aktif',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: enrollments (pendaftaran peserta ke kursus)
-- =========================================================
DROP TABLE IF EXISTS enrollments;
CREATE TABLE enrollments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kursus_id       INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  tanggal_daftar  TEXT NOT NULL DEFAULT (date('now')),
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|aktif|selesai|batal
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: progress (progres belajar peserta per modul)
-- =========================================================
DROP TABLE IF EXISTS progress;
CREATE TABLE progress (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id  INTEGER NOT NULL,
  modul_id       INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'belum', -- belum|proses|selesai
  skor           INTEGER,
  waktu_selesai  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- VIEW: katalog — daftar kursus published untuk halaman publik
-- (JOIN kursus + instruktur + hitung peserta, read-only)
-- =========================================================
DROP VIEW IF EXISTS katalog;
CREATE VIEW katalog AS
SELECT
  k.id                AS id,
  k.judul             AS judul,
  k.slug              AS slug,
  k.kategori          AS kategori,
  k.deskripsi         AS deskripsi,
  k.periode_mulai     AS periode_mulai,
  k.periode_selesai   AS periode_selesai,
  k.harga             AS harga,
  k.kuota             AS kuota,
  k.instruktur_id     AS instruktur_id,
  u.nama              AS instruktur,
  (SELECT COUNT(*) FROM enrollments e WHERE e.kursus_id = k.id AND e.status != 'batal') AS jumlah_peserta
FROM kursus k
LEFT JOIN users u ON u.id = k.instruktur_id
WHERE k.status = 'published';

-- =========================================================
-- VIEW: pendaftaran — enrollments + nama kursus & peserta
-- (untuk admin/instruktur, read-only)
-- =========================================================
DROP VIEW IF EXISTS pendaftaran;
CREATE VIEW pendaftaran AS
SELECT
  e.id             AS id,
  e.kursus_id      AS kursus_id,
  k.judul          AS kursus,
  k.instruktur_id  AS instruktur_id,
  e.user_id        AS user_id,
  us.nama          AS peserta,
  us.email         AS email_peserta,
  e.tanggal_daftar AS tanggal_daftar,
  e.status         AS status,
  e.created_at     AS created_at
FROM enrollments e
JOIN kursus k ON k.id = e.kursus_id
JOIN users us ON us.id = e.user_id;

-- =========================================================
-- VIEW: progress_detail — progress + nama modul/kursus/peserta
-- (untuk admin/instruktur, read-only)
-- =========================================================
DROP VIEW IF EXISTS progress_detail;
CREATE VIEW progress_detail AS
SELECT
  p.id             AS id,
  p.enrollment_id  AS enrollment_id,
  e.kursus_id      AS kursus_id,
  k.judul          AS kursus,
  k.instruktur_id  AS instruktur_id,
  e.user_id        AS user_id,
  us.nama          AS peserta,
  p.modul_id       AS modul_id,
  m.judul          AS modul,
  p.status         AS status,
  p.skor           AS skor,
  p.waktu_selesai  AS waktu_selesai
FROM progress p
JOIN enrollments e ON e.id = p.enrollment_id
JOIN modul m ON m.id = p.modul_id
JOIN kursus k ON k.id = m.kursus_id
JOIN users us ON us.id = e.user_id;

-- =========================================================
-- VIEW: dashboard_admin — kartu ringkasan global (agregat)
-- Kolom judul/nilai/satuan cocok dengan renderer dashboard
-- generik yang sudah ada (reuse, tanpa kode baru di frontend).
-- =========================================================
DROP VIEW IF EXISTS dashboard_admin;
CREATE VIEW dashboard_admin AS
SELECT 'Total Kursus' AS judul, CAST(COUNT(*) AS TEXT) AS nilai, 'kursus' AS satuan, 1 AS urutan, 'aktif' AS status FROM kursus
UNION ALL
SELECT 'Kursus Published', CAST(COUNT(*) AS TEXT), 'kursus', 2, 'aktif' FROM kursus WHERE status = 'published'
UNION ALL
SELECT 'Total Peserta', CAST(COUNT(*) AS TEXT), 'orang', 3, 'aktif' FROM users WHERE role = 'peserta'
UNION ALL
SELECT 'Total Instruktur', CAST(COUNT(*) AS TEXT), 'orang', 4, 'aktif' FROM users WHERE role = 'instruktur'
UNION ALL
SELECT 'Total Pendaftaran', CAST(COUNT(*) AS TEXT), 'pendaftaran', 5, 'aktif' FROM enrollments
UNION ALL
SELECT 'Total Modul', CAST(COUNT(*) AS TEXT), 'modul', 6, 'aktif' FROM modul;

-- =========================================================
-- META FIELDS: menu
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('menu','id',        'ID',            'hidden', NULL, 0, 0, 1, 0, 0),
('menu','nama',       'Nama Menu',     'text',   NULL, 1, 1, 1, 1, 1),
('menu','icon',       'Icon',          'text',   NULL, 1, 1, 1, 0, 2),
('menu','route',      'Route / Tabel', 'text',   NULL, 1, 1, 1, 1, 3),
('menu','roles',      'Role (pisah koma)', 'text', NULL, 1, 1, 1, 1, 4),
('menu','parent_id',  'Menu Induk (ID)','number',NULL, 0, 1, 1, 0, 5),
('menu','urutan',     'Urutan',        'number', NULL, 1, 1, 1, 0, 6),
('menu','status',     'Status',        'select', '[{"value":"aktif","label":"Aktif"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 7),
('menu','created_at', 'Dibuat',        'datetime', NULL, 0, 0, 1, 0, 8),
('menu','updated_at', 'Diperbarui',    'datetime', NULL, 0, 0, 1, 0, 9);

-- =========================================================
-- META FIELDS: users
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('users','id',        'ID',        'hidden',   NULL, 0, 0, 1, 0, 0),
('users','nama',      'Nama',      'text',     NULL, 1, 1, 1, 1, 1),
('users','email',     'Email',     'email',    NULL, 1, 1, 1, 1, 2),
('users','password',  'Password',  'password', NULL, 0, 1, 0, 1, 3),
('users','role',      'Role',      'select',   '[{"value":"admin","label":"Admin"},{"value":"instruktur","label":"Instruktur"},{"value":"peserta","label":"Peserta"}]', 1, 1, 1, 1, 4),
('users','telepon',   'Telepon',   'text',     NULL, 0, 1, 1, 0, 5),
('users','bio',       'Bio',       'textarea', NULL, 0, 1, 0, 0, 6),
('users','avatar_url','URL Avatar','text',     NULL, 0, 1, 0, 0, 7),
('users','status',    'Status',    'select',   '[{"value":"aktif","label":"Aktif"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 8),
('users','created_at','Dibuat',    'datetime', NULL, 0, 0, 1, 0, 9),
('users','updated_at','Diperbarui','datetime', NULL, 0, 0, 1, 0, 10);

-- =========================================================
-- META FIELDS: kursus
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('kursus','id',              'ID',                'hidden',   NULL, 0, 0, 1, 0, 0),
('kursus','judul',           'Judul Kursus',      'text',     NULL, 1, 1, 1, 1, 1),
('kursus','slug',            'Slug (URL)',        'text',     NULL, 1, 1, 1, 1, 2),
('kursus','kategori',        'Kategori',          'text',     NULL, 1, 1, 1, 0, 3),
('kursus','instruktur_id',   'ID Instruktur',     'number',   NULL, 1, 1, 1, 1, 4),
('kursus','periode_mulai',   'Periode Mulai',     'date',     NULL, 1, 1, 1, 1, 5),
('kursus','periode_selesai', 'Periode Selesai',   'date',     NULL, 1, 1, 1, 1, 6),
('kursus','harga',           'Harga (Rp)',        'number',   NULL, 1, 1, 1, 1, 7),
('kursus','kuota',           'Kuota Peserta',     'number',   NULL, 1, 1, 1, 1, 8),
('kursus','deskripsi',       'Deskripsi',         'textarea', NULL, 0, 1, 0, 1, 9),
('kursus','status',          'Status',            'select',   '[{"value":"draft","label":"Draft"},{"value":"published","label":"Published"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 10),
('kursus','created_at',      'Dibuat',            'datetime', NULL, 0, 0, 1, 0, 11),
('kursus','updated_at',      'Diperbarui',        'datetime', NULL, 0, 0, 1, 0, 12);

-- =========================================================
-- META FIELDS: modul
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('modul','id',            'ID',           'hidden',   NULL, 0, 0, 1, 0, 0),
('modul','kursus_id',     'ID Kursus',    'number',   NULL, 1, 1, 1, 1, 1),
('modul','judul',         'Judul Modul',  'text',     NULL, 1, 1, 1, 1, 2),
('modul','urutan',        'Urutan',       'number',   NULL, 1, 1, 1, 0, 3),
('modul','tipe',          'Tipe',         'select',   '[{"value":"materi","label":"Materi"},{"value":"video","label":"Video"},{"value":"kuis","label":"Kuis"},{"value":"tugas","label":"Tugas"}]', 1, 1, 1, 1, 4),
('modul','konten_url',    'URL Konten',   'text',     NULL, 0, 1, 0, 0, 5),
('modul','durasi_menit',  'Durasi (menit)','number',  NULL, 1, 1, 1, 0, 6),
('modul','status',        'Status',       'select',   '[{"value":"aktif","label":"Aktif"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 7),
('modul','created_at',    'Dibuat',       'datetime', NULL, 0, 0, 1, 0, 8),
('modul','updated_at',    'Diperbarui',   'datetime', NULL, 0, 0, 1, 0, 9);

-- =========================================================
-- META FIELDS: enrollments
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('enrollments','id',             'ID',           'hidden',   NULL, 0, 0, 1, 0, 0),
('enrollments','kursus_id',      'ID Kursus',    'number',   NULL, 1, 1, 1, 1, 1),
('enrollments','user_id',        'ID Peserta',   'number',   NULL, 1, 1, 1, 1, 2),
('enrollments','tanggal_daftar', 'Tanggal Daftar','date',    NULL, 1, 1, 1, 0, 3),
('enrollments','status',         'Status',       'select',   '[{"value":"pending","label":"Pending"},{"value":"aktif","label":"Aktif"},{"value":"selesai","label":"Selesai"},{"value":"batal","label":"Batal"}]', 1, 1, 1, 1, 4),
('enrollments','created_at',     'Dibuat',       'datetime', NULL, 0, 0, 1, 0, 5),
('enrollments','updated_at',     'Diperbarui',   'datetime', NULL, 0, 0, 1, 0, 6);

-- =========================================================
-- META FIELDS: progress
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('progress','id',             'ID',            'hidden',   NULL, 0, 0, 1, 0, 0),
('progress','enrollment_id',  'ID Pendaftaran','number',   NULL, 1, 1, 1, 1, 1),
('progress','modul_id',       'ID Modul',      'number',   NULL, 1, 1, 1, 1, 2),
('progress','status',         'Status',        'select',   '[{"value":"belum","label":"Belum"},{"value":"proses","label":"Proses"},{"value":"selesai","label":"Selesai"}]', 1, 1, 1, 1, 3),
('progress','skor',           'Skor',          'number',   NULL, 1, 1, 1, 0, 4),
('progress','waktu_selesai',  'Waktu Selesai', 'datetime', NULL, 1, 1, 1, 0, 5),
('progress','created_at',     'Dibuat',        'datetime', NULL, 0, 0, 1, 0, 6),
('progress','updated_at',     'Diperbarui',    'datetime', NULL, 0, 0, 1, 0, 7);

-- =========================================================
-- SEED DATA
-- =========================================================
INSERT INTO menu (nama, icon, route, roles, urutan, status) VALUES
 ('Katalog Kursus',       'book',             'katalog',            'public,admin,instruktur,peserta', 1, 'aktif'),
 ('Dashboard Admin',      'layout-dashboard', 'dashboard-admin',    'admin', 2, 'aktif'),
 ('Dashboard Instruktur', 'layout-dashboard', 'dashboard-instruktur','instruktur', 3, 'aktif'),
 ('Dashboard Peserta',    'layout-dashboard', 'dashboard-peserta',  'peserta', 4, 'aktif'),
 ('Kursus',               'list',             'kursus',             'admin,instruktur', 5, 'aktif'),
 ('Modul',                'list',             'modul',              'admin,instruktur', 6, 'aktif'),
 ('Pendaftaran',          'list',             'pendaftaran',        'admin,instruktur', 7, 'aktif'),
 ('Progress Belajar',     'list',             'progress',           'admin,instruktur', 8, 'aktif'),
 ('Pengguna',             'users',            'users',              'admin', 9, 'aktif'),
 ('Menu',                 'list',             'menu',               'admin', 10, 'aktif'),
 ('Profil Saya',          'users',            'profil',             'admin,instruktur,peserta', 11, 'aktif');

INSERT INTO users (nama, email, password, role, telepon, bio, status) VALUES
 ('Administrator', 'admin@lms.id', 'admin123', 'admin', '0800000001', 'Administrator sistem LMS.', 'aktif'),
 ('Budi Instruktur', 'budi@lms.id', 'instruktur123', 'instruktur', '0800000002', 'Instruktur pemrograman web.', 'aktif'),
 ('Sari Instruktur', 'sari@lms.id', 'instruktur123', 'instruktur', '0800000003', 'Instruktur data & analitik.', 'aktif'),
 ('Ani Peserta', 'ani@lms.id', 'peserta123', 'peserta', '0800000004', 'Belajar web development.', 'aktif'),
 ('Dedi Peserta', 'dedi@lms.id', 'peserta123', 'peserta', '0800000005', 'Belajar data science.', 'aktif');

INSERT INTO kursus (judul, slug, kategori, deskripsi, instruktur_id, periode_mulai, periode_selesai, harga, kuota, status) VALUES
 ('Fundamental Pemrograman Web', 'fundamental-pemrograman-web', 'Web Development', 'Belajar HTML, CSS, dan JavaScript dari dasar hingga membangun halaman web interaktif.', 2, '2026-09-15', '2026-11-15', 350000, 30, 'published'),
 ('JavaScript Lanjutan & Arsitektur Event-Driven', 'javascript-lanjutan', 'Web Development', 'Mendalami async/await, event loop, dan pola arsitektur event-driven untuk aplikasi skala besar.', 2, '2026-10-01', '2026-12-01', 450000, 25, 'published'),
 ('Pengantar Analisis Data', 'pengantar-analisis-data', 'Data Science', 'Dasar-dasar statistik, pengolahan data, dan visualisasi untuk pengambilan keputusan.', 3, '2026-09-20', '2026-11-20', 400000, 40, 'published'),
 ('Machine Learning untuk Pemula', 'machine-learning-pemula', 'Data Science', 'Konsep dasar machine learning, model prediksi, dan studi kasus praktis.', 3, '2026-11-01', '2027-01-15', 550000, 20, 'draft');

INSERT INTO modul (kursus_id, judul, urutan, tipe, durasi_menit, status) VALUES
 (1, 'Pengenalan HTML & Struktur Dokumen', 1, 'materi', 45, 'aktif'),
 (1, 'Styling dengan CSS', 2, 'video', 60, 'aktif'),
 (1, 'Dasar JavaScript & DOM', 3, 'materi', 50, 'aktif'),
 (1, 'Kuis Akhir Modul', 4, 'kuis', 20, 'aktif'),
 (2, 'Asynchronous JavaScript', 1, 'video', 55, 'aktif'),
 (2, 'Pola Event-Driven Architecture', 2, 'materi', 40, 'aktif'),
 (2, 'Tugas: Bangun Mini Event Bus', 3, 'tugas', 90, 'aktif'),
 (3, 'Statistik Deskriptif', 1, 'materi', 40, 'aktif'),
 (3, 'Visualisasi Data', 2, 'video', 45, 'aktif');

INSERT INTO enrollments (kursus_id, user_id, tanggal_daftar, status) VALUES
 (1, 4, '2026-09-05', 'aktif'),
 (2, 4, '2026-09-06', 'pending'),
 (3, 5, '2026-09-01', 'aktif');

INSERT INTO progress (enrollment_id, modul_id, status, skor) VALUES
 (1, 1, 'selesai', 90),
 (1, 2, 'proses', NULL),
 (3, 8, 'selesai', 85);
