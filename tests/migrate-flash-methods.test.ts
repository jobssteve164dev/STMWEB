import assert from "node:assert/strict";
import test from "node:test";

test("migration permits every public firmware flash method in persisted artifacts", async () => {
  process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.BETTER_AUTH_SECRET ||= "12345678901234567890123456789012";
  process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:8080";
  const { pool } = await import("../server/database.js");
  const { migrateDatabase } = await import("../server/migrate.js");
  const queries: string[] = [];
  const originalQuery = pool.query.bind(pool);
  pool.query = (async (query: unknown) => {
    queries.push(String(query));
    return { rows: [], rowCount: 0 };
  }) as typeof pool.query;

  try {
    await migrateDatabase();
  } finally {
    pool.query = originalQuery;
  }

  const migration = queries.join("\n");
  assert.match(
    migration,
    /ALTER TABLE firmware_versions DROP CONSTRAINT IF EXISTS firmware_versions_flash_methods_check;\s+ALTER TABLE firmware_versions ADD CONSTRAINT firmware_versions_flash_methods_check CHECK \(flash_methods <@ ARRAY\['swd','usb','bluetooth'\]::text\[\]\)/,
  );
  assert.match(
    migration,
    /ALTER TABLE firmware_package_artifacts DROP CONSTRAINT IF EXISTS firmware_package_artifacts_flash_methods_check;\s+ALTER TABLE firmware_package_artifacts ADD CONSTRAINT firmware_package_artifacts_flash_methods_check CHECK \(flash_methods <@ ARRAY\['swd','usb','bluetooth'\]::text\[\]\)/,
  );
});
