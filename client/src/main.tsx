import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { initClientSentry } from "./lib/sentry";
import App from "./App";
import "./index.css";

// Initialize Sentry before rendering (no-op if VITE_SENTRY_DSN not set)
initClientSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IconContext.Provider value={{ weight: "duotone", size: 24 }}>
      <App />
    </IconContext.Provider>
  </StrictMode>
);
