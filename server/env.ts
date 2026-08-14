import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  STMWEB_ADMIN_USERNAME: z.string().trim().min(3).max(64),
  STMWEB_ADMIN_PASSWORD: z.string().min(12).max(256),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`缺少或无效的服务配置：${fields}`);
}

export const env = parsed.data;
