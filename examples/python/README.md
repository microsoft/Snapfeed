# Snapfeed Python Backend Example

A self-contained [FastAPI](https://fastapi.tiangolo.com/) server that stores
`@microsoft/snapfeed` telemetry events in SQLite.

## Quick Start

```bash
pip install fastapi uvicorn
export SNAPFEED_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export SNAPFEED_ALLOWED_ORIGINS="http://localhost:5173"
uvicorn server:app --port 8420
```

The server refuses to start if `SNAPFEED_API_TOKEN` is missing or blank.
All four telemetry endpoints require `Authorization: Bearer <token>`.
`/health` and FastAPI's API documentation remain public; the health response
does not expose the database path.

For a **private, local development tool**, obtain the same token at runtime
(for example, prompt the developer rather than including it in a bundle):

```ts
import { initSnapfeed } from '@microsoft/snapfeed'

const token = window.prompt('Local Snapfeed API token')
if (!token) throw new Error('A local API token is required')

initSnapfeed({
  endpoint: 'http://localhost:8420/api/telemetry/events',
  headers: () => ({ Authorization: `Bearer ${token}` }),
})
```

Querying telemetry also requires the token:

```bash
curl -H "Authorization: Bearer $SNAPFEED_API_TOKEN" \
  http://localhost:8420/api/telemetry/events
```

## Security and Deployment

- Keep the token server-side for public applications. Send browser feedback to
  your authenticated backend and relay it to this server with the bearer header.
  Never embed a server-wide secret in public JavaScript, WordPress settings,
  source control, or a frontend build-time environment variable.
- Use HTTPS outside loopback development and restrict network access. This
  example uses one shared token, not per-user permissions or session isolation:
  anyone holding it can read and write all telemetry, including screenshots.
- `SNAPFEED_ALLOWED_ORIGINS` is a comma-separated list of exact HTTP(S) origins
  (scheme, host, optional port; no paths or wildcards). With it unset, no
  cross-origin browser access is enabled. Listed origins can preflight the
  `Authorization` and `Content-Type` headers; actual requests still require
  authentication. CORS is not authentication and does not restrict non-browser
  callers.
- Store and manage your deployment token outside this repository. Restart the
  server after configuration changes. The example does not manage token issuance,
  rotation, user login, or a production authorization policy.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/telemetry/events` | Ingest a batch of events |
| GET | `/api/telemetry/events` | Query events (filter by `session_id`, `event_type`, `limit`) |
| GET | `/api/telemetry/sessions` | List sessions with event counts |
| GET | `/api/telemetry/events/{id}/screenshot` | Serve a feedback screenshot as JPEG |

## Files

- `server.py` — Authenticated example server
- `requirements.txt` — Dependencies
- `requirements-test.txt` — Runtime and test dependencies
- `test_server.py` — Authentication, configuration, CORS and endpoint regressions

## Tests

From the repository root:

```bash
pip install -r examples/python/requirements-test.txt
python -m unittest discover -s examples/python -p "test_*.py" -v
```

Tests use temporary databases and test-only runtime tokens, not deployment secrets.
