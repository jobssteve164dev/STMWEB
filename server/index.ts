import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { apiRouter } from "./api.js";
import { auth } from "./auth.js";
import { pool } from "./database.js";
import { env } from "./env.js";
import { migrateDatabase } from "./migrate.js";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.get("/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  } catch {
    response.status(503).json({ status: "unavailable" });
  }
});

app.all("/api/auth/*", toNodeHandler(auth));
app.use("/api", apiRouter);
app.use(express.static(path.join(root, "dist"), { index: false, maxAge: "7d", immutable: true }));
app.get("*", (_request, response) => response.sendFile(path.join(root, "dist", "index.html")));

await migrateDatabase();

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`STMWEB listening on ${env.PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
