import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { apiRouter } from "./api.js";
import { cloudmcpProviderRouter } from "./cloudmcp-provider.js";
import { internalAuthRouter } from "./internal-auth.js";
import { pool } from "./database.js";
import { env } from "./env.js";
import { migrateDatabase } from "./migrate.js";
import { runnerApiRouter } from "./runner-api.js";
import { billingApiRouter } from "./billing-api.js";
import { apiConnectionsRouter } from "./api-connection-auth.js";

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

app.get("/install-runner.sh", (_request, response) => {
  response.type("text/x-shellscript").sendFile(path.join(root, "runner", "install-runner.sh"));
});
app.get("/runner/stmweb-runner.mjs", (_request, response) => {
  response.type("text/javascript").sendFile(path.join(root, "runner", "stmweb-runner.mjs"));
});

app.use("/api/internal-auth", internalAuthRouter);
app.use("/api/billing", billingApiRouter);
app.use("/api/provider-bridge", cloudmcpProviderRouter);
app.use("/api/runner", runnerApiRouter);
app.use("/api/api-connections", apiConnectionsRouter);
app.use("/api/v1", apiRouter);
app.use("/api", apiRouter);
app.use("/api", (error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error("[STMWEB] API request failed", error);
  response.status(500).json({ error: "请求没有完成，请稍后再试" });
});
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
