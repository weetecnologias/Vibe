import { useState } from 'react';

import { Badge, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type LedgerEntry, type TrialBalance } from '@kit';

const LABEL: Record<string, string> = {
  gateway: 'Held at the payment partner', vibe_fee_income: 'VIBE booking fees', commission_income: 'VIBE commission', gst_payable: 'GST owed on commission', discount_expense: 'Discounts VIBE funded',
  membership_income: 'VIBE Membership sales', vibe_event_income: 'Tickets for VIBE-run events', refunds_payable: 'Refunds owed to customers', refund_expense: 'Refunds VIBE absorbed', adjustments: 'Manual adjustments',
};
const name = (account: string) => (account.startsWith('merchant:') ? 'Owed to a business' : LABEL[account] ?? account);

/**
 * VIBE's books. Every payment, refund, payout and adjustment is posted as lines that add up to nothing, so what VIBE holds, owes and has earned can be
 * proven. The trial balance must always balance; if it ever doesn't, something is wrong and this page says so.
 */
export function LedgerPage() {
  const { client } = useAuth();
  const tb = useAsync(() => client.get<TrialBalance>('/v1/admin/ledger/trial-balance'), [client]);
  const [account, setAccount] = useState('');
  const [ref, setRef] = useState('');
  const [term, setTerm] = useState('');
  const qs = `limit=100${account ? `&account=${encodeURIComponent(account)}` : ''}${term ? `&ref=${encodeURIComponent(term)}` : ''}`;
  const entries = useAsync(() => client.get<LedgerEntry[]>(`/v1/admin/ledger/entries?${qs}`), [client, qs]);
  const t = tb.data;
  const merchants = (t?.accounts ?? []).filter((a) => a.account.startsWith('merchant:'));
  const owed = merchants.reduce((n, a) => n - a.balance, 0);
  const others = (t?.accounts ?? []).filter((a) => !a.account.startsWith('merchant:'));

  return (
    <>
      <PageHead title="Ledger" sub="Every rupee in and out, as debits and credits that add up. The source of truth behind settlements, refunds and reports." actions={<button className="btn" onClick={() => { tb.reload(); entries.reload(); }}>Refresh</button>} />
      {tb.error ? <Notice tone="error">{tb.error}</Notice> : null}
      {tb.loading && !t ? <Loading /> : t ? (
        <>
          {t.balanced ? <Notice tone="success">The books balance: debits {formatINR(t.debit)} equal credits {formatINR(t.credit)}.</Notice> : <Notice tone="error">The books do not balance (debits {formatINR(t.debit)}, credits {formatINR(t.credit)}). Stop and investigate before paying anyone.</Notice>}
          <div className="stats">
            <div className="card"><span className="muted small">Held at the payment partner</span><strong>{formatINR(t.accounts.find((a) => a.account === 'gateway')?.balance ?? 0)}</strong></div>
            <div className="card"><span className="muted small">Owed to {merchants.length} businesses</span><strong>{formatINR(owed)}</strong></div>
            <div className="card"><span className="muted small">VIBE has earned</span><strong>{formatINR(-(t.accounts.filter((a) => ['vibe_fee_income', 'commission_income', 'membership_income', 'vibe_event_income'].includes(a.account)).reduce((n, a) => n + a.balance, 0)))}</strong><span className="muted small">fees, commission and memberships</span></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Debits</th><th>Credits</th><th>Balance</th><th /></tr></thead>
              <tbody>
                {others.map((a) => (
                  <tr key={a.account}><td><strong>{name(a.account)}</strong><div className="muted small">{a.account}</div></td><td>{formatINR(a.debit)}</td><td>{formatINR(a.credit)}</td><td>{formatINR(Math.abs(a.balance))} <span className="muted small">{a.balance > 0 ? 'debit' : a.balance < 0 ? 'credit' : ''}</span></td><td className="actions"><button className="btn ghost sm" onClick={() => setAccount(a.account)}>Entries</button></td></tr>
                ))}
                <tr><td><strong>Owed to businesses</strong><div className="muted small">{merchants.length} accounts</div></td><td>{formatINR(merchants.reduce((n, a) => n + a.debit, 0))}</td><td>{formatINR(merchants.reduce((n, a) => n + a.credit, 0))}</td><td>{formatINR(Math.abs(owed))} <span className="muted small">credit</span></td><td className="actions"><button className="btn ghost sm" onClick={() => setAccount('merchant')}>Entries</button></td></tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h3 style={{ margin: '18px 0 8px' }}>Entries</h3>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setTerm(ref.trim()); }}>
        <select aria-label="Account" style={{ maxWidth: 260 }} value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Every account</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="merchant">Owed to businesses</option>
        </select>
        <input style={{ maxWidth: 280 }} placeholder="Payment or settlement reference" aria-label="Reference" value={ref} onChange={(e) => setRef(e.target.value)} />
        <button className="btn">Find</button>
        {account || term ? <button type="button" className="btn ghost" onClick={() => { setAccount(''); setRef(''); setTerm(''); }}>Clear</button> : null}
      </form>
      {entries.error ? <Notice tone="error">{entries.error}</Notice> : null}
      {entries.loading && !entries.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Type</th><th>Account</th><th>Debit</th><th>Credit</th><th>Reference</th></tr></thead>
            <tbody>
              {entries.data?.map((e) => (
                <tr key={e.id}>
                  <td className="small">{showDateTime(e.at)}</td>
                  <td><Badge>{e.type.replace('_', ' ')}</Badge></td>
                  <td className="small">{name(e.account)}</td>
                  <td>{e.debit ? formatINR(e.debit) : ''}</td><td>{e.credit ? formatINR(e.credit) : ''}</td>
                  <td className="small"><strong>{e.refId}</strong><div className="muted">{e.memo}</div></td>
                </tr>
              ))}
              {entries.data?.length === 0 ? <tr><td colSpan={6} className="muted">No entries match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
