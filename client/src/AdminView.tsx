import { useEffect, useMemo, useState } from 'react';
import {
  approveDraft,
  escalateDraft,
  fetchOutreachQueue,
  markReplied,
  markSent,
  rejectDraft,
  sendDraft,
  type DraftStatus,
  type OutreachDraft,
} from './data/api';
import ThemeToggle, { type Theme } from './components/ThemeToggle';

type AdminViewFilter = 'review' | 'ready' | 'active' | 'closed';

const THEME_KEY = 'lastecho-theme';

type StatusTone = 'pending' | 'approved' | 'sent' | 'replied' | 'rejected' | 'no_reply';

const FILTERS: { key: AdminViewFilter; label: string; statuses: DraftStatus[] }[] = [
  { key: 'review', label: 'Review', statuses: ['pending_review'] },
  { key: 'ready', label: 'Ready', statuses: ['approved'] },
  { key: 'active', label: 'Sent', statuses: ['sent', 'no_reply'] },
  { key: 'closed', label: 'Closed', statuses: ['replied', 'rejected'] },
];

const STATUS_LABEL: Record<DraftStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Ready to send',
  rejected: 'Rejected',
  sent: 'Awaiting reply',
  replied: 'Replied',
  no_reply: 'No reply',
};

const MOCK_DRAFTS: OutreachDraft[] = [
  {
    id: 1001,
    languageId: 14,
    institutionId: 'local-batsbi-center',
    tier: 'local',
    subject: 'Documentation support for Batsbi speakers',
    body:
      'Hello,\n\nLastEcho flagged Batsbi as a high-priority language for near-term documentation support. We are looking for a local partner who can confirm current speaker estimates, existing recordings, and whether community-led documentation work is already active.\n\nCould your team advise who the right contact would be for this language community?',
    ask: 'Confirm contact, speaker estimate, and active documentation status.',
    status: 'pending_review',
    createdAt: '2026-06-18T08:30:00.000Z',
    decidedAt: null,
    sentAt: null,
    canEscalate: false,
    languageName: 'Batsbi',
    institutionName: 'Caucasus Language Archive',
    institutionUrl: 'https://example.org/caucasus-archive',
    institutionContactUrl: 'https://example.org/caucasus-archive/contact',
    institutionEmail: 'contact@example.org',
  },
  {
    id: 1002,
    languageId: 22,
    institutionId: 'continental-archive',
    tier: 'continental',
    subject: 'Partner request: Koro language preservation',
    body:
      'Hello,\n\nWe are preparing an outreach packet for Koro and would like to verify which organizations are already working with the community. The goal is not to duplicate effort, but to route urgent documentation support to the right people.\n\nCould you point us toward the best current contact or archive record?',
    ask: 'Find the right active contact or archive record before escalation.',
    status: 'approved',
    createdAt: '2026-06-17T13:12:00.000Z',
    decidedAt: '2026-06-18T09:42:00.000Z',
    sentAt: null,
    canEscalate: false,
    languageName: 'Koro',
    institutionName: 'Endangered Languages Documentation Programme',
    institutionUrl: 'https://example.org/eldp',
    institutionContactUrl: 'https://example.org/eldp/contact',
    institutionEmail: null,
  },
  {
    id: 1003,
    languageId: 31,
    institutionId: 'local-oral-history',
    tier: 'local',
    subject: 'Request for current materials on N|uu',
    body:
      'Hello,\n\nLastEcho is tracking N|uu as a language where existing documentation and community access should be checked carefully. We would like to verify whether there are active oral-history recordings, teaching materials, or community contacts that should be prioritized.\n\nCould you share the correct contact path?',
    ask: 'Check whether existing materials are accessible to the community.',
    status: 'sent',
    createdAt: '2026-06-08T10:04:00.000Z',
    decidedAt: '2026-06-08T15:24:00.000Z',
    sentAt: '2026-06-09T11:20:00.000Z',
    canEscalate: true,
    languageName: 'N|uu',
    institutionName: 'Southern African Oral History Network',
    institutionUrl: 'https://example.org/oral-history',
    institutionContactUrl: 'https://example.org/oral-history/contact',
    institutionEmail: 'archive@example.org',
  },
  {
    id: 1004,
    languageId: 43,
    institutionId: 'global-linguistics',
    tier: 'global',
    subject: 'Follow-up: urgent record check for Ainu',
    body:
      'Hello,\n\nWe are following up after a previous local and continental search. LastEcho needs help validating whether Ainu support should be routed to an active documentation project, a university archive, or a community-led organization.\n\nAny verified direction would help us avoid sending support to stale contacts.',
    ask: 'Validate the best global route after local search stalled.',
    status: 'replied',
    createdAt: '2026-06-02T09:45:00.000Z',
    decidedAt: '2026-06-02T10:10:00.000Z',
    sentAt: '2026-06-03T08:00:00.000Z',
    canEscalate: false,
    languageName: 'Ainu',
    institutionName: 'Global Language Archive Network',
    institutionUrl: 'https://example.org/global-archive',
    institutionContactUrl: 'https://example.org/global-archive/contact',
    institutionEmail: 'desk@example.org',
  },
  {
    id: 1005,
    languageId: 56,
    institutionId: 'regional-institute',
    tier: 'local',
    subject: 'Draft declined: Wukchumni local contact',
    body:
      'This draft was declined because the proposed organization had no clear language preservation role. A better local partner should be found before sending.',
    ask: 'Replace the organization before creating a new draft.',
    status: 'rejected',
    createdAt: '2026-06-15T16:30:00.000Z',
    decidedAt: '2026-06-16T08:10:00.000Z',
    sentAt: null,
    canEscalate: false,
    languageName: 'Wukchumni',
    institutionName: 'Regional Culture Office',
    institutionUrl: 'https://example.org/regional-culture',
    institutionContactUrl: 'https://example.org/regional-culture/contact',
    institutionEmail: null,
  },
];

function toneFor(status: DraftStatus): StatusTone {
  return status === 'pending_review' ? 'pending' : status;
}

function mailtoFor(d: OutreachDraft): string {
  const params = new URLSearchParams({ subject: d.subject, body: d.body });
  return `mailto:${d.institutionEmail}?${params.toString()}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export default function AdminView() {
  const [filter, setFilter] = useState<AdminViewFilter>('review');
  const [drafts, setDrafts] = useState<OutreachDraft[]>(MOCK_DRAFTS);
  const [selectedId, setSelectedId] = useState<number>(MOCK_DRAFTS[0].id);
  const [copied, setCopied] = useState(false);
  // `live` flips to true once the real outreach queue loads; until then (and if
  // the API is unreachable) the console runs on MOCK_DRAFTS so the design demo
  // still works offline. In live mode, actions hit the backend for real —
  // including the SMTP send.
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Load the real queue once. A failure leaves the mock demo in place.
  useEffect(() => {
    let cancelled = false;
    fetchOutreachQueue()
      .then((rows) => {
        if (cancelled) return;
        setLive(true);
        setDrafts(rows);
        if (rows[0]) setSelectedId(rows[0].id);
      })
      .catch(() => {
        /* API down — keep MOCK_DRAFTS so the console still renders */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];

  const visibleDrafts = useMemo(
    () => drafts.filter((draft) => activeFilter.statuses.includes(draft.status)),
    [drafts, activeFilter],
  );

  const selected = drafts.find((draft) => draft.id === selectedId) ?? visibleDrafts[0] ?? null;

  const stats = useMemo(
    () => ({
      review: drafts.filter((draft) => draft.status === 'pending_review').length,
      ready: drafts.filter((draft) => draft.status === 'approved').length,
      sent: drafts.filter((draft) => draft.status === 'sent' || draft.status === 'no_reply').length,
    }),
    [drafts],
  );

  // Offline/demo path: mutate local state only.
  const setStatusLocal = (id: number, status: DraftStatus) => {
    setDrafts((items) =>
      items.map((draft) =>
        draft.id === id
          ? {
              ...draft,
              status,
              decidedAt: status === 'approved' || status === 'rejected' ? new Date().toISOString() : draft.decidedAt,
              sentAt: status === 'sent' ? new Date().toISOString() : draft.sentAt,
              canEscalate: status === 'sent' ? draft.canEscalate : false,
            }
          : draft,
      ),
    );
  };

  // In live mode, run the backend action then refetch the queue so the view
  // reflects server truth — escalate, for instance, marks the current draft
  // no_reply *and* spawns the next-rung draft, which a local patch can't model.
  const act = async (
    id: number,
    localStatus: DraftStatus,
    apiCall?: (id: number) => Promise<OutreachDraft | null>,
  ) => {
    setError(null);
    if (!live || !apiCall) {
      setStatusLocal(id, localStatus);
      return;
    }
    setBusy(true);
    try {
      await apiCall(id);
      const rows = await fetchOutreachQueue();
      setDrafts(rows);
      if (!rows.some((r) => r.id === selectedId)) setSelectedId(rows[0]?.id ?? selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const copyDraft = () => {
    if (!selected || !navigator.clipboard) return;
    navigator.clipboard.writeText(`${selected.subject}\n\n${selected.body}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <main className="admin">
      <section className="admin-shell">
        <header className="admin-topbar">
          <div>
            <h1>Signal Desk</h1>
            <p className="admin-tagline">Admin console for outreach review and partner contact decisions.</p>
          </div>
          <ThemeToggle theme={theme} onToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} />
        </header>

        <section className="admin-metrics" aria-label="Admin overview">
          <article className="admin-metric-card">
            <span>Review</span>
            <strong>{stats.review}</strong>
          </article>
          <article className="admin-metric-card">
            <span>Ready</span>
            <strong>{stats.ready}</strong>
          </article>
          <article className="admin-metric-card">
            <span>Sent</span>
            <strong>{stats.sent}</strong>
          </article>
        </section>

        <nav className="admin-tabs" aria-label="Outreach filters">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              className={`admin-tab ${filter === item.key ? 'active' : ''}`}
              type="button"
              onClick={() => {
                setFilter(item.key);
                setSelectedId((current) => {
                  const nextVisible = drafts.filter((draft) => item.statuses.includes(draft.status));
                  return nextVisible.some((draft) => draft.id === current) ? current : nextVisible[0]?.id ?? current;
                });
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="admin-workspace">
          <aside className="admin-queue" aria-label="Outreach queue">
            <div className="admin-section-head">
              <span>Queue</span>
              <strong>{visibleDrafts.length}</strong>
            </div>

            {visibleDrafts.length === 0 && <div className="admin-empty">No drafts here.</div>}

            {visibleDrafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                className={`admin-queue-card ${selected?.id === draft.id ? 'active' : ''}`}
                onClick={() => setSelectedId(draft.id)}
              >
                <span className={`admin-status-line tone-${toneFor(draft.status)}`} />
                <span className="admin-queue-main">
                  <span className="admin-queue-title">{draft.languageName}</span>
                  <span className="admin-queue-org">{draft.institutionName}</span>
                </span>
              </button>
            ))}
          </aside>

          <section className="admin-detail" aria-label="Selected outreach draft">
            {!selected && <div className="admin-empty large">Select a draft to preview it.</div>}

            {selected && (
              <article className="admin-panel-sheet">
                <div className="admin-detail-head">
                  <h2>{selected.languageName}</h2>
                </div>

                <div className="admin-field-grid">
                  <div className="admin-field wide">
                    <span>Institution</span>
                    <a href={selected.institutionUrl} target="_blank" rel="noreferrer">
                      {selected.institutionName}
                    </a>
                  </div>
                  <div className="admin-field">
                    <span>Contact</span>
                    <strong>{selected.institutionEmail ?? 'Contact page'}</strong>
                  </div>
                  <div className="admin-field">
                    <span>Status</span>
                    <strong>{STATUS_LABEL[selected.status]}</strong>
                  </div>
                  <div className="admin-field">
                    <span>Created</span>
                    <strong>{formatDate(selected.createdAt)}</strong>
                  </div>
                </div>

                <div className="admin-message-card">
                  <span>Subject</span>
                  <h3>{selected.subject}</h3>
                  <pre>{selected.body}</pre>
                </div>

                <div className="admin-check-row">
                  <span>Admin check</span>
                  <p>{selected.ask}</p>
                </div>

                <div className="admin-actions-row">
                  {selected.status === 'pending_review' && (
                    <>
                      <button className="admin-action primary" type="button" disabled={busy} onClick={() => act(selected.id, 'approved', approveDraft)}>
                        Approve
                      </button>
                      <button className="admin-action" type="button" disabled={busy} onClick={() => act(selected.id, 'rejected', rejectDraft)}>
                        Reject
                      </button>
                    </>
                  )}

                  {selected.status === 'approved' && (
                    <>
                      {selected.institutionEmail ? (
                        <button className="admin-action primary" type="button" disabled={busy} onClick={() => act(selected.id, 'sent', sendDraft)}>
                          {busy ? 'Sending…' : 'Send email'}
                        </button>
                      ) : (
                        <a className="admin-action primary" href={selected.institutionContactUrl} target="_blank" rel="noreferrer">
                          Contact page
                        </a>
                      )}
                      {selected.institutionEmail && (
                        <a className="admin-action" href={mailtoFor(selected)}>
                          Open email
                        </a>
                      )}
                      <button className="admin-action" type="button" onClick={copyDraft}>
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button className="admin-action" type="button" disabled={busy} onClick={() => act(selected.id, 'sent', markSent)}>
                        Mark sent
                      </button>
                    </>
                  )}

                  {selected.status === 'sent' && (
                    <>
                      <button className="admin-action primary" type="button" disabled={busy} onClick={() => act(selected.id, 'replied', markReplied)}>
                        Mark replied
                      </button>
                      <button className="admin-action" type="button" disabled={busy || !selected.canEscalate} onClick={() => act(selected.id, 'no_reply', escalateDraft)}>
                        Escalate
                      </button>
                    </>
                  )}

                  {(selected.status === 'replied' || selected.status === 'rejected' || selected.status === 'no_reply') && (
                    <button className="admin-action" type="button" onClick={() => setStatusLocal(selected.id, 'pending_review')}>
                      Return to review
                    </button>
                  )}
                </div>

                {error && <p className="admin-error" role="alert">{error}</p>}
              </article>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
