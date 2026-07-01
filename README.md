# LastEcho

LastEcho is an interactive platform for exploring endangered-language data and coordinating structured outreach to institutions that can help document and preserve at-risk languages.

The public frontend visualizes language vitality across time on a 3D globe. The backend ranks high-risk languages, drafts outreach emails, queues them for human review, and supports escalation from local to continental to global institutions when no response is received.

## Features

- Interactive 3D globe with language vitality data
- Timeline exploration from 2000 to 2050
- Language detail views with family, speaker count, documentation level, and institution matches
- Rescue queue for prioritizing urgent languages
- Admin review workflow for outreach drafts
- Optional Claude-powered email drafting with deterministic fallback
- SMTP sending and no-reply escalation workflow
- SQLite persistence for outreach state and cached institution lookups

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Three.js, react-globe.gl |
| Backend | Python, FastAPI, SQLite, Uvicorn |
| AI | Anthropic Claude, optional |
| Data | Generated language timeline JSON, ROR institution lookup |
| Testing | Pytest |
| Deployment | Docker, Fly.io, Vercel-ready client |

## Project Structure

```text
api/       # FastAPI backend, outreach queue, triage, persistence
client/    # React/Vite frontend and globe visualization
ml/        # Data enhancement and prediction utilities
scripts/   # Dataset processing scripts
```

## Getting Started

### Backend

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd client
npm install
npm run dev
```

- App: `http://localhost:5173`
- API docs: `http://localhost:8000/docs`

## Environment Variables

Create `api/.env` for backend configuration:

```env
LASTECHO_ADMIN_PASSWORD=change-me
LASTECHO_CORS_ORIGINS=http://localhost:5173
LASTECHO_SMTP_HOST=smtp.example.com
LASTECHO_SMTP_PORT=587
LASTECHO_SMTP_USER=your-user
LASTECHO_SMTP_PASSWORD=your-password
LASTECHO_SMTP_FROM=outreach@example.com
ANTHROPIC_API_KEY=optional
```

Create `client/.env.local` for client-side admin credentials used by the UI.

## Testing

```bash
cd api
pytest
```

## Production Build

```bash
cd client
npm run build

cd ../api
docker build -t lastecho-api .
```

## License

No license file is currently included.
