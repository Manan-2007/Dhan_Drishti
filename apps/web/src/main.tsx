import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { ThemeProvider } from "./theme.js";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

// Register the service worker so the app is installable and its shell works offline. Only in a
// production build — in dev it would fight Vite's HMR. API data is never cached (see public/sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort; never block the app */
    });
  });
}
