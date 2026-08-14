import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthenticatedApp from "./AuthenticatedApp.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthenticatedApp />
  </StrictMode>,
);
