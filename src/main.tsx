// The light and dark mode switch first: it defines <hw-theme-toggle> before the header renders
// (claude-built-apps platform/src/theme/hw-theme.js, unchanged; tests/theme.test.ts pins it).
import "./lib/hw-theme.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerServiceWorker } from "./lib/shared";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
