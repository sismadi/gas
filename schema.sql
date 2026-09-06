-- =========================================================
-- SCHEMA.SQL — Microservice CRUD Dinamis (Cloudflare D1)
-- Prinsip: reuse, DRY, modular
-- Setiap tabel baru otomatis ter-detect oleh worker.js
-- tanpa perlu ubah kode (lihat sqlite_master di worker.js)
-- =========================================================

-- ---------------------------------------------------------
-- TABEL META: mendeskripsikan field tiap tabel agar frontend
-- bisa merender table & form secara dinamis (tanpa hardcode).
-- Jika sebuah tabel tidak punya baris di _meta_fields,
-- worker.js akan membuat default otomatis dari PRAGMA table_info.
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
-- TABEL: menu (navigasi sidebar, sekaligus daftar "modul")
-- =========================================================
DROP TABLE IF EXISTS menu;
CREATE TABLE menu (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER NOT NULL DEFAULT 0,
  nama        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'circle',
  route       TEXT NOT NULL,              -- nama tabel/route tujuan, ex: 'dashboard','menu','users'
  urutan      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'aktif',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: users
-- =========================================================
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',
  status      TEXT NOT NULL DEFAULT 'aktif',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- TABEL: dashboard (widget ringkasan yang tampil di beranda)
-- =========================================================
DROP TABLE IF EXISTS dashboard;
CREATE TABLE dashboard (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  judul       TEXT NOT NULL,
  tipe        TEXT NOT NULL DEFAULT 'angka',  -- angka|teks
  nilai       TEXT NOT NULL,
  satuan      TEXT,
  urutan      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'aktif',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- META FIELDS: menu
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('menu','id',        'ID',            'hidden', NULL, 0, 0, 1, 0, 0),
('menu','nama',       'Nama Menu',     'text',   NULL, 1, 1, 1, 1, 1),
('menu','icon',       'Icon',          'text',   NULL, 1, 1, 1, 0, 2),
('menu','route',      'Route / Tabel', 'text',   NULL, 1, 1, 1, 1, 3),
('menu','parent_id',  'Menu Induk (ID)','number',NULL, 0, 1, 1, 0, 4),
('menu','urutan',     'Urutan',        'number', NULL, 1, 1, 1, 0, 5),
('menu','status',     'Status',        'select', '[{"value":"aktif","label":"Aktif"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 6),
('menu','created_at', 'Dibuat',        'datetime', NULL, 0, 0, 1, 0, 7),
('menu','updated_at', 'Diperbarui',    'datetime', NULL, 0, 0, 1, 0, 8);

-- =========================================================
-- META FIELDS: users
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('users','id',        'ID',        'hidden',   NULL, 0, 0, 1, 0, 0),
('users','nama',      'Nama',      'text',     NULL, 1, 1, 1, 1, 1),
('users','email',     'Email',     'email',    NULL, 1, 1, 1, 1, 2),
('users','password',  'Password',  'password', NULL, 0, 1, 0, 1, 3),
('users','role',      'Role',      'select',   '[{"value":"admin","label":"Admin"},{"value":"user","label":"User"}]', 1, 1, 1, 1, 4),
('users','status',    'Status',    'select',   '[{"value":"aktif","label":"Aktif"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 5),
('users','created_at','Dibuat',    'datetime', NULL, 0, 0, 1, 0, 6),
('users','updated_at','Diperbarui','datetime', NULL, 0, 0, 1, 0, 7);

-- =========================================================
-- META FIELDS: dashboard
-- =========================================================
INSERT INTO _meta_fields (table_name, field_name, label, input_type, options, show_in_list, show_in_form, sortable, required, urutan) VALUES
('dashboard','id',        'ID',      'hidden', NULL, 0, 0, 1, 0, 0),
('dashboard','judul',     'Judul',   'text',   NULL, 1, 1, 1, 1, 1),
('dashboard','nilai',     'Nilai',   'text',   NULL, 1, 1, 1, 1, 2),
('dashboard','satuan',    'Satuan',  'text',   NULL, 1, 1, 1, 0, 3),
('dashboard','tipe',      'Tipe',    'select', '[{"value":"angka","label":"Angka"},{"value":"teks","label":"Teks"}]', 1, 1, 1, 1, 4),
('dashboard','status',    'Status',  'select', '[{"value":"aktif","label":"Aktif"},{"value":"nonaktif","label":"Nonaktif"}]', 1, 1, 1, 1, 5),
('dashboard','urutan',    'Urutan',  'number', NULL, 0, 1, 1, 0, 6),
('dashboard','created_at','Dibuat',  'datetime', NULL, 0, 0, 1, 0, 7),
('dashboard','updated_at','Diperbarui','datetime', NULL, 0, 0, 1, 0, 8);

-- =========================================================
-- SEED DATA
-- =========================================================
INSERT INTO menu (nama, icon, route, urutan, status) VALUES
 ('Dashboard', 'layout-dashboard', 'dashboard', 1, 'aktif'),
 ('Menu',      'list',             'menu',      2, 'aktif'),
 ('Pengguna',  'users',            'users',     3, 'aktif');

INSERT INTO users (nama, email, password, role, status) VALUES
 ('Administrator', 'admin@sismadi.com', 'admin123', 'admin', 'aktif');

INSERT INTO dashboard (judul, tipe, nilai, satuan, urutan, status) VALUES
 ('Total Pengguna', 'angka', '1', 'orang', 1, 'aktif'),
 ('Total Menu',     'angka', '3', 'item',  2, 'aktif'),
 ('Status Sistem',  'teks',  'Online', '', 3, 'aktif');
