# FLUX

An autonomous agent orchestrator with built-in issue tracking, realtime UI, and its own MCP server.

## Quick Start

```bash
# Install dependencies
bun install

# Start Convex dev server (in another terminal)
bun convex

# Run Flux
bun dev
```

## Bootstrap Flow

When you run Flux for the first time in a git repository:

1. **Project Detection**: Flux detects the project slug from your git remote
2. **Creation**: If the project doesn't exist in Convex, you'll be prompted to create it
3. **Seeding**: An animated progress bar shows real-time seeding of:
   - LLM Costs (global) - Claude 4.5 pricing
   - Labels (project-specific) - bug, feature, chore, friction
   - Orchestrator Config - defaults to **disabled**
4. **Splash Screen**: Shows project status with keyboard shortcuts:
   - `q` - Quit Flux
   - `o` - Open browser to dashboard
   - `e` - Enable orchestrator

## Development

### Testing Bootstrap Flow

To test the full bootstrap experience repeatedly:

```bash
# Nuke all data and restart
bunx convex run nuke:all && bun run src/index.ts
```

This will:
1. Wipe all Convex data
2. Run the interactive bootstrap TUI
3. Create project with animated progress bar
4. Start the Flux server

### Project Configuration

The orchestrator starts **disabled** by default. You must explicitly enable it via:
- Press `e` in the splash screen
- Or via the web UI

## Architecture

- **Stack**: React + Bun + Tailwind + DaisyUI
- **Backend**: Convex (realtime persistence)
- **CLI**: OpenTUI for slick terminal interface
- **MCP**: Port 8042 (exposed at `/mcp/projects/:projectId`)

## Keyboard Shortcuts

### Splash Screen
- `q` - Quit Flux
- `o` - Open browser to dashboard  
- `e` - Enable orchestrator

### Create Form
- `↑/↓` or `Tab` - Navigate fields
- `Enter` - Submit

---

## Bun Template Info

<details>
<summary>Click to expand original Bun template documentation</summary>

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

### APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

### Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

</details>
