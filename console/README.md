# homeops-console

A Vite + React TV mission-control console for the homeops event bus.

## Quick start

```bash
# Install dependencies
npm install

# Start development server (runs at http://localhost:5173 by default)
npm run dev
```

The console connects to the event bus at `http://localhost:8000` by default.
Override with `VITE_BUS_URL` environment variable, e.g.:

```bash
VITE_BUS_URL=http://192.168.1.42:8000 npm run dev
```

## Components

- **Event Stream** (left): Shows live events from the bus with color-coded types
- **Agent Reasoning** (right): Displays `agent.thought`, `agent.action`, and `voice.say` events
- **Agent Cards** (bottom): Security lights up on `agent.action` events; Perception & Comms are static

## Development

- `npm run dev` — starts Vite dev server
- `npm run build` — creates production build in `console/dist/`
- `npm test` — runs any tests

## Environment

- `VITE_BUS_URL` — override the default bus URL (`http://localhost:8000`)
- The app fetches initial state from `GET /state` on mount, then streams `GET /stream` via EventSource