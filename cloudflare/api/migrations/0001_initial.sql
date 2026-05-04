CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  vendor_code TEXT NOT NULL UNIQUE,
  sap_vendor_code TEXT,
  vendor_name TEXT NOT NULL,
  tax_id TEXT,
  contact_name TEXT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_providers_email ON providers(email);
CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
CREATE INDEX IF NOT EXISTS idx_providers_sap_vendor_code ON providers(sap_vendor_code);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS delivery_points (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_points_active ON delivery_points(active, sort_order);

INSERT OR IGNORE INTO delivery_points (id, name, description, active, sort_order, created_at, updated_at)
VALUES ('GENERAL', 'General', 'Punto de entrega inicial para migración progresiva.', 1, 10, datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_number TEXT NOT NULL,
  po_item TEXT NOT NULL DEFAULT '',
  vendor_code TEXT,
  vendor_name TEXT,
  tax_id TEXT,
  delivery_date TEXT,
  buyer_name TEXT,
  item_group_name TEXT,
  material_code TEXT,
  material_description TEXT,
  storage_location TEXT,
  ordered_qty REAL NOT NULL DEFAULT 0,
  delivered_qty REAL NOT NULL DEFAULT 0,
  open_qty REAL NOT NULL DEFAULT 0,
  uom TEXT,
  status TEXT NOT NULL DEFAULT 'ABIERTA',
  last_sync TEXT NOT NULL,
  PRIMARY KEY (po_number, po_item)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_code);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_storage ON purchase_orders(storage_location);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  vendor_code TEXT,
  vendor_name TEXT,
  email TEXT,
  delivery_point_id TEXT NOT NULL REFERENCES delivery_points(id),
  po_number TEXT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SOLICITADA' CHECK (status IN ('SOLICITADA', 'APROBADA', 'RECHAZADA', 'REASIGNADA', 'CANCELADA')),
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  notes TEXT,
  supervisor_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments(provider_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_schedule ON appointments(date, delivery_point_id, status, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status, date);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  record_id TEXT,
  actor TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
