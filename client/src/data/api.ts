// ---------------------------------------------------------------------------
// LastEcho — API client.
//
// The language dataset itself is bundled into the frontend (see
// data/languages.json) and no longer fetched. This client now only talks to
// the FastAPI server for the outreach layer, which is backend-driven state.
//
// In dev, Vite proxies /api -> http://localhost:8000 (see vite.config.ts).
// In prod, set VITE_API_BASE to the deployed API origin.
// ---------------------------------------------------------------------------

// --- outreach (the "response layer") ---------------------------------------
// Public surface is read-only: status + matched-institution context. Drafting,
// approving, and sending live behind the separate admin endpoints below —
// nothing here lets a visitor trigger or see outreach content.

export type InstitutionScope = 'regional' | 'national' | 'continental' | 'global';
export type InstitutionConfidence = 'verified' | 'auto-discovered';

export interface Institution {
  id: string;
  name: string;
  type: string;
  scope: InstitutionScope;
  confidence: InstitutionConfidence;
  helpTypes: string[];
  url: string;
  contactUrl: string;
  email?: string | null;
  blurb: string;
}

export interface OutreachStatusSummary {
  hasPending: boolean;
  hasApproved: boolean;
  hasRejected: boolean;
  hasSent: boolean;
  hasReplied: boolean;
  canEscalate: boolean;
  currentTier: OutreachTier | null;
  institutionCount: number;
}

// The escalation ladder: local (regional-or-national match) -> continental -> global.
export type OutreachTier = 'local' | 'continental' | 'global';

export type DraftStatus = 'pending_review' | 'approved' | 'rejected' | 'sent' | 'replied' | 'no_reply';

export interface OutreachDraft {
  id: number;
  languageId: number;
  institutionId: string;
  tier: OutreachTier;
  subject: string;
  body: string;
  ask: string;
  status: DraftStatus;
  createdAt: string;
  decidedAt: string | null;
  sentAt: string | null;
  canEscalate: boolean;
  // Denormalized for the admin view, which doesn't have the language list loaded.
  languageName: string;
  institutionName: string;
  institutionUrl: string;
  institutionContactUrl: string;
  institutionEmail?: string | null;
}

export interface TriageRunResult {
  drafted: number;
  skipped: number;
  escalated: number;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

// --- admin auth -------------------------------------------------------------
// The admin token is issued by the server (POST /api/admin/login) in exchange
// for credentials and kept only in sessionStorage. Every admin/triage call
// sends it as the X-Admin-Token header. No credential is ever embedded in the
// bundle, and the token alone is useless without the server having issued it.

const ADMIN_TOKEN_KEY = 'lastecho-admin-token';

export function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function hasAdminToken(): boolean {
  return Boolean(getAdminToken());
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function adminHeaders(): HeadersInit {
  const token = getAdminToken();
  return token ? { 'X-Admin-Token': token } : {};
}

// Exchange credentials for the admin token. Throws on bad credentials (401) or
// when admin auth isn't configured on the server (503).
export async function loginAdmin(user: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `API ${res.status}: login failed`);
  }
  const { token } = (await res.json()) as { token: string };
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export async function fetchOutreachStatus(): Promise<Record<number, OutreachStatusSummary>> {
  const res = await fetch(`${API_BASE}/api/outreach-status`);
  if (!res.ok) throw new Error(`API ${res.status}: failed to load outreach status`);
  return res.json();
}

export async function fetchInstitutions(languageId: number): Promise<Institution[]> {
  const res = await fetch(`${API_BASE}/api/languages/${languageId}/institutions`);
  if (!res.ok) throw new Error(`API ${res.status}: failed to load institutions`);
  return res.json();
}

// --- admin (approval + send) ------------------------------------------------
// Not linked from the public app. A human reviews drafted text here and is
// the one who actually sends it — see AdminView.tsx.

export async function fetchOutreachQueue(status?: DraftStatus): Promise<OutreachDraft[]> {
  const qs = status ? `?status=${status}` : '';
  const res = await fetch(`${API_BASE}/api/outreach-queue${qs}`, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to load outreach queue`);
  return res.json();
}

export async function approveDraft(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/approve`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to approve draft`);
  return res.json();
}

export async function rejectDraft(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/reject`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to reject draft`);
  return res.json();
}

export async function markSent(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/mark-sent`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to mark draft sent`);
  return res.json();
}

// Actually transmits the approved draft to the matched organization's email via
// the server's SMTP, then records it sent. Distinct from markSent (manual
// record): use this when the draft has a real institutionEmail. The server
// returns 400 (no recipient), 503 (SMTP not configured), or 502 (delivery
// failed) — surfaced here so the admin sees why a send didn't go out.
export async function sendDraft(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/send`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `API ${res.status}: failed to send draft`);
  }
  return res.json();
}

export async function markReplied(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/mark-replied`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to mark draft replied`);
  return res.json();
}

// Marks the current rung "no reply" and queues the next rung of the ladder
// (local -> continental -> global). Returns null if already at the last rung.
export async function escalateDraft(id: number): Promise<OutreachDraft | null> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/escalate`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to escalate draft`);
  return res.json();
}

export async function runTriage(): Promise<TriageRunResult> {
  const res = await fetch(`${API_BASE}/api/triage/run`, { method: 'POST', headers: adminHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: failed to run triage sweep`);
  return res.json();
}
