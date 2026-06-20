# LastEcho API

FastAPI service that serves the precomputed language dataset to the frontend.
It never trains a model and never fetches from the web at runtime — it loads one
JSON artifact into memory at startup and hands it out.

## Layout

```
api/
├── app/                  # the FastAPI application
│   ├── main.py           # app factory, middleware, lifespan, router mounting
│   ├── config.py         # settings (env-overridable, sensible defaults)
│   ├── schemas.py        # Pydantic models = response shapes + OpenAPI + validation
│   ├── data.py           # DataStore: load-once, in-memory dataset
│   ├── dependencies.py   # shared FastAPI dependencies
│   └── routers/
│       └── languages.py  # /api/health, /api/meta, /api/languages
├── scripts/
│   └── build_data.py     # OFFLINE: generates data/languages.json (stdlib only)
├── data/
│   └── languages.json    # the artifact (generated, git-ignored if you prefer)
├── tests/
│   └── test_api.py       # contract smoke tests
├── requirements.txt
└── requirements-dev.txt
```

The split mirrors the real plan: `scripts/build_data.py` is the offline
train-and-predict slot (today it generates a mock dataset); `app/` only ever
reads the artifact it produces.

## Setup

```bash
cd api
python -m venv .venv
.venv\Scripts\Activate.ps1        # Windows PowerShell
# source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
```

## Run

```bash
python scripts/build_data.py                       # (re)generate the dataset
uvicorn app.main:app --reload --port 8000
```

- Service info: http://localhost:8000/
- Health:       http://localhost:8000/api/health
- Data:         http://localhost:8000/api/languages
- Swagger UI:   http://localhost:8000/docs

The Vite dev server proxies `/api/*` to port 8000, so the frontend fetches
`/api/languages` with no CORS setup in development.

## Test

```bash
pip install -r requirements-dev.txt
pytest
```

## Configuration

| Variable                      | Default                                       | Purpose                                                                                    |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `LASTECHO_CORS_ORIGINS`       | `localhost:5173,localhost:4173`               | Comma-separated allowed CORS origins (never `*`; set to the deployed frontend in prod)     |
| `LASTECHO_DATA_PATH`          | `api/data/...json`                            | Override the dataset location                                                              |
| `LASTECHO_ORGANIZATIONS_PATH` | `client/src/data/language_organizations.json` | Emailable orgs matched into the local rung of the ladder                                   |
| `LASTECHO_ADMIN_USER`         | `admin`                                       | Admin username for `POST /api/admin/login`                                                 |
| `LASTECHO_ADMIN_PASSWORD`     | unset                                         | Admin password. **Unset → admin/triage endpoints fail closed (503)**                       |
| `LASTECHO_ADMIN_TOKEN`        | random per process                            | Stable bearer token (so admin sessions survive restarts); otherwise regenerated each boot  |
| `LASTECHO_RATE_LIMIT_PER_MIN` | `120`                                         | Per-IP request cap (sliding 60s window); `0` disables                                      |
| `LASTECHO_RUN_SWEEP_ON_STARTUP` | `false`                                     | Run the triage sweep once at startup (backgrounded). Off by default — use the endpoint     |
| `LASTECHO_SMTP_*`             | unset / `587` / `true`                        | `HOST/PORT/USER/PASSWORD/FROM/USE_TLS` for real sending. Without host+from, send returns 503 |

See `.env.example`.

## Admin authentication

The admin (outreach-queue) and triage endpoints are gated by a bearer token.
Set `LASTECHO_ADMIN_PASSWORD`, then `POST /api/admin/login` with `{user, password}`
to receive a token, which the client sends as the `X-Admin-Token` header on every
admin/triage call. With no password set, those endpoints (and login) return 503 —
there is no client-side-only gate.

## Sending an outreach email

The triage sweep drafts emails per language, a human approves them, then:

- `POST /api/outreach-queue/{id}/send` — **really sends** an approved draft over
  SMTP to the matched organization's address, then marks it `sent`. Requires a
  recipient `institutionEmail` (the local-rung orgs from
  `language_organizations.json` all have one) and configured SMTP.
- `POST /api/outreach-queue/{id}/mark-sent` — only *records* that the admin sent
  it manually (for institutions with no email, just a contact page).
