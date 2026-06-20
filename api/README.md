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

| Variable                 | Default            | Purpose                              |
| ------------------------ | ------------------ | ------------------------------------ |
| `LASTECHO_CORS_ORIGINS`  | `*`                | Comma-separated allowed CORS origins |
| `LASTECHO_DATA_PATH`     | `api/data/...json` | Override the dataset location        |

See `.env.example`.
