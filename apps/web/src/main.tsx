import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A screen's script can go missing when the app was rebuilt while this tab was open (the old page
// names files the new build replaced). Reload once to pick up the new build instead of failing
// silently; the flag stops a reload loop if the file is truly gone.
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("dd-reloaded")) return;
    sessionStorage.setItem("dd-reloaded", "1");
  } catch {
    /* storage blocked: reload anyway, once per event */
  }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => {
  setTimeout(() => {
    try {
      sessionStorage.removeItem("dd-reloaded");
    } catch {
      /* ignore */
    }
  }, 10_000);
});

// Register the service worker so the app is installable and its shell works offline. Only in a
// production build — in dev it would fight Vite's HMR. API data is never cached (see public/sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort; never block the app */
    });
  });
}
