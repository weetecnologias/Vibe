import { useState } from 'react';

import {
  Badge, DownloadButton, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth,
  type CustomerDetail, type CustomerPage, type Plan,
} from '@kit';

const PAGE = 25;

export function CustomersPage() {
  const { client } = useAuth();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const list = useAsync(() => client.get<CustomerPage>(`/v1/admin/customers?limit=${PAGE}&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [client, term, offset]);
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHead title="Customers" sub="Everyone who has signed in to the VIBE app. Phone numbers are hidden; revealing one is logged."
        actions={<DownloadButton path="/v1/admin/exports/customers" filename="vibe-customers.csv" />} />
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()); }}>
        <input style={{ maxWidth: 320 }} placeholder="Name, VIBE ID or phone digits" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        {term ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setOffset(0); }}>Clear</button> : null}
      </form>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>VIBE ID</th><th>Phone</th><th>Joined</th><th>Paid bills</th><th>Total paid</th><th /></tr></thead>
              <tbody>
                {list.data?.items.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong> {c.member ? <Badge tone="pink">Member</Badge> : null}<div className="muted small">{c.area ?? ''}</div></td>
                    <td>{c.vibeId}</td>
                    <td className="small">{c.phoneMasked}</td>
                    <td className="small">{showDateTime(c.joinedAt)}</td>
                    <td>{c.paidRedemptions}</td>
                    <td>{formatINR(c.totalPaid)}</td>
                    <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(c.id)}>Open</button></td>
                  </tr>
                ))}
                {list.data?.items.length === 0 ? <tr><td colSpan={7} className="muted">{term ? 'No customer matches that.' : 'No customers yet.'}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">{total === 0 ? '' : `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`}</span>
            <div className="row">
              <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          </div>
        </>
      )}
      {open ? <CustomerModal id={open} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
    </>
  );
}

function CustomerModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { client } = useAuth();
  const c = useAsync(() => client.get<CustomerDetail>(`/v1/admin/customers/${id}`), [client, id]);
  const plans = useAsync(() => client.get<Plan[]>('/v1/admin/plans'), [client]);
  const [phone, setPhone] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const [plan, setPlan] = useState('');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reveal = async () => {
    setError(null);
    try { setPhone((await client.post<{ phone: string }>(`/v1/admin/customers/${id}/reveal-phone`)).phone); } catch (e) { setError(errorText(e)); }
  };

  const grant = async () => {
    setError(null);
    try {
      await client.post(`/v1/admin/customers/${id}/membership`, { planId: plan, days: parseInt(days, 10), reason: reason.trim() });
      setNotice('Membership time added. It is recorded as granted, with your reason.');
      setGranting(false);
      setReason('');
      c.reload();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const d = c.data;
  const m = d?.membership;

  return (
    <Modal title={d ? `${d.name} · VIBE ID ${d.vibeId}` : 'Customer'} onClose={onClose} wide>
      {c.loading && !d ? <Loading /> : c.error && !d ? <Notice tone="error">{c.error}</Notice> : d && m ? (
        <div className="stack">
          {d.deletionRequested ? <Notice tone="error">This customer has asked for their account to be deleted. See Deletion requests.</Notice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="grid2">
            <div className="card stack">
              <h2>Profile</h2>
              <div>Phone: {phone ?? d.phoneMasked}</div>
              {phone ? <span className="muted small">Shown once and recorded in the audit log.</span> : <div className="row"><button className="btn sm" onClick={reveal}>Show full number</button><span className="muted small">Logged</span></div>}
              <div className="muted small">Area: {d.area ?? '—'} · Joined {showDateTime(d.joinedAt)}</div>
            </div>
            <div className="card stack">
              <h2>Membership</h2>
              {m.status === 'none' ? <span className="muted">Not a member.</span> : (
                <>
                  <div><Badge tone={m.status === 'active' ? 'success' : 'warning'}>{m.status === 'active' ? 'Active' : 'Cancelled, runs to its end date'}</Badge> {m.plan?.name}</div>
                  <div className="muted small">{m.memberNo} · until {m.validUntil ? showDateTime(m.validUntil) : '—'}</div>
                </>
              )}
              <div className="muted small">Saved so far: {formatINR(m.savings.total)} across {m.savings.redemptions} bills at {m.savings.places} places.</div>
              {m.payments.length ? <div className="small">Paid: {m.payments.map((p) => `${formatINR(p.amount)} (${p.planName})`).join(', ')}</div> : null}
              {granting ? (
                <div className="stack">
                  <Field label="Plan"><select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Choose…</option>{plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                  <Field label="Days to add"><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} style={{ maxWidth: 120 }} /></Field>
                  <Field label="Reason" hint="Required. Kept with your name in the audit log."><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill after a failed booking" /></Field>
                  <div className="row"><button className="btn primary sm" disabled={!plan || reason.trim().length < 5 || !/^\d+$/.test(days)} onClick={grant}>Add membership time</button><button className="btn sm" onClick={() => setGranting(false)}>Cancel</button></div>
                </div>
              ) : <div className="row"><button className="btn sm" onClick={() => { setError(null); setGranting(true); }}>Give membership time…</button></div>}
            </div>
          </div>

          <div className="card stack">
            <h2>Recent redemptions</h2>
            <table>
              <tbody>
                {d.redemptions.map((r) => <tr key={r.id}><td><strong>{r.businessName}</strong><div className="muted small">{r.offerTitle}</div></td><td className="small">{showDateTime(r.at)}</td><td>{r.payable === null ? '—' : formatINR(r.payable)}</td><td><Badge tone={r.status === 'paid' ? 'success' : 'muted'}>{r.status.replace('_', ' ')}</Badge></td></tr>)}
                {d.redemptions.length === 0 ? <tr><td className="muted">None yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="card stack">
            <h2>Payments</h2>
            <table>
              <tbody>
                {d.payments.map((p) => <tr key={p.reference}><td><strong>{p.reference}</strong><div className="muted small">{p.payee} · {p.kind}</div></td><td className="small">{showDateTime(p.at)}</td><td>{formatINR(p.amount)}</td><td><Badge tone={p.status === 'verified' ? 'success' : p.status === 'failed' ? 'warning' : 'muted'}>{p.status}</Badge></td></tr>)}
                {d.payments.length === 0 ? <tr><td className="muted">None yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
