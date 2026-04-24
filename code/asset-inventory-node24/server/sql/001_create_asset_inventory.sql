CREATE TABLE IF NOT EXISTS "aoyong"."asset_inventory" (
  id BIGSERIAL PRIMARY KEY,
  asset_code VARCHAR(64) NOT NULL UNIQUE,
  asset_name VARCHAR(128) NOT NULL,
  department VARCHAR(64) NOT NULL,
  owner VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  location VARCHAR(128) NOT NULL,
  check_date DATE NOT NULL,
  remark TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_inventory_updated_at
  ON "aoyong"."asset_inventory"(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_asset_inventory_status
  ON "aoyong"."asset_inventory"(status);
