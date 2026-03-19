# Snapfeed Python Backend Example

A self-contained [FastAPI](https://fastapi.tiangolo.com/) server that stores
`@microsoft/snapfeed` telemetry events in SQLite.

## Quick Start

```bash
pip install fastapi uvicorn
uvicorn server:app --port 8420
```

Then point the snapfeed client at it:

```ts
import { initSnapfeed } from '@microsoft/snapfeed'

initSnapfeed({ endpoint: 'http://localhost:8420/api/telemetry/events' })
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/telemetry/events` | Ingest a batch of events |
| GET | `/api/telemetry/events` | Query events (filter by `session_id`, `event_type`, `limit`) |
| GET | `/api/telemetry/sessions` | List sessions with event counts |
| GET | `/api/telemetry/events/{id}/screenshot` | Serve a feedback screenshot as JPEG |

## Files

- `server.py` — Complete server (~100 lines)
- `requirements.txt` — Dependencies
