import { betterAuth } from "better-auth";
import { pool } from "./database.js";
import { env } from "./env.js";

export const auth = betterAuth({
  appName: "STMWEB",
  database: pool,
  trustedOrigins: [env.BETTER_AUTH_URL],
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      scope: ["read:user", "user:email"],
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 30,
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/social": { window: 60, max: 10 },
    },
  },
});
