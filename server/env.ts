import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  STMWEB_ADMIN_USERNAME: z.string().trim().min(3).max(64),
  STMWEB_ADMIN_PASSWORD: z.string().min(12).max(256),
  STMWEB_BUILD_IMAGE: z.string().regex(/^[a-zA-Z0-9./:_@-]+$/).default("ghcr.io/jobssteve164dev/stmweb-build-arm-gcc:v1"),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`缺少或无效的服务配置：${fields}`);
}

export const env = parsed.data;
