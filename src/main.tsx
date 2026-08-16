import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthenticatedApp from "./AuthenticatedApp.js";
import { LandingPage, LegalPage, NotFoundPage, PlansPage } from "./PublicSite.js";
import { LocaleProvider } from "./i18n.js";
import "./styles.css";

function CurrentRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <LandingPage />;
  if (path === "/workbench") return <AuthenticatedApp />;
  if (path === "/plans") return <PlansPage />;
  const legalSlug = path.slice(1);
  if (["terms", "privacy", "cookie-policy", "refund-policy", "data-rights", "do-not-sell", "ai-disclaimer", "legal-supplement"].includes(legalSlug)) return <LegalPage slug={legalSlug} />;
  return <NotFoundPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider><CurrentRoute /></LocaleProvider>
  </StrictMode>,
);
