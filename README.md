<div align="center">

# 🔭 snapfeed

[![CI](https://github.com/microsoft/snapfeed/actions/workflows/ci.yml/badge.svg)](https://github.com/microsoft/snapfeed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.19%2B%20%7C%2022.12%2B-43853d.svg)](https://nodejs.org/)

**Close the loop between humans and AI agents.**

Capture UI feedback — screenshots, clicks, errors, context — and feed it<br>
straight back to the agent that built the interface.

`npm install @microsoft/snapfeed`

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Server](#server) · [Configuration](#configuration) · [Plugins](#plugins)

</div>

---

## Why Snapfeed?

AI agents can write UI code, but they can't _see_ the result. Snapfeed gives
them eyes. Drop one line into your app and every interaction — clicks,
navigation, errors, and annotated screenshots — flows into a structured
telemetry feed that an agent (or a human) can query.

### Use Case 1 — Agentic Dev Loop

The agent writes code. You test. When something's off, **Cmd+Click** anywhere
to capture an annotated screenshot with full page context. The agent reads the
feedback, fixes the code, and you test again.

```
┌──────────┐      ┌──────────┐      ┌───────────────┐      ┌──────────┐
│  Agent   │─────▶│  Your UI │─────▶│  You test it  │─────▶│  Agent   │
│ writes   │      │ (with    │      │  Cmd+Click    │      │ reads    │
│ code     │      │ snapfeed)│      │  feedback     │      │ feedback │
└──────────┘      └──────────┘      └───────────────┘      └────┬─────┘
     ▲                                                          │
     └──────────────────── fixes & iterates ◀───────────────────┘
```

### Use Case 2 — User → Queue → Agent

Ship snapfeed in your production app. Real users submit feedback with
categorized tags (🐛 Bug · 💡 Idea · ❓ Question · 🙌 Praise). Feedback
accumulates in a queue. An agent — or your dev team — triages and acts on it.

```
┌──────────┐      ┌──────────────┐      ┌──────────┐      ┌──────────┐
│  Users   │─────▶│  Snapfeed    │─────▶│  Queue   │─────▶│  Agent / │
│  in prod │      │  server      │      │  (SQLite)│      │  Dev team│
└──────────┘      └──────────────┘      └──────────┘      └──────────┘
```

---

## Quick Start

Requires Node.js `20.19.0+` or `22.12.0+`.

### 1. Add the client (one line)

```bash
npm install @microsoft/snapfeed
```

```ts
import { initSnapfeed } from "@microsoft/snapfeed";

initSnapfeed(); // that's it — Cmd+Click to send feedback
```

Snapfeed auto-captures clicks, navigation, errors, and API failures. No
config needed for local dev — events POST to `/api/telemetry/events` by default.

### 2. Start a server

**TypeScript** (Hono + SQLite):

```bash
npx snapfeed-server
# 🔭 snapfeed-server listening on http://localhost:8420
```

**Python** (FastAPI + SQLite):

```bash
cd examples/python && pip install -r requirements.txt
uvicorn server:app --port 8420
```

**Or mount into your own app:**

```ts
import { snapfeedRoutes, openDb } from "@microsoft/snapfeed-server";
import { Hono } from "hono";

const app = new Hono();
app.route("/", snapfeedRoutes(openDb({ path: "./feedback.db" })));
```

### 3. Query the feedback

```bash
# List sessions
curl localhost:8420/api/telemetry/sessions

# Get events for a session
curl localhost:8420/api/telemetry/events?session_id=abc-123

# Get only feedback (Cmd+Click) events
curl localhost:8420/api/telemetry/events?event_type=feedback

# View a screenshot
curl localhost:8420/api/telemetry/events/42/screenshot --output feedback.jpg
```

---

## What Gets Captured

| Event           | Trigger           | Detail                                                                     |
| --------------- | ----------------- | -------------------------------------------------------------------------- |
| `session_start` | `initSnapfeed()`  | Viewport, URL, user agent, plugins                                         |
| `click`         | Any click         | Element tag, role, CSS path, coordinates, component name (via plugins)     |
| `feedback`      | **Cmd+Click**     | Annotated screenshot, user message, category, console errors, page context |
| `navigation`    | SPA route change  | Path, hash, search params                                                  |
| `error`         | `window.onerror`  | Message, filename, line, stack trace                                       |
| `api_error`     | `fetch()` non-2xx | URL, status, method                                                        |
| `network_error` | `fetch()` failure | URL, error message, method                                                 |

All events include `session_id`, `seq`, `ts`, `page`, and `target`.

---

## Packages

| Package                                           | Description                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| [`@microsoft/snapfeed`](./packages/client)        | Client library — drop-in, framework-agnostic, zero config        |
| [`@microsoft/snapfeed-server`](./packages/server) | Reference backend — Hono + SQLite, pluggable or standalone       |
| [`examples/react`](./examples/react)              | React integration example and Playwright-backed verification lab |
| [`examples/python`](./examples/python)            | Python backend example — FastAPI + SQLite (~100 lines)           |

## React E2E Lab

The repo now includes a dedicated React app for end-to-end validation in [`examples/react`](./examples/react). It is intentionally not a polished product demo. Its job is to exercise the full browser-to-database flow against a real SQLite file and make that flow easy to automate while also serving as a concrete React integration example.

The app covers:

- `session_start` on boot
- `click` events from regular UI interaction
- `navigation` events from SPA route changes
- `api_error` and `network_error` via explicit failing fetch flows
- `error` via uncaught errors and unhandled rejections
- `feedback` via the real Cmd/Ctrl-click dialog with screenshot and context

### Run it manually

Use two terminals from the repo root:

```bash
npm run dev:react-e2e:server
npm run dev:react-e2e
```

Open the Vite app URL that prints in the terminal. The API server listens on `http://127.0.0.1:8420` by default and writes to a local SQLite file under `examples/react/.tmp/`.

### Run the automated browser suite

```bash
npm run test:react-e2e
```

The Playwright suite starts both the React app and the server harness, runs the browser flows, and verifies persisted DB rows.

### Runtime note

The harness prefers the real [`@microsoft/snapfeed-server`](./packages/server) implementation. If the local `better-sqlite3` native binding is unavailable, the dev server falls back to a `node:sqlite` compatibility server that preserves the same schema and endpoints so the React E2E workflow can still run on supported Node environments that expose the built-in SQLite module.

---

## Server API

Both the TypeScript and Python servers implement the same 4 endpoints:

| Method | Endpoint                               | Description                                              |
| ------ | -------------------------------------- | -------------------------------------------------------- |
| `POST` | `/api/telemetry/events`                | Ingest a batch of events                                 |
| `GET`  | `/api/telemetry/events`                | Query events (`?session_id=`, `?event_type=`, `?limit=`) |
| `GET`  | `/api/telemetry/sessions`              | List sessions with event counts                          |
| `GET`  | `/api/telemetry/events/:id/screenshot` | Serve feedback screenshot as JPEG                        |

**Building your own backend?** Implement `POST /api/telemetry/events` accepting:

```json
{
  "events": [
    {
      "session_id": "a1b2c3",
      "seq": 1,
      "ts": "2026-03-19T18:00:00.000Z",
      "event_type": "click",
      "page": "/dashboard",
      "target": "button.save",
      "detail": { "tag": "button", "x": 420, "y": 300 },
      "screenshot": null
    }
  ]
}
```

That's the only endpoint the client needs. The query endpoints are for you.

---

## Configuration

```ts
initSnapfeed({
  // Where to send events (default: '/api/telemetry/events')
  endpoint: "http://localhost:8420/api/telemetry/events",

  // Batch settings
  flushIntervalMs: 3000, // flush every 3s (default)
  maxQueueSize: 500, // ring buffer size (default)

  // What to capture
  trackClicks: true, // click events (default)
  trackNavigation: true, // SPA route changes (default)
  trackErrors: true, // window errors + unhandled rejections (default)
  trackApiErrors: true, // monkey-patch fetch() for non-2xx (default)
  captureConsoleErrors: true, // buffer recent console.error output (default)

  // Feedback dialog (Cmd+Click)
  feedback: {
    enabled: true,
    screenshotMaxWidth: 1200,
    screenshotQuality: 0.6,
    annotations: true, // let users draw on the screenshot
  },

  // Optional user identity
  user: { name: "Jane", email: "jane@example.com" },

  // Adapters — fan out feedback to external systems
  adapters: [webhookAdapter("https://hooks.slack.com/...")],

  // Plugins — framework-specific enrichment
  plugins: [reactPlugin()],
});
```

Returns a teardown function: `const teardown = initSnapfeed(); teardown()`

---

## Plugins

Plugins enrich click and feedback events with framework-specific context
(component names, source file locations, etc.).

```ts
import { registerPlugin } from "@microsoft/snapfeed";

registerPlugin({
  name: "react",
  enrichElement(el) {
    const fiber = (el as any).__reactFiber$; // simplified
    return fiber ? { componentName: fiber.type?.name } : null;
  },
});
```

When a plugin is active, click events include `component` and `source_file`
in their detail — so your agent knows exactly which component was clicked.

---

## Adapters

Adapters deliver feedback events to external systems in addition to the
telemetry endpoint. They run on every feedback (Cmd+Click) event.

```ts
import { consoleAdapter, webhookAdapter } from "@microsoft/snapfeed";
import {
  githubAdapter,
  slackAdapter,
  telegramAdapter,
} from "@microsoft/snapfeed/adapters";

initSnapfeed({
  adapters: [
    consoleAdapter(), // log to dev console
    webhookAdapter("https://my-api.com/hook"), // POST to a webhook
    githubAdapter({
      // create GitHub issues
      token: process.env.GITHUB_TOKEN!,
      owner: "my-org",
      repo: "my-app",
      labels: ["feedback", "from-user"],
    }),
    slackAdapter({
      // post to Slack
      webhookUrl: process.env.SLACK_WEBHOOK!,
    }),
    telegramAdapter({
      // send to Telegram
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    }),
  ],
});
```

| Adapter                  | Destination       | Screenshot         |
| ------------------------ | ----------------- | ------------------ |
| `consoleAdapter()`       | Dev console       | —                  |
| `webhookAdapter(url)`    | Any HTTP endpoint | JSON payload       |
| `githubAdapter({...})`   | GitHub Issues     | Embedded in body   |
| `slackAdapter({...})`    | Slack channel     | Block Kit message  |
| `telegramAdapter({...})` | Telegram chat     | Photo with caption |

Custom adapters implement `{ name: string, send(event): Promise<{ ok, error? }> }`.

---

## Server Integrations

### Next.js App Router

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from "@microsoft/snapfeed-server/nextjs";
import { slackAdapter } from "@microsoft/snapfeed/adapters";

const handler = createFeedbackHandler({
  adapters: [slackAdapter({ webhookUrl: process.env.SLACK_WEBHOOK! })],
  rateLimit: { max: 10, windowMs: 60_000 },
  allowedOrigins: ["https://myapp.com"],
});

export const POST = handler.POST;
export const GET = handler.GET;
```

### Express

```ts
import express from "express";
import { createExpressRouter } from "@microsoft/snapfeed-server/express";
import { openDb } from "@microsoft/snapfeed-server";

const app = express();
app.use(express.json());
app.use(createExpressRouter(openDb({ path: "./feedback.db" })));
app.listen(3000);
```

---

## Server Security

The standalone Hono server includes rate limiting by default (60 req/min).
For custom setups, use the security middleware individually:

```ts
import { snapfeedRoutes, openDb } from "@microsoft/snapfeed-server";
import {
  rateLimit,
  originAllowlist,
  payloadLimits,
} from "@microsoft/snapfeed-server/security";
import { Hono } from "hono";

const app = new Hono();

// Rate limit: 30 requests per minute per IP
app.use("/api/*", rateLimit({ max: 30, windowMs: 60_000 }));

// Only accept requests from your domain
app.use("/api/*", originAllowlist({ origins: ["https://myapp.com"] }));

// Limit payload sizes (10KB text, 5MB screenshots)
app.use(
  "/api/*",
  payloadLimits({ maxPayloadBytes: 10_000, maxScreenshotBytes: 5_242_880 }),
);

app.route("/", snapfeedRoutes(openDb({ path: "./feedback.db" })));
```

---

## License

MIT
