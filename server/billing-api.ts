import type { NextFunction, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { requireInternalSession, type InternalUser } from "./internal-auth.js";
import { createBillingPortalLink, createCheckoutLink, getBillingCatalog, PassportError } from "./passport.js";
import { env } from "./env.js";

interface AuthenticatedRequest extends Request { currentUser: InternalUser }

const router = express.Router();
router.use((request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  if (request.get("origin") !== new URL(env.BETTER_AUTH_URL).origin) return response.status(403).json({ error: "请求来源未获授权" });
  return next();
});
router.use(requireInternalSession);
router.use(express.json({ limit: "16kb" }));

function asyncRoute(handler: (request: AuthenticatedRequest, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request as AuthenticatedRequest, response).catch(next);
}

router.get("/catalog", asyncRoute(async (_request, response) => {
  response.json(await getBillingCatalog());
}));

router.post("/checkout", asyncRoute(async (request, response) => {
  const { planId } = z.object({ planId: z.string().trim().min(1).max(160) }).parse(request.body);
  const user = request.currentUser;
  const result = await createCheckoutLink({ planId, user: { id: user.passportUserId, email: user.email, name: user.name } });
  response.json(result);
}));

router.post("/portal", asyncRoute(async (request, response) => {
  const user = request.currentUser;
  response.json(await createBillingPortalLink({ id: user.passportUserId, email: user.email, name: user.name }));
}));

router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: "请选择有效方案" });
  if (error instanceof PassportError) return response.status(error.status >= 400 && error.status < 500 ? error.status : 503).json({ error: "支付服务暂时不可用" });
  return response.status(500).json({ error: "支付服务暂时不可用" });
});

export { router as billingApiRouter };
