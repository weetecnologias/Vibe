import { useState } from 'react';

import {
  Badge, DownloadButton, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth,
  type SocialHostRow, type SocialMeetupDetail, type SocialMeetupPage, type SocialMemberRow, type SocialOverview, type SocialPerson, type SocialReportRow,
} from '@kit';

type Tab = 'overview' | 'meetups' | 'reports' | 'hosts' | 'members';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'meetups', label: 'One-on-ones' }, { key: 'reports', label: 'Reports' }, { key: 'hosts', label: 'Hosts' }, { key: 'members', label: 'Members' },
];
const MEETUP_STATUS: { key: string; label: string; tone: 'muted' | 'success' | 'warning' | 'pink' }[] = [
  { key: 'draft', label: 'Not paid yet', tone: 'muted' },
  { key: 'open', label: 'Live, waiting', tone: 'pink' },
  { key: 'awaiting_payment', label: 'Guest paying', tone: 'warning' },
  { key: 'matched', label: 'Booked', tone: 'success' },
  { key: 'completed', label: 'Done', tone: 'muted' },
  { key: 'cancelled', label: 'Cancelled', tone: 'muted' },
  { key: 'expired', label: 'Nobody joined', tone: 'muted' },
];
const statusOf = (s: string) => MEETUP_STATUS.find((x) => x.key === s) ?? { key: s, label: s, tone: 'muted' as const };
const PAGE = 50;

function Who({ p }: { p: SocialPerson | null }) {
  if (!p) return <span className="muted">—</span>;
  return <><strong>{p.name}</strong>{p.vibeId ? <div className="muted small">VIBE ID {p.vibeId}</div> : null}</>;
}

function Pay({ reference, status }: { reference: string | null; status: string | null }) {
  if (!reference) return <span className="muted small">—</span>;
  return <><code className="small">{reference}</code><div className="muted small">{status ?? 'not paid'}</div></>;
}

/**
 * VIBE Social: every one-on-one plan, who made it, who joined, the payments behind it, reports, host checks and member suspensions.
 * Privacy: staff see first name with initial and VIBE ID, never full phone numbers; a chat opens only when there's a report or it was closed for sharing contact details, and opening it is audited.
 */
export function SocialPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <PageHead title="VIBE Social" sub="One-on-one plans, the table reservations behind them, safety reports and host checks. Social is VIBE-wide." />
      <div className="tabs" role="tablist" aria-label="Social">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {tab === 'overview' ? <Overview go={setTab} /> : tab === 'meetups' ? <Meetups /> : tab === 'reports' ? <Reports /> : tab === 'hosts' ? <Hosts /> : <Members />}
    </>
  );
}

function Overview({ go }: { go: (t: Tab) => void }) {
  const { client } = useAuth();
  const o = useAsync(() => client.get<SocialOverview>('/v1/admin/social/overview'), [client]);
  if (o.error) return <Notice tone="error">{o.error}</Notice>;
  if (!o.data) return <Loading />;
  const d = o.data;
  const card = (label: string, value: string, sub: string, to?: Tab) => (
    <button type="button" className="card" style={{ textAlign: 'left', font: 'inherit', cursor: to ? 'pointer' : 'default' }} onClick={to ? () => go(to) : undefined}>
      <span className="muted small">{label}</span><strong>{value}</strong><span className="muted small">{sub}</span>
    </button>
  );
  return (
    <div className="stack">
      {d.reportsOpen > 0 ? <Notice tone="error">{d.reportsOpen} open safety report{d.reportsOpen === 1 ? '' : 's'} to review.</Notice> : null}
      {d.hostsPending > 0 ? <Notice tone="info">{d.hostsPending} host application{d.hostsPending === 1 ? '' : 's'} waiting for a check.</Notice> : null}
      <div className="kpis">
        {card('Members with a Social profile', d.members.toLocaleString('en-IN'), `${d.suspended} suspended`, 'members')}
        {card('Verified hosts', String(d.hostsApproved), `${d.hostsPending} waiting for a check`, 'hosts')}
        {card('Upcoming booked plans', String(d.upcomingBooked), 'Table or slot booked for two', 'meetups')}
        {card('Open reports', String(d.reportsOpen), `${d.contactShared} chats closed for sharing contacts`, 'reports')}
        {card('Deposits collected', formatINR(d.depositsCollected), `${formatINR(d.depositsRefunded)} refunded`)}
        {card('Venues taking plans', String(d.venuesTakingMeetups), 'KYC verified, reservations on')}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Plans by status</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {MEETUP_STATUS.map((s) => <Badge key={s.key} tone={s.tone}>{s.label}: {d.meetups[s.key] ?? 0}</Badge>)}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Rules: a plan goes live once its deposit is paid; the table is booked when someone joins; nobody joins by 3 hours before and it expires with a refund;
          free cancellation until 3 hours before; the table is held 30 minutes past the start; the venue keeps the deposit on a no-show.
        </p>
      </div>
    </div>
  );
}

function Meetups() {
  const { client } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const qs = `${status ? `&status=${status}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
  const page = useAsync(() => client.get<SocialMeetupPage>(`/v1/admin/social/meetups?limit=${PAGE}&offset=${offset}${qs}`), [client, qs, offset]);
  const total = page.data?.total ?? 0;
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); setOffset(0); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="VIBE ID, VBM- booking or VB- payment" aria-label="Search" style={{ minWidth: 280 }} />
          <button className="btn" type="submit">Search</button>
        </form>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} aria-label="Status">
          <option value="">All statuses</option>
          {MEETUP_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <DownloadButton path={`/v1/admin/social/meetups.csv?x=1${qs}`} filename="vibe-social-one-on-ones.csv" label="Download Excel" small />
      </div>
      {page.error ? <Notice tone="error">{page.error}</Notice> : null}
      {page.loading && !page.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Plan</th><th>When and where</th><th>Created by</th><th>Joined by</th><th>Deposit</th><th>Payments</th><th>Status</th></tr></thead>
            <tbody>
              {page.data?.rows.map((m) => {
                const s = statusOf(m.status);
                return (
                  <tr key={m.id} onClick={() => setOpen(m.id)} style={{ cursor: 'pointer' }}>
                    <td><strong>{m.reference}</strong><div className="muted small">{m.activity}</div><div className="muted small">created {showDateTime(m.createdAt)}</div></td>
                    <td className="small">{showDateTime(m.startsAt)}<div className="muted small">{m.venue}, {m.area}</div></td>
                    <td><Who p={m.host} /></td>
                    <td>{m.partner ? <Who p={m.partner} /> : <span className="muted small">{m.requests} request{m.requests === 1 ? '' : 's'}</span>}</td>
                    <td className="small">{formatINR(m.deposit)}<div className="muted small">{m.payMode === 'split' ? 'split 50/50' : 'creator pays'}</div></td>
                    <td><Pay reference={m.hostPayment} status={m.hostPaymentStatus} />{m.partnerPayment ? <div style={{ marginTop: 4 }}><Pay reference={m.partnerPayment} status={m.partnerPaymentStatus} /></div> : null}</td>
                    <td><Badge tone={s.tone}>{s.label}</Badge>{m.reports ? <div style={{ marginTop: 4 }}><Badge tone="warning">{m.reports} report{m.reports === 1 ? '' : 's'}</Badge></div> : null}</td>
                  </tr>
                );
              })}
              {page.data && page.data.rows.length === 0 ? <tr><td colSpan={7} className="muted">No plans match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span className="muted small">{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <button className="btn ghost sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      ) : null}
      {open ? <MeetupModal id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function MeetupModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { client } = useAuth();
  const d = useAsync(() => client.get<SocialMeetupDetail>(`/v1/admin/social/meetups/${id}`), [client, id]);
  const m = d.data?.meetup;
  return (
    <Modal title={m ? `${m.reference} · ${m.activity}` : 'Plan'} onClose={onClose} wide>
      {d.error ? <Notice tone="error">{d.error}</Notice> : !d.data || !m ? <Loading /> : (
        <div className="stack">
          <div className="grid2">
            <div><div className="muted small">Created by</div><Who p={m.host} /></div>
            <div><div className="muted small">Joined by</div><Who p={m.partner} /></div>
            <div><div className="muted small">When and where</div>{showDateTime(m.startsAt)} · {m.venue}, {m.area}</div>
            <div><div className="muted small">Status</div><Badge tone={statusOf(m.status).tone}>{statusOf(m.status).label}</Badge> <span className="muted small">table {m.reservationStatus}</span></div>
            <div><div className="muted small">Deposit</div>{formatINR(m.deposit)} · {m.payMode === 'split' ? 'split 50/50' : 'creator pays'}</div>
            <div><div className="muted small">Payments</div><Pay reference={m.hostPayment} status={m.hostPaymentStatus} />{m.partnerPayment ? <Pay reference={m.partnerPayment} status={m.partnerPaymentStatus} /> : null}</div>
          </div>
          {m.cancelReason ? <Notice tone="info">{m.cancelledBy ? `Cancelled by ${m.cancelledBy}: ` : ''}{m.cancelReason}</Notice> : null}
          <div>
            <h3>Requests to join</h3>
            {d.data.requests.length === 0 ? <div className="muted small">None.</div> : (
              <table><tbody>{d.data.requests.map((r, n) => <tr key={n}><td><Who p={r.person} /></td><td className="small">{r.status}</td><td className="small muted">{showDateTime(r.at)}</td></tr>)}</tbody></table>
            )}
          </div>
          <div>
            <h3>Chat</h3>
            {d.data.chat ? (
              <div className="stack" style={{ gap: 6 }}>
                <Notice tone="info">Opened because of a report or a safety close. This view is recorded in the audit log.</Notice>
                {d.data.chat.map((c, n) => <div key={n} className="small"><strong>{c.from}</strong> <span className="muted">{showDateTime(c.at)}</span><div>{c.text}</div></div>)}
              </div>
            ) : <div className="muted small">{d.data.chatNote ?? 'Private.'}</div>}
          </div>
          {d.data.reports.length ? (
            <div>
              <h3>Reports</h3>
              {d.data.reports.map((r) => <div key={r.id} className="small"><Badge tone={r.status === 'open' ? 'warning' : 'muted'}>{r.status}</Badge> {r.reason}{r.note ? ` · ${r.note}` : ''} <span className="muted">by {r.reporter.name}</span></div>)}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Reports() {
  const { client } = useAuth();
  const [status, setStatus] = useState('open');
  const list = useAsync(() => client.get<SocialReportRow[]>(`/v1/admin/social/reports${status ? `?status=${status}` : ''}`), [client, status]);
  const [handling, setHandling] = useState<SocialReportRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        {[['open', 'Open'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed'], ['', 'All']].map(([k, l]) => (
          <button key={k} className={`btn sm${status === k ? ' primary' : ' ghost'}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>From</th><th>About</th><th>Reason</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((r) => (
                <tr key={r.id}>
                  <td className="small">{showDateTime(r.createdAt)}</td>
                  <td><Who p={r.reporter} /></td>
                  <td className="small">{r.targetType === 'user' ? 'Member' : 'Plan'}: {r.target ?? r.targetId}</td>
                  <td className="small"><strong>{r.reason.replace(/_/g, ' ')}</strong>{r.note ? <div className="muted small">{r.note}</div> : null}</td>
                  <td><Badge tone={r.status === 'open' ? 'warning' : 'muted'}>{r.status}</Badge>{r.resolution ? <div className="muted small">{r.resolution}</div> : null}</td>
                  <td>{r.status === 'open' ? <button className="btn sm" onClick={() => setHandling(r)}>Handle</button> : null}</td>
                </tr>
              ))}
              {list.data && list.data.length === 0 ? <tr><td colSpan={6} className="muted">No reports here.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {handling ? <ResolveModal r={handling} onClose={() => setHandling(null)} onDone={(t) => { setHandling(null); setNotice(t); list.reload(); }} /> : null}
    </div>
  );
}

function ResolveModal({ r, onClose, onDone }: { r: SocialReportRow; onClose: () => void; onDone: (t: string) => void }) {
  const { client } = useAuth();
  const [note, setNote] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (action: 'dismiss' | 'action') => {
    if (!note.trim()) return setError('Say what you decided.');
    setBusy(true);
    setError(null);
    try {
      await client.post(`/v1/admin/social/reports/${r.id}/resolve`, { action, note: note.trim(), suspendCustomerId: action === 'action' && suspend ? r.targetCustomerId : null });
      onDone(action === 'dismiss' ? 'Report dismissed.' : suspend ? 'Report actioned and the member suspended.' : 'Report actioned.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Handle report" onClose={onClose}>
      <div className="stack">
        <div className="small"><strong>{r.reason.replace(/_/g, ' ')}</strong> · {r.target ?? r.targetId}{r.note ? <div className="muted">“{r.note}”</div> : null}</div>
        <Field label="What you decided" hint="Recorded in the audit log."><textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {r.targetCustomerId ? <label className="check"><input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} /> Suspend this member from Social</label> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot">
          <button className="btn ghost" disabled={busy} onClick={() => send('dismiss')}>Dismiss</button>
          <button className="btn primary" disabled={busy} onClick={() => send('action')}>Take action</button>
        </div>
      </div>
    </Modal>
  );
}

const ID_LABEL: Record<string, string> = { aadhaar: 'Aadhaar', pan: 'PAN', passport: 'Passport', driving_licence: 'Driving licence', voter_id: 'Voter ID' };

function Hosts() {
  const { client } = useAuth();
  const [status, setStatus] = useState('pending');
  const list = useAsync(() => client.get<SocialHostRow[]>(`/v1/admin/social/hosts${status ? `?status=${status}` : ''}`), [client, status]);
  const [deciding, setDeciding] = useState<SocialHostRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="stack">
      <Notice tone="info">Hosts need a Social profile, VIBE Membership, 18+ and their ID details. Check the name and date of birth against the ID before approving. Only the last 4 characters of the ID are stored.</Notice>
      <div className="row" style={{ gap: 8 }}>
        {[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['revoked', 'Revoked'], ['', 'All']].map(([k, l]) => (
          <button key={k} className={`btn sm${status === k ? ' primary' : ' ghost'}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Member</th><th>Legal name</th><th>ID</th><th>Born</th><th>Membership</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((h) => (
                <tr key={h.customerId}>
                  <td><Who p={h.person} /><div className="muted small">{h.phoneMasked}</div></td>
                  <td className="small">{h.legalName}<div className="muted small">{h.city ?? ''}</div></td>
                  <td className="small">{ID_LABEL[h.idType] ?? h.idType} ····{h.idLast4}</td>
                  <td className="small">{h.dateOfBirth}</td>
                  <td>{h.member ? <Badge tone="success">Member</Badge> : <Badge tone="warning">Not a member</Badge>}</td>
                  <td><Badge tone={h.status === 'approved' ? 'success' : h.status === 'pending' ? 'pink' : 'muted'}>{h.status}</Badge>{h.reviewNote ? <div className="muted small">{h.reviewNote}</div> : null}</td>
                  <td><button className="btn sm" onClick={() => setDeciding(h)}>{h.status === 'pending' ? 'Review' : 'Change'}</button></td>
                </tr>
              ))}
              {list.data && list.data.length === 0 ? <tr><td colSpan={7} className="muted">Nobody here.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {deciding ? <DecideModal h={deciding} onClose={() => setDeciding(null)} onDone={(t) => { setDeciding(null); setNotice(t); list.reload(); }} /> : null}
    </div>
  );
}

function DecideModal({ h, onClose, onDone }: { h: SocialHostRow; onClose: () => void; onDone: (t: string) => void }) {
  const { client } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'reject' | 'revoke') => {
    if (decision !== 'approve' && !note.trim()) return setError('Tell the member why, so they can fix it.');
    setBusy(true);
    setError(null);
    try {
      await client.post(`/v1/admin/social/hosts/${h.customerId}/decide`, { decision, note: note.trim() || null });
      onDone(decision === 'approve' ? `${h.person.name} is now a verified host.` : decision === 'reject' ? 'Application rejected.' : 'Hosting revoked.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Host check · ${h.person.name}`} onClose={onClose}>
      <div className="stack">
        <div className="grid2 small">
          <div><div className="muted">Legal name</div>{h.legalName}</div>
          <div><div className="muted">Date of birth</div>{h.dateOfBirth}</div>
          <div><div className="muted">ID</div>{ID_LABEL[h.idType] ?? h.idType} ending {h.idLast4}</div>
          <div><div className="muted">VIBE Membership</div>{h.member ? 'Active' : 'Not active'}</div>
        </div>
        {h.about ? <div className="small muted">“{h.about}”</div> : null}
        <Field label="Note to the member" hint="Required to reject or revoke. Recorded in the audit log."><textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot">
          {h.status === 'approved' ? <button className="btn ghost danger" disabled={busy} onClick={() => decide('revoke')}>Revoke hosting</button> : (
            <>
              <button className="btn ghost" disabled={busy} onClick={() => decide('reject')}>Reject</button>
              <button className="btn primary" disabled={busy || !h.member} onClick={() => decide('approve')} title={h.member ? undefined : 'Needs VIBE Membership'}>Approve</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Members() {
  const { client } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const list = useAsync(() => client.get<SocialMemberRow[]>(`/v1/admin/social/members?x=1${status ? `&status=${status}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [client, status, term]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (m: SocialMemberRow) => {
    const suspend = m.status !== 'suspended';
    const reason = suspend ? window.prompt(`Why suspend ${m.person.name}? This is recorded.`)?.trim() : 'Suspension lifted';
    if (suspend && !reason) return;
    setBusy(m.customerId);
    setError(null);
    try {
      await client.post(`/v1/admin/social/members/${m.customerId}/suspension`, { suspend, reason });
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or VIBE ID" aria-label="Search members" />
          <button className="btn" type="submit">Search</button>
        </form>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Everyone</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </select>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Member</th><th>Profile</th><th>Plans made</th><th>Joined</th><th>Reports against</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((m) => (
                <tr key={m.customerId}>
                  <td><Who p={m.person} />{m.host ? <div style={{ marginTop: 4 }}><Badge tone="pink">Host</Badge></div> : null}</td>
                  <td className="small">{m.gender}{m.ageBand ? ` · ${m.ageBand}` : ''}<div className="muted small">since {showDateTime(m.joinedSocial)}</div></td>
                  <td className="small">{m.hosted}</td>
                  <td className="small">{m.joined}</td>
                  <td>{m.reportsAgainst ? <Badge tone="warning">{m.reportsAgainst}</Badge> : <span className="muted small">0</span>}</td>
                  <td><Badge tone={m.status === 'suspended' ? 'warning' : 'success'}>{m.status}</Badge>{m.suspendedReason ? <div className="muted small">{m.suspendedReason}</div> : null}</td>
                  <td><button className={`btn sm${m.status === 'suspended' ? '' : ' ghost danger'}`} disabled={busy === m.customerId} onClick={() => toggle(m)}>{m.status === 'suspended' ? 'Lift suspension' : 'Suspend'}</button></td>
                </tr>
              ))}
              {list.data && list.data.length === 0 ? <tr><td colSpan={7} className="muted">No members match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
