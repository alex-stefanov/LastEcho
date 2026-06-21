import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  approveDraft,
  clearAdminToken,
  escalateDraft,
  fetchOutreachQueue,
  hasAdminToken,
  loginAdmin,
  markReplied,
  rejectDraft,
  runTriage,
  sendDraft,
  updateDraft,
  type DraftStatus,
  type OutreachDraft,
  type OutreachTier,
} from './data/api';
import ThemeToggle, { type Theme } from './components/ThemeToggle';

type AdminViewFilter = 'review' | 'active' | 'closed';
type AdminSort = 'priority' | 'oldest' | 'newest';

const TIER_RANK: Record<OutreachTier, number> = { global: 3, continental: 2, local: 1 };

const SORTS: { key: AdminSort; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'newest', label: 'Newest' },
];

function priorityScore(d: OutreachDraft): number {
  const tier = TIER_RANK[d.tier] ?? 1;
  const ageDays = (Date.now() - new Date(d.createdAt).getTime()) / 86_400_000;
  return tier * 10_000 + ageDays;
}

function sortDrafts(drafts: OutreachDraft[], mode: AdminSort): OutreachDraft[] {
  const copy = [...drafts];
  if (mode === 'priority') return copy.sort((a, b) => priorityScore(b) - priorityScore(a));
  const t = (d: OutreachDraft) => new Date(d.createdAt).getTime();
  return copy.sort((a, b) => (mode === 'oldest' ? t(a) - t(b) : t(b) - t(a)));
}

const THEME_KEY = 'lastecho-theme';

type StatusTone = 'pending' | 'approved' | 'sent' | 'replied' | 'rejected' | 'no_reply';

// 'approved' lives in Review too: a draft only reaches 'approved' transiently
// while being sent, so if delivery fails it stays visible here to retry.
const FILTERS: { key: AdminViewFilter; label: string; statuses: DraftStatus[] }[] = [
  { key: 'review', label: 'Review', statuses: ['pending_review', 'approved'] },
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

function toneFor(status: DraftStatus): StatusTone {
  return status === 'pending_review' ? 'pending' : status;
}

// Defence-in-depth: institution URLs can originate from third-party ROR data.
// The backend already restricts stored URLs to http(s), but never render an
// href the component itself hasn't scheme-checked — React does not sanitize
// href values, so an unexpected `javascript:`/`data:` URL would otherwise run.
function safeUrl(url: string | null | undefined): string {
  if (url && /^(https?:|mailto:)/i.test(url)) return url;
  return '#';
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

interface AdminLoginProps {
  theme: Theme;
  onToggleTheme: () => void;
  onLogin: () => void;
}

function AdminLogin({ theme, onToggleTheme, onLogin }: AdminLoginProps) {
  const [credentials, setCredentials] = useState({ user: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setCredentials((current) => ({ ...current, [name]: value }));
    setError(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Credentials are verified by the server, which returns the admin token.
      await loginAdmin(credentials.user.trim(), credentials.password);
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin admin-login-page">
      <section className="admin-login-shell" aria-label="Admin login">
        <div className="admin-login-copy">
          <span className="admin-login-eyebrow">Protected admin area</span>
          <h1>Signal Desk</h1>
          <p>Sign in to review outreach drafts and contact decisions.</p>
        </div>
        <form className="admin-login-card" onSubmit={onSubmit}>
          <div className="admin-login-head">
            <div>
              <h2>Admin login</h2>
              <p>Credentials are verified by the server.</p>
            </div>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
          <label className="admin-login-field">
            <span>Username</span>
            <input autoComplete="username" name="user" placeholder="admin" value={credentials.user} onChange={onChange} />
          </label>
          <label className="admin-login-field">
            <span>Password</span>
            <input autoComplete="current-password" name="password" placeholder="Password" type="password" value={credentials.password} onChange={onChange} />
          </label>
          {error && <p className="admin-login-error">{error}</p>}
          <button className="admin-login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Enter dashboard'}</button>
        </form>
      </section>
    </main>
  );
}

export default function AdminView() {
  const [filter, setFilter] = useState<AdminViewFilter>('review');
  const [sortMode, setSortMode] = useState<AdminSort>('priority');
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({ subject: '', body: '', institutionEmail: '' });
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');
  const [authenticated, setAuthenticated] = useState(() => hasAdminToken());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    fetchOutreachQueue()
      .then((rows) => {
        if (cancelled) return;
        setDrafts(rows);
        if (rows[0]) setSelectedId(rows[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        // A 401 means the token is stale/invalid — drop back to the login screen.
        if (e instanceof Error && e.message.includes('401')) {
          clearAdminToken();
          setAuthenticated(false);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load queue');
        }
      });
    return () => { cancelled = true; };
  }, [authenticated]);

  const activeFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];

  const visibleDrafts = useMemo(
    () => sortDrafts(drafts.filter((draft) => activeFilter.statuses.includes(draft.status)), sortMode),
    [drafts, activeFilter, sortMode],
  );

  const selected = drafts.find((draft) => draft.id === selectedId) ?? visibleDrafts[0] ?? null;
  // A draft awaiting send (pending or transiently approved) is shown as an
  // editable form by default — the admin fills in the email, tweaks the letter
  // if needed, and sends. Everything else is read-only.
  const isReview = selected?.status === 'pending_review' || selected?.status === 'approved';

  // Load the selected draft's content into the form whenever the selection
  // changes, so the inputs always reflect the draft on screen.
  useEffect(() => {
    if (selected && isReview) {
      setEditFields({
        subject: selected.subject,
        body: selected.body,
        institutionEmail: selected.institutionEmail ?? '',
      });
    }
  }, [selected?.id]);

  const stats = useMemo(() => ({
    review: drafts.filter((draft) => draft.status === 'pending_review' || draft.status === 'approved').length,
    sent: drafts.filter((draft) => draft.status === 'sent' || draft.status === 'no_reply').length,
  }), [drafts]);

  const act = async (id: number, apiCall: (id: number) => Promise<OutreachDraft | null>) => {
    setError(null);
    setBusy(true);
    try {
      await apiCall(id);
      const rows = await fetchOutreachQueue();
      setDrafts(rows);
      if (!rows.some((r) => r.id === selectedId)) setSelectedId(rows[0]?.id ?? null);
      // Background sweep on the server (returns immediately); re-fetch shortly
      // after to pick up anything it drafted. Fire-and-forget.
      runTriage()
        .then(() => {
          setTimeout(() => {
            fetchOutreachQueue().then(setDrafts).catch(() => {});
          }, 4000);
        })
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  // The one action for a review draft: save the admin's edits (recipient,
  // subject, body), approve, and deliver it — landing it straight in Sent.
  // A recipient is mandatory, so an empty email blocks before anything is sent.
  const sendNow = async () => {
    if (!selected) return;
    const email = editFields.institutionEmail.trim();
    if (!email) {
      setError('A recipient email is required.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await updateDraft(selected.id, { ...editFields, institutionEmail: email });
      if (selected.status === 'pending_review') await approveDraft(selected.id);
      await sendDraft(selected.id);
      const rows = await fetchOutreachQueue();
      setDrafts(rows);
      if (!rows.some((r) => r.id === selectedId)) setSelectedId(rows[0]?.id ?? null);
      // Handling a draft can free a review slot — top the queue back up with the
      // next most-urgent untouched language. The sweep now runs in the background
      // on the server (returns immediately), so kick it off and re-fetch shortly
      // after to pick up anything it drafted. Fire-and-forget so the action stays snappy.
      runTriage()
        .then(() => {
          setTimeout(() => {
            fetchOutreachQueue().then(setDrafts).catch(() => {});
          }, 4000);
        })
        .catch(() => {});
    } catch (e) {
      // Send may have failed after approve — refresh so the draft reflects its
      // real status and stays in Review for a retry.
      fetchOutreachQueue().then(setDrafts).catch(() => {});
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearAdminToken();
    setAuthenticated(false);
  };

  // Leaving the admin surface ends the session: clear the token, then navigate
  // back to the public globe so returning to /admin requires logging in again.
  const goHome = () => {
    clearAdminToken();
    window.location.href = '/';
  };

  if (!authenticated) {
    return <AdminLogin theme={theme} onToggleTheme={() => setTheme((c) => c === 'dark' ? 'light' : 'dark')} onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <main className="admin">
      <section className="admin-shell">
        <header className="admin-topbar">
          <div>
            <button className="admin-back" type="button" onClick={goHome}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
              <span>Back to globe</span>
            </button>
            <h1>Signal Desk</h1>
            <p className="admin-tagline">Admin console for outreach review and partner contact decisions.</p>
          </div>
          <div className="admin-header-actions">
            <span className="admin-session-label">Admin</span>
            <ThemeToggle theme={theme} onToggle={() => setTheme((c) => c === 'dark' ? 'light' : 'dark')} />
            <button className="admin-logout" type="button" onClick={logout}>Log out</button>
          </div>
        </header>

        <section className="admin-metrics" aria-label="Admin overview">
          <article className="admin-metric-card"><span>Review</span><strong>{stats.review}</strong></article>
          <article className="admin-metric-card"><span>Sent</span><strong>{stats.sent}</strong></article>
        </section>

        <div className="admin-controls">
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

          <div className="admin-sort" aria-label="Sort order">
            <span className="admin-sort-label">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`admin-sort-btn ${sortMode === s.key ? 'active' : ''}`}
                onClick={() => setSortMode(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <section className="admin-workspace">
          <aside className="admin-queue" aria-label="Outreach queue">
            <div className="admin-section-head"><span>Queue</span><strong>{visibleDrafts.length}</strong></div>
            {visibleDrafts.length === 0 && <div className="admin-empty">No drafts here.</div>}

            {visibleDrafts.map((draft, i) => (
              <button
                key={draft.id}
                type="button"
                className={`admin-queue-card ${selected?.id === draft.id ? 'active' : ''}`}
                onClick={() => setSelectedId(draft.id)}
              >
                <span className={`admin-status-line tone-${toneFor(draft.status)}`} />
                <span className="admin-queue-index">{i + 1}</span>
                <span className="admin-queue-main">
                  <span className="admin-queue-title">{draft.languageName}</span>
                  <span className="admin-queue-org">{draft.institutionName}</span>
                </span>
                <span className={`admin-queue-tier tier-${draft.tier}`}>{draft.tier}</span>
              </button>
            ))}
          </aside>

          <section className="admin-detail" aria-label="Selected outreach draft">
            {!selected && <div className="admin-empty large">Select a draft to preview it.</div>}
            {selected && (
              <article className="admin-panel-sheet">
                <div className="admin-detail-head"><h2>{selected.languageName}</h2></div>
                <div className="admin-field-grid">
                  <div className="admin-field wide">
                    <span>Institution</span><a href={safeUrl(selected.institutionUrl)} target="_blank" rel="noreferrer">{selected.institutionName}</a>
                  </div>
                  {!isReview && (
                    <div className="admin-field">
                      <span>Contact</span>
                      <strong>{selected.institutionEmail ?? '—'}</strong>
                    </div>
                  )}
                  <div className="admin-field"><span>Status</span><strong>{STATUS_LABEL[selected.status]}</strong></div>
                  <div className="admin-field"><span>Created</span><strong>{formatDate(selected.createdAt)}</strong></div>
                </div>
                {isReview ? (
                  <div className="admin-edit-form">
                    <label className="admin-edit-field" style={{ animationDelay: '40ms' }}>
                      <span className="admin-edit-label">Recipient</span>
                      <input
                        className="admin-edit-input"
                        type="email"
                        value={editFields.institutionEmail}
                        placeholder="recipient@example.org"
                        onChange={(e) => setEditFields((f) => ({ ...f, institutionEmail: e.target.value }))}
                      />
                      <small className="admin-edit-hint">The email is delivered to this address.</small>
                    </label>
                    <label className="admin-edit-field" style={{ animationDelay: '90ms' }}>
                      <span className="admin-edit-label">Subject</span>
                      <input
                        className="admin-edit-input"
                        value={editFields.subject}
                        onChange={(e) => setEditFields((f) => ({ ...f, subject: e.target.value }))}
                      />
                    </label>
                    <label className="admin-edit-field" style={{ animationDelay: '140ms' }}>
                      <span className="admin-edit-label">
                        Body
                        <span className="admin-edit-count">{editFields.body.length} chars</span>
                      </span>
                      <textarea
                        className="admin-edit-textarea"
                        value={editFields.body}
                        rows={12}
                        onChange={(e) => setEditFields((f) => ({ ...f, body: e.target.value }))}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="admin-message-card">
                    <span>Subject</span>
                    <h3>{selected.subject}</h3>
                    <pre>{selected.body}</pre>
                  </div>
                )}
                <div className="admin-check-row"><span>Admin check</span><p>{selected.ask}</p></div>
                <div className="admin-actions-row">
                  {isReview && (
                    <>
                      <button className="admin-action primary" type="button" disabled={busy} onClick={sendNow}>{busy ? 'Sending…' : 'Send'}</button>
                      <button className="admin-action" type="button" disabled={busy} onClick={() => act(selected.id, rejectDraft)}>Reject</button>
                    </>
                  )}
                  {selected.status === 'sent' && (
                    <>
                      <button className="admin-action primary" type="button" disabled={busy} onClick={() => act(selected.id, markReplied)}>Mark replied</button>
                      <button className="admin-action" type="button" disabled={busy || !selected.canEscalate} onClick={() => act(selected.id, escalateDraft)}>Escalate</button>
                    </>
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
