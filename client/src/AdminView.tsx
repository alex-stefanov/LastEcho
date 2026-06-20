import { useEffect, useState } from 'react';
import {
  approveDraft,
  escalateDraft,
  fetchOutreachQueue,
  markReplied,
  markSent,
  rejectDraft,
  runTriage,
  type DraftStatus,
  type OutreachDraft,
  type OutreachTier,
} from './data/api';

const TABS: { key: DraftStatus; label: string }[] = [
  { key: 'pending_review', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'replied', label: 'Replied' },
  { key: 'rejected', label: 'Rejected' },
];

const TIER_LABEL: Record<OutreachTier, string> = {
  local: 'Local',
  continental: 'Continental',
  global: 'Global',
};

function mailtoFor(d: OutreachDraft): string {
  const params = new URLSearchParams({ subject: d.subject, body: d.body });
  return `mailto:${d.institutionEmail}?${params.toString()}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function AdminView() {
  const [tab, setTab] = useState<DraftStatus>('pending_review');
  const [queue, setQueue] = useState<OutreachDraft[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [stamp, setStamp] = useState<{ id: number; kind: 'approved' | 'rejected' } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [escalateNote, setEscalateNote] = useState<string | null>(null);

  const load = (status: DraftStatus) => {
    setLoading(true);
    setError(null);
    fetchOutreachQueue(status)
      .then((items) => {
        setQueue(items);
        setSelectedId(items[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(tab);
    setCopied(false);
    setEscalateNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selected = queue.find((d) => d.id === selectedId) ?? null;

  const decide = (id: number, action: 'approve' | 'reject') => {
    setBusyId(id);
    const fn = action === 'approve' ? approveDraft : rejectDraft;
    fn(id)
      .then(() => {
        setStamp({ id, kind: action === 'approve' ? 'approved' : 'rejected' });
        setTimeout(() => {
          setQueue((q) => q.filter((d) => d.id !== id));
          setSelectedId((cur) => (cur === id ? null : cur));
          setStamp(null);
        }, 620);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusyId(null));
  };

  const sweep = () => {
    setSweeping(true);
    setSweepNote(null);
    runTriage()
      .then((r) => {
        setSweepNote(`Drafted ${r.drafted}, skipped ${r.skipped} (already handled).`);
        load(tab);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSweeping(false));
  };

  const copyDraft = () => {
    if (!selected) return;
    navigator.clipboard.writeText(`${selected.subject}\n\n${selected.body}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const doMarkSent = (id: number) => {
    setBusyId(id);
    markSent(id)
      .then(() => setQueue((q) => q.filter((d) => d.id !== id)))
      .catch((e) => setError(String(e)))
      .finally(() => setBusyId(null));
  };

  const doMarkReplied = (id: number) => {
    setBusyId(id);
    markReplied(id)
      .then(() => setQueue((q) => q.filter((d) => d.id !== id)))
      .catch((e) => setError(String(e)))
      .finally(() => setBusyId(null));
  };

  const doEscalate = (id: number) => {
    setBusyId(id);
    escalateDraft(id)
      .then((next) => {
        setEscalateNote(
          next
            ? `No reply recorded. Next rung drafted: ${TIER_LABEL[next.tier]} — ${next.institutionName} (see Pending).`
            : 'No reply recorded. This was already the last rung (Global) — nothing further to escalate to.',
        );
        setQueue((q) => q.filter((d) => d.id !== id));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusyId(null));
  };

  return (
    <div className="admin">
      <header className="admin-head">
        <div className="admin-mark">
          <span className="admin-eyebrow">LastEcho</span>
          <h1>Dispatch Desk</h1>
        </div>
        <div className="admin-actions">
          {sweepNote && <span className="admin-sweep-note">{sweepNote}</span>}
          <button className={`admin-sweep ${sweeping ? 'running' : ''}`} onClick={sweep} disabled={sweeping}>
            {sweeping ? 'Sweeping…' : 'Run sweep'}
          </button>
        </div>
      </header>

      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`admin-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <div className="admin-error">{error}</div>}
      {escalateNote && <div className="admin-note">{escalateNote}</div>}

      <div className="admin-body">
        <ul className="admin-index">
          {loading && <li className="admin-index-empty">Loading…</li>}
          {!loading && queue.length === 0 && (
            <li className="admin-index-empty">Nothing in {TABS.find((t) => t.key === tab)?.label.toLowerCase()}.</li>
          )}
          {queue.map((d) => (
            <li key={d.id}>
              <button
                className={`admin-card ${selectedId === d.id ? 'active' : ''} ${stamp?.id === d.id ? `stamped-${stamp.kind}` : ''}`}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="admin-card-to">
                  {d.institutionName} <span className="admin-card-tier">{TIER_LABEL[d.tier]}</span>
                </span>
                <span className="admin-card-re">Re: {d.languageName}</span>
                <span className="admin-card-subject">{d.subject}</span>
                {d.status === 'sent' && d.sentAt && (
                  <span className="admin-card-sent">Sent {daysSince(d.sentAt)}d ago</span>
                )}
                {stamp?.id === d.id && (
                  <span className={`admin-stamp ${stamp.kind}`}>{stamp.kind === 'approved' ? 'APPROVED' : 'DECLINED'}</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <section className="admin-memo">
          {!selected && <div className="admin-memo-empty">Select an item from the index to read the full draft.</div>}
          {selected && (
            <article className="admin-sheet">
              <div className="admin-sheet-row">
                <span className="admin-sheet-label">To</span>
                <a href={selected.institutionUrl} target="_blank" rel="noreferrer">
                  {selected.institutionName}
                </a>
                <span className="admin-sheet-tier">{TIER_LABEL[selected.tier]} rung</span>
              </div>
              <div className="admin-sheet-row">
                <span className="admin-sheet-label">Re</span>
                <span>{selected.languageName}</span>
              </div>
              <div className="admin-sheet-row">
                <span className="admin-sheet-label">Subject</span>
                <span className="admin-sheet-subject">{selected.subject}</span>
              </div>
              <p className="admin-sheet-body">{selected.body}</p>
              <p className="admin-sheet-ask">{selected.ask}</p>

              {tab === 'pending_review' && (
                <div className="admin-stamp-row">
                  <button
                    className="admin-stamp-btn approve"
                    disabled={busyId === selected.id}
                    onClick={() => decide(selected.id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    className="admin-stamp-btn reject"
                    disabled={busyId === selected.id}
                    onClick={() => decide(selected.id, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              )}

              {tab === 'approved' && (
                <div className="admin-send">
                  {selected.institutionEmail ? (
                    <a className="admin-send-btn mail" href={mailtoFor(selected)}>
                      Open in email →
                    </a>
                  ) : (
                    <>
                      <a className="admin-send-btn contact" href={selected.institutionContactUrl} target="_blank" rel="noreferrer">
                        Open contact page ↗
                      </a>
                      <button className="admin-copy-btn" onClick={copyDraft}>
                        {copied ? 'Copied' : 'Copy draft text'}
                      </button>
                    </>
                  )}
                  <button
                    className="admin-copy-btn"
                    disabled={busyId === selected.id}
                    onClick={() => doMarkSent(selected.id)}
                  >
                    Mark as sent
                  </button>
                </div>
              )}

              {tab === 'sent' && (
                <div className="admin-send">
                  <button
                    className="admin-stamp-btn approve"
                    disabled={busyId === selected.id}
                    onClick={() => doMarkReplied(selected.id)}
                  >
                    Replied
                  </button>
                  <button
                    className="admin-stamp-btn reject"
                    disabled={busyId === selected.id || !selected.canEscalate}
                    onClick={() => doEscalate(selected.id)}
                    title={selected.canEscalate ? '' : 'Wait at least 7 days from send before escalating'}
                  >
                    {selected.canEscalate ? 'No reply — escalate' : 'Too soon to escalate'}
                  </button>
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
