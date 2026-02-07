/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

async function start() {
  const res = await fetch("/api/config");
  if (!res.ok) {
    throw new Error(`Failed to fetch /api/config: ${res.status}`);
  }
  const { convexUrl } = (await res.json()) as { convexUrl: string };

  const convex = new ConvexReactClient(convexUrl);
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>,
  );
}

function handleStartupError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh">
        <pre style="color:red;max-width:600px;white-space:pre-wrap">Startup failed: ${msg}</pre>
      </div>`;
  }
  throw err;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () =>
    start().catch(handleStartupError),
  );
} else {
  start().catch(handleStartupError);
}
