import type { NextFunction, Request, Response } from "express";
import express from "express";
import { env } from "./env.js";

const sharedDocuments: Record<string, string> = {
  terms: "terms_of_service",
  privacy: "privacy_policy",
  "cookie-policy": "cookie_policy",
  "refund-policy": "refund_cancellation_policy",
  "data-rights": "data_rights_notice",
  "do-not-sell": "do_not_sell_share_notice",
  "ai-disclaimer": "ai_entertainment_disclaimer",
};

const router = express.Router();

router.get("/:document", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const documentParam = request.params.document;
    const slug = Array.isArray(documentParam) ? documentParam[0] : documentParam;
    if (!slug) {
      response.status(404).json({ error: "未找到法律文件" });
      return;
    }
    const endpoint = slug === "legal-supplement" ? "/api/legal/product-supplement" : "/api/legal/document";
    const type = sharedDocuments[slug];
    if (slug !== "legal-supplement" && !type) {
      response.status(404).json({ error: "未找到法律文件" });
      return;
    }
    const url = new URL(endpoint, env.SZLKLAWS_BASE_URL);
    url.searchParams.set("product", env.PASSPORT_PRODUCT);
    url.searchParams.set("locale", "zh-CN");
    if (type) url.searchParams.set("type", type);
    const upstream = await fetch(url, { headers: { accept: "application/json" } });
    const body = await upstream.text();
    response.status(upstream.status).set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    }).send(body);
  } catch (error) {
    next(error);
  }
});

export { router as legalApiRouter };
