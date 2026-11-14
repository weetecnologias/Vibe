import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Badge, DownloadButton, Loading, Notice, PageHead, bpsToPercent, formatINR, showDateTime, useAsync, useAuth, type MerchantPayments, type MerchantProfile } from '@kit';

import { useAccess } from '../access';
import { KycReview } from './KycPage';
import { AgreementBadge, KycBadge } from './MerchantsPage';
import { SettlementModal } from './SettlementsPage';

type Tab = 'overview' | 'payments' | 'settlements' | 'kyc' | 'agreement';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'payments', label: 'Payments received' }, { key: 'settlements', label: 'Settlements' }, { key: 'kyc', label: 'KYC and bank' }, { key: 'agreement', label: 'Agreement' },
];

/**
 * Everything about one business in one place: where it came from (its application), its KYC and bank details (checked and verified here),
 * the merchant agreement it accepted, what VIBE owes it and its settlements. The listing itself (name, photos, hours) is edited on its own page.
 */
export function MerchantProfilePage() {
  const { id = '' } = useParams();
  const { client } = useAuth();
  const me = useAccess();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const p = useAsync(() => client.get<MerchantProfile>(`/v1/admin/merchants/${id}`), [client, id]);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const d = p.data;
  const m = d?.merchant;

  return (
    <>
      <p className="small" style={{ margin: '0 0 8px' }}><Link to="/merchants">← Merchants</Link></p>
      {p.error && !d ? <Notice tone="error">{p.error}</Notice> : !d || !m ? <Loading /> : (
        <>
          <PageHead
            title={m.name}
            sub={`${d.categoryPath} · ${m.area}`}
            actions={<>{m.live ? <Badge tone="success">Live in the app</Badge> : <Badge>Hidden</Badge>}<Link className="btn" to={`/businesses/${m.id}`} style={{ textDecoration: 'none' }}>Edit listing and logins</Link></>}
          />
          <div className="strip" style={{ marginBottom: 14 }}>
            <div className="card"><span className="muted small">Application</span>{d.application ? <span><Badge tone={d.application.status === 'approved' ? 'success' : 'warning'}>{d.application.status === 'approved' ? 'Approved' : d.application.status.replace('_', ' ')}</Badge> <span className="muted small">{showDateTime(d.application.decidedAt ?? d.application.submittedAt)}</span></span> : <span className="small">Added by VIBE</span>}</div>
            <div className="card"><span className="muted small">KYC and bank</span><span><KycBadge status={d.kyc.status} /></span></div>
            <div className="card"><span className="muted small">Merchant agreement</span><span><AgreementBadge m={m} /></span></div>
            <div className="card"><span className="muted small">VIBE owes them</span><strong style={{ fontSize: 18 }}>{formatINR(m.owed)}</strong></div>
          </div>
          <div className="tabs" role="tablist">
            {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => { setParams(t.key === 'overview' ? {} : { tab: t.key }); setNotice(null); }}>{t.label}</button>)}
          </div>
          {notice ? <Notice tone="success">{notice}</Notice> : null}

          {tab === 'overview' ? (
            <div className="grid2">
              <div className="card stack" style={{ alignContent: 'start' }}>
                <h2>Money</h2>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Not yet in a settlement</span><strong>{formatINR(d.money.unsettled.payout)} <span className="muted small">({d.money.unsettled.count} payments)</span></strong></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Drawn up, waiting for the bank transfer</span><strong>{formatINR(d.money.awaitingPayout)}</strong></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Paid out so far</span><strong>{formatINR(d.money.paidOut)}</strong></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Sales, last 30 days</span><strong>{formatINR(m.sales30d)}</strong></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Commission now</span><strong>{bpsToPercent(d.money.commissionBps)}%</strong></div>
                {d.kyc.status !== 'verified' && m.owed > 0 ? <Notice tone="info">Payouts are held until their KYC and bank details are verified.</Notice> : null}
                {me.can('money') ? <div className="row"><Link className="btn sm" to="/settlements">Go to settlements</Link></div> : null}
              </div>
              <div className="card stack" style={{ alignContent: 'start' }}>
                <h2>About them</h2>
                {d.application ? (
                  <>
                    <div className="small">Contact: <strong>{d.application.contactName}</strong></div>
                    <div className="small">Email: <a href={`mailto:${d.application.email}`}>{d.application.email}</a> · Phone: {d.application.phone}</div>
                    <div className="small muted">Applied {showDateTime(d.application.submittedAt)}{d.application.decidedAt ? `, decided ${showDateTime(d.application.decidedAt)}` : ''}</div>
                  </>
                ) : <div className="small muted">Added directly by VIBE, not through an application.</div>}
                <div className="small">Joined VIBE {showDateTime(m.joinedAt)} · {d.liveOffers} live offers · {d.teamMembers} people with a login</div>
                <div className="small">Last sale: {m.lastSaleAt ? showDateTime(m.lastSaleAt) : 'none yet'}</div>
              </div>
            </div>
          ) : null}

          {tab === 'kyc' ? (
            d.kyc.status === 'not_submitted'
              ? <Notice tone="info">{m.name} hasn’t sent their KYC and bank details yet. They do it under Bank and KYC in their merchant dashboard. Until then nothing can be paid out.</Notice>
              : <div className="card"><KycReview businessId={m.id} onDone={(msg) => { setNotice(msg); p.reload(); }} /></div>
          ) : null}

          {tab === 'agreement' ? (
            <div className="card stack">
              <p className="small" style={{ margin: 0 }}>{m.currentAgreement === null ? 'No merchant agreement has been published yet.' : `Version in force: v${m.currentAgreement}.`} {me.full ? <Link to="/agreement">Manage versions</Link> : null}</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Version</th><th>Title</th><th>Accepted</th><th>By</th></tr></thead>
                  <tbody>
                    {d.agreements.map((a) => <tr key={a.version + a.acceptedAt}><td>v{a.version}</td><td>{a.title}</td><td className="small">{showDateTime(a.acceptedAt)}</td><td className="small">{a.acceptedBy ?? '—'}</td></tr>)}
                    {d.agreements.length === 0 ? <tr><td colSpan={4} className="muted">Not accepted yet. They’re asked to accept it the next time they sign in.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'payments' ? <PaymentsReceived businessId={m.id} name={m.name} onOpenSettlement={setOpen} canMoney={me.can('money')} /> : null}

          {tab === 'settlements' ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Settlement</th><th>Period</th><th>Payments</th><th>Payout</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {d.money.settlements.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.reference}</strong><div className="muted small">{showDateTime(s.createdAt)}</div></td>
                      <td className="small">{showDateTime(s.periodFrom)} to {showDateTime(s.periodTo)}</td>
                      <td>{s.paymentCount}</td>
                      <td><strong>{formatINR(s.payout)}</strong></td>
                      <td>{s.status === 'paid' ? <><Badge tone="success">Paid</Badge><div className="muted small">{s.payoutRef}</div></> : <Badge tone="warning">To transfer</Badge>}</td>
                      <td className="actions">{me.can('money') ? <button className="btn ghost sm" onClick={() => setOpen(s.id)}>Open</button> : null}</td>
                    </tr>
                  ))}
                  {d.money.settlements.length === 0 ? <tr><td colSpan={6} className="muted">No settlements yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
          {open ? <SettlementModal id={open} onClose={() => setOpen(null)} onPaid={(x) => { setNotice(`${x.summary.reference} marked as paid.`); p.reload(); }} /> : null}
        </>
      )}
    </>
  );
}

const KIND: Record<string, string> = { redemption: 'Bill', tickets: 'Event tickets', movie: 'Movie tickets', slots: 'Booking', pass: 'Membership' };
type Settled = '' | 'no' | 'pending' | 'paid';
const SETTLED: { key: Settled; label: string }[] = [{ key: '', label: 'All' }, { key: 'no', label: 'Not settled yet' }, { key: 'pending', label: 'Waiting for bank transfer' }, { key: 'paid', label: 'Paid out' }];
const PAGE = 50;

/** Every payment the business received through VIBE, its share of each, and whether that share has been settled and paid. */
function PaymentsReceived({ businessId, name, onOpenSettlement, canMoney }: { businessId: string; name: string; onOpenSettlement: (id: string) => void; canMoney: boolean }) {
  const { client } = useAuth();
  const [settled, setSettled] = useState<Settled>('');
  const [offset, setOffset] = useState(0);
  const p = useAsync(() => client.get<MerchantPayments>(`/v1/admin/merchants/${businessId}/payments?limit=${PAGE}&offset=${offset}${settled ? `&settled=${settled}` : ''}`), [client, businessId, settled, offset]);
  const d = p.data;
  const total = d?.total ?? 0;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small">{d ? (d.notSettled ? <>{d.notSettled} payments not settled yet: <strong>{formatINR(d.notSettledAmount)}</strong> owed to {name}.</> : 'Every payment is in a settlement.') : ''}</span>
        <DownloadButton small path={`/v1/admin/merchants/${businessId}/payments.csv${settled ? `?settled=${settled}` : ''}`} filename={`vibe-payments-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`} label="Download Excel" />
      </div>
      <div className="tabs" role="tablist" aria-label="Settled">
        {SETTLED.map((t) => <button key={t.label} role="tab" aria-selected={settled === t.key} className={`tab${settled === t.key ? ' on' : ''}`} onClick={() => { setSettled(t.key); setOffset(0); }}>{t.label}</button>)}
      </div>
      {p.error ? <Notice tone="error">{p.error}</Notice> : null}
      {p.loading && !d ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Transaction</th><th>Customer</th><th>Paid</th><th>VIBE keeps</th><th>Their share</th><th>Settled?</th></tr></thead>
              <tbody>
                {d?.rows.map((x) => (
                  <tr key={x.reference}>
                    <td><strong>{x.reference}</strong><div className="muted small">{showDateTime(x.paidAt)} · {KIND[x.kind] ?? x.kind}{x.what ? ` · ${x.what}` : ''}</div></td>
                    <td className="small">{x.customerName}<div className="muted">VIBE ID {x.vibeId}</div></td>
                    <td>{formatINR(x.amount)}</td>
                    <td className="small">{formatINR(x.vibeFee + x.commission + x.gst)}{x.refund ? <div className="muted">refund − {formatINR(x.refund)}</div> : null}</td>
                    <td><strong>{formatINR(x.payout)}</strong></td>
                    <td>
                      {x.refundedInFull ? <Badge>Refunded in full</Badge>
                        : x.settlementStatus === 'paid' ? <><Badge tone="success">Paid out</Badge><div className="muted small">{x.settlementPaidAt ? showDateTime(x.settlementPaidAt) : ""} · {x.payoutRef}</div></>
                        : x.settlementStatus === 'pending' ? <Badge tone="warning">Waiting for bank transfer</Badge>
                        : <Badge>Not settled yet</Badge>}
                      {x.settlementId && canMoney ? <div><button type="button" className="link-btn small" onClick={() => onOpenSettlement(x.settlementId!)}>{x.settlementRef}</button></div> : null}
                    </td>
                  </tr>
                ))}
                {d && d.rows.length === 0 ? <tr><td colSpan={6} className="muted">No payments here.</td></tr> : null}
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
    </div>
  );
}
