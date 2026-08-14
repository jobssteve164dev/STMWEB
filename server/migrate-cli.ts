import { pool } from "./database.js";
import { migrateDatabase } from "./migrate.js";

try {
  await migrateDatabase();
  console.log("STMWEB database migration completed");
} finally {
  await pool.end();
}
