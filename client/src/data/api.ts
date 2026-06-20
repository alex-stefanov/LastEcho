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
  const res = await fetch(`${API_BASE}/api/outreach-queue${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}: failed to load outreach queue`);
  return res.json();
}

export async function approveDraft(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/approve`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: failed to approve draft`);
  return res.json();
}

export async function rejectDraft(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/reject`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: failed to reject draft`);
  return res.json();
}

export async function markSent(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/mark-sent`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: failed to mark draft sent`);
  return res.json();
}

export async function markReplied(id: number): Promise<OutreachDraft> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/mark-replied`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: failed to mark draft replied`);
  return res.json();
}

// Marks the current rung "no reply" and queues the next rung of the ladder
// (local -> continental -> global). Returns null if already at the last rung.
export async function escalateDraft(id: number): Promise<OutreachDraft | null> {
  const res = await fetch(`${API_BASE}/api/outreach-queue/${id}/escalate`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: failed to escalate draft`);
  return res.json();
}

export async function runTriage(): Promise<TriageRunResult> {
  const res = await fetch(`${API_BASE}/api/triage/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: failed to run triage sweep`);
  return res.json();
}
