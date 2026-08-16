import { StrictMode, useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import AuthenticatedApp from "./AuthenticatedApp.js";
import { LandingPage, LegalPage, NotFoundPage, PlansPage } from "./PublicSite.js";
import { LocaleProvider } from "./i18n.js";
import "./styles.css";

const publicPaths = new Set(["/", "/plans", "/terms", "/privacy", "/cookie-policy", "/refund-policy", "/data-rights", "/do-not-sell", "/ai-disclaimer", "/legal-supplement"]);

type RouteLocation = {
  hash: string;
  key: number;
  path: string;
  search: string;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => void;
};

function normalisePath(path: string) {
  return path.replace(/\/+$/, "") || "/";
}

function readLocation(key = 0): RouteLocation {
  return {
    hash: window.location.hash,
    key,
    path: normalisePath(window.location.pathname),
    search: window.location.search,
  };
}

function CurrentRoute() {
  const [route, setRoute] = useState<RouteLocation>(() => readLocation());

  useEffect(() => {
    function applyLocation() {
      const update = () => setRoute((current) => readLocation(current.key + 1));
      const transitionDocument = document as ViewTransitionDocument;
      if (transitionDocument.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        transitionDocument.startViewTransition(() => flushSync(update));
      } else {
        update();
      }
    }

    function handlePopState() {
      applyLocation();
    }

    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.hasAttribute("download") || (target.target && target.target !== "_self")) return;

      const destination = new URL(target.href, window.location.href);
      const currentPath = normalisePath(window.location.pathname);
      const destinationPath = normalisePath(destination.pathname);
      if (destination.origin !== window.location.origin || !publicPaths.has(currentPath) || !publicPaths.has(destinationPath)) return;

      event.preventDefault();
      if (destination.href === window.location.href) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      window.history.pushState({}, "", destination);
      applyLocation();
    }

    window.addEventListener("popstate", handlePopState);
    document.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  useLayoutEffect(() => {
    if (!route.hash) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(decodeURIComponent(route.hash.slice(1)))?.scrollIntoView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route.hash, route.key]);

  const path = route.path;
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
