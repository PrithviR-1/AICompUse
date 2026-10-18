// Front-end entry point: picks the backend (Tauri or mock), then mounts the React app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { initBackend } from "@/lib/machiClient";
import "@/styles/index.css";

const root = document.getElementById("root");
if (root) {
  void initBackend().then(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
