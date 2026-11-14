import { useRef, useState } from 'react';

import { Badge, DownloadButton, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth } from '@kit';

import { ReconciliationPage } from './ReconciliationPage';

type Problem = { kind: string; reference: string; detail: string; amount: number; since: string | null; bankLineId: string | null };
type Overview = {
  awaitingGatewayCount: number; awaitingGatewayAmount: number; awaitingGatewaySince: string | null; gatewayLineProblems: number;
  payoutsAwaitingBank: number; payoutsAwaitingBankAmount: number; payoutsMatched: number; payoutsMismatched: number;
  merchantPayoutsPaid: number; merchantPayoutsInBank: number; merchantPayoutsNotInBank: number; merchantPayoutsNotInBankAmount: number;
  unknownCredits: number; unknownDebits: number; atGateway: number; escrowBooks: number; escrowBank: number | null; statementTo: string | null; exceptions: Problem[];
};
type GatewayPayout = {
  id: string; providerSettlementId: string; utr: string | null; settledOn: string; paymentsAmount: number; refundsAmount: number; fees: number; tax: number; net: number; lineCount: number;
  problems: number; status: 'awaiting_bank' | 'matched' | 'amount_mismatch'; bankDate: string | null; fileName: string; importedAt: string;
};
type GatewayLine = { lineNo: number; type: string; key: string; paymentReference: string | null; amount: number; fee: number; tax: number; vibeAmount: number | null; result: string };
type BankLine = { id: string; valueDate: string; narration: string; reference: string; credit: number; debit: number; result: string; gatewayPayout: string | null; settlementRef: string | null; businessName: string | null; note: string | null };

const KIND: Record<string, string> = {
  not_in_gateway_payout: 'Not in a gateway payout', gateway_line_unknown: 'Gateway: unknown payment', gateway_line_duplicate: 'Gateway: paid out twice', gateway_line_status_mismatch: 'Gateway: status differs',
  gateway_line_amount_mismatch: 'Gateway: amount differs', gateway_payout_not_in_bank: 'Gateway payout not in bank', gateway_payout_amount: 'Gateway payout: amount differs',
  merchant_payout_not_in_bank: 'Payout not seen in bank', bank_credit_unknown: 'Bank: unknown money in', bank_debit_unknown: 'Bank: unknown money out',
};
const BANK: Record<string, { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  gateway_payout: { label: 'Gateway payout', tone: 'success' }, merchant_payout: { label: 'Payout to business', tone: 'success' }, amount_mismatch: { label: 'Amount differs', tone: 'warning' },
  unknown: { label: 'Not matched', tone: 'warning' }, explained: { label: 'Explained', tone: 'muted' },
};
type Tab = 'problems' | 'gateway' | 'bank' | 'file';

/**
 * Model A, checked. Customers pay through the gateway → the gateway pays VIBE's escrow account (less its charges) → VIBE pays each business
 * from that account. Finance uploads the gateway's settlement report and the escrow account's statement; VIBE matches every line and lists
 * what doesn't match until it's sorted out or explained.
 */
export function MoneyChecksPage() {
  const { client } = useAuth();
  const o = useAsync(() => client.get<Overview>('/v1/admin/escrow/overview'), [client]);
  const [tab, setTab] = useState<Tab>('problems');
  const [notice, setNotice] = useState<string | null>(null);
  const d = o.data;
  const ok = (n: number) => (n === 0 ? <Badge tone="success">All matched</Badge> : <Badge tone="warning">{n} to look at</Badge>);
  const diff = d && d.escrowBank !== null ? d.escrowBooks - d.escrowBank : null;

  return (
    <>
      <PageHead
        title="Money checks"
        sub="Customers pay through the payment gateway → the gateway pays VIBE’s escrow account, less its charges → VIBE pays each business its share. Upload the gateway’s report and the escrow statement; VIBE matches every line."
        actions={<><DownloadButton path="/v1/admin/escrow/problems.csv" filename="vibe-money-checks.csv" label="Download Excel" /><button className="btn" onClick={o.reload}>Refresh</button></>}
      />
      <div className="row" style={{ marginBottom: 12 }}>
        <UploadButton label="Upload gateway settlement report" path="/v1/admin/escrow/gateway-report" onDone={(m) => { setNotice(m); o.reload(); }} describe={(r: { payouts: number; alreadyImported: number; matched: number; problems: number; net: number }) =>
          `${r.payouts} gateway payout${r.payouts === 1 ? '' : 's'} added (${formatINR(r.net)} to the escrow account): ${r.matched} lines matched, ${r.problems} to look at.${r.alreadyImported ? ` ${r.alreadyImported} already uploaded before, skipped.` : ''}`} />
        <UploadButton label="Upload escrow bank statement" path="/v1/admin/escrow/bank-statement" onDone={(m) => { setNotice(m); o.reload(); }} describe={(r: { newLines: number; alreadySeen: number; matched: number; unmatched: number }) =>
          `${r.newLines} new bank lines: ${r.matched} matched, ${r.unmatched} to look at.${r.alreadySeen ? ` ${r.alreadySeen} were already uploaded, skipped.` : ''}`} />
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {o.error ? <Notice tone="error">{o.error}</Notice> : null}
      {o.loading && !d ? <Loading /> : d ? (
        <div className="stack">
          <div className="kpis">
            <div className="card"><span className="muted small">Paid by customers, not yet in a gateway payout</span><strong>{formatINR(d.awaitingGatewayAmount)}</strong><span className="muted small">{d.awaitingGatewayCount} payments{d.awaitingGatewaySince ? ` · oldest ${showDateTime(d.awaitingGatewaySince)}` : ''}</span></div>
            <div className="card"><span className="muted small">At the gateway, by VIBE’s books</span><strong>{formatINR(d.atGateway)}</strong><span className="muted small">Collected, not yet paid to the escrow account</span></div>
            <div className="card"><span className="muted small">Escrow account, by VIBE’s books</span><strong>{formatINR(d.escrowBooks)}</strong><span className="muted small">{d.escrowBank === null ? 'Upload a statement to compare with the bank' : `Bank says ${formatINR(d.escrowBank)}${d.statementTo ? ` on ${d.statementTo}` : ''}`}</span></div>
            <div className="card"><span className="muted small">Books minus bank</span><strong style={{ color: diff ? 'var(--warning)' : undefined }}>{diff === null ? '–' : formatINR(diff)}</strong><span className="muted small">{diff === null ? '' : diff === 0 ? 'They agree' : 'Look at the lines not matched below'}</span></div>
          </div>

          <div className="grid3">
            <div className="card stack" style={{ gap: 6, alignContent: 'start' }}>
              <span className="muted small">Check 1</span><strong>Every customer payment is in a gateway payout, once</strong>
              {ok(d.gatewayLineProblems + d.exceptions.filter((e) => e.kind === 'not_in_gateway_payout').length)}
              <span className="small muted">{d.awaitingGatewayCount} not in a payout yet · {d.gatewayLineProblems} gateway lines that don’t match</span>
            </div>
            <div className="card stack" style={{ gap: 6, alignContent: 'start' }}>
              <span className="muted small">Check 2</span><strong>Every gateway payout arrived in the escrow account</strong>
              {ok(d.payoutsMismatched + d.exceptions.filter((e) => e.kind === 'gateway_payout_not_in_bank').length + d.unknownCredits)}
              <span className="small muted">{d.payoutsMatched} matched · {d.payoutsAwaitingBank} waiting ({formatINR(d.payoutsAwaitingBankAmount)}) · {d.payoutsMismatched} amount differs · {d.unknownCredits} unknown credits</span>
            </div>
            <div className="card stack" style={{ gap: 6, alignContent: 'start' }}>
              <span className="muted small">Check 3</span><strong>Every payout to a business left the escrow account</strong>
              {ok(d.exceptions.filter((e) => e.kind === 'merchant_payout_not_in_bank').length + d.unknownDebits)}
              <span className="small muted">{d.merchantPayoutsInBank} of {d.merchantPayoutsPaid} seen in the bank · {formatINR(d.merchantPayoutsNotInBankAmount)} not yet · {d.unknownDebits} unknown debits</span>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'problems'} className={`tab${tab === 'problems' ? ' on' : ''}`} onClick={() => setTab('problems')}>To look at · {d.exceptions.length}</button>
            <button role="tab" aria-selected={tab === 'gateway'} className={`tab${tab === 'gateway' ? ' on' : ''}`} onClick={() => setTab('gateway')}>Gateway payouts</button>
            <button role="tab" aria-selected={tab === 'bank'} className={`tab${tab === 'bank' ? ' on' : ''}`} onClick={() => setTab('bank')}>Escrow bank lines</button>
            <button role="tab" aria-selected={tab === 'file'} className={`tab${tab === 'file' ? ' on' : ''}`} onClick={() => setTab('file')}>Payments file (older check)</button>
          </div>
          {tab === 'problems' ? <Problems items={d.exceptions} onChanged={o.reload} /> : null}
          {tab === 'gateway' ? <GatewayPayouts /> : null}
          {tab === 'bank' ? <BankLines onChanged={o.reload} /> : null}
          {tab === 'file' ? <ReconciliationPage /> : null}

          <details className="card">
            <summary className="small"><strong>Trying it without a real gateway</strong></summary>
            <p className="small muted">In development the gateway is simulated. These make a gateway report and an escrow statement from VIBE’s own data (2% gateway charge plus GST), so you can upload them above and see the checks work. They aren’t available on the live system.</p>
            <div className="row"><DownloadButton small path="/v1/admin/dev/sample-gateway-report.csv" filename="sample-gateway-report.csv" label="Sample gateway report" /><DownloadButton small path="/v1/admin/dev/sample-bank-statement.csv" filename="sample-escrow-statement.csv" label="Sample escrow statement" /></div>
          </details>
        </div>
      ) : null}
    </>
  );
}

function UploadButton<T>({ label, path, onDone, describe }: { label: string; path: string; onDone: (message: string) => void; describe: (r: T) => string }) {
  const { client } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setError('That file is over 10 MB. Split it by date.');
    setBusy(true);
    setError(null);
    try { onDone(describe(await client.post<T>(path, { fileName: file.name, csv: await file.text() }))); } catch (e) { setError(errorText(e)); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <span className="download">
      <input ref={input} type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="btn primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Matching…' : label}</button>
      {error ? <span className="small" role="alert" style={{ color: 'var(--error)' }}>{error}</span> : null}
    </span>
  );
}

function Problems({ items, onChanged }: { items: Problem[]; onChanged: () => void }) {
  const [explaining, setExplaining] = useState<Problem | null>(null);
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead><tr><th>What</th><th>Reference</th><th>Detail</th><th>Amount</th><th>Since</th><th /></tr></thead>
          <tbody>
            {items.map((p, i) => (
              <tr key={`${p.kind}-${p.reference}-${i}`}>
                <td><Badge tone="warning">{KIND[p.kind] ?? p.kind}</Badge></td>
                <td><strong>{p.reference}</strong></td>
                <td className="small">{p.detail}</td>
                <td>{formatINR(p.amount)}</td>
                <td className="small">{p.since ? showDateTime(p.since) : ''}</td>
                <td className="actions">{p.bankLineId ? <button className="btn ghost sm" onClick={() => setExplaining(p)}>Explain</button> : null}</td>
              </tr>
            ))}
            {items.length === 0 ? <tr><td colSpan={6} className="muted">Nothing to look at. Every payment, gateway payout and payout to a business matches.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="muted small">Payments, gateway payouts and payouts to businesses get {3} days to show up before they’re listed here. A bank line that isn’t a gateway payout or a payout to a business (bank charges, VIBE moving its own income out) can be explained with a note.</p>
      {explaining?.bankLineId ? <Explain lineId={explaining.bankLineId} title={explaining.reference} onClose={() => setExplaining(null)} onDone={() => { setExplaining(null); onChanged(); }} /> : null}
    </>
  );
}

function Explain({ lineId, title, onClose, onDone }: { lineId: string; title: string; onClose: () => void; onDone: () => void }) {
  const { client } = useAuth();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try { await client.post(`/v1/admin/escrow/bank-lines/${lineId}/explain`, { note: note.trim() }); onDone(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <Modal title={`Explain bank line ${title}`} onClose={onClose}>
      <div className="stack">
        <Field label="What is this line?" hint="For example: monthly account charges, VIBE’s commission moved to the operating account."><input autoFocus value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={note.trim().length < 3} onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

function GatewayPayouts() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<GatewayPayout[]>('/v1/admin/escrow/gateway-payouts'), [client]);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useAsync(() => (open ? client.get<{ payout: GatewayPayout; lines: GatewayLine[] }>(`/v1/admin/escrow/gateway-payouts/${open}`) : Promise.resolve(null)), [client, open]);
  return (
    <>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Gateway payout</th><th>Payments</th><th>Gateway kept</th><th>To escrow</th><th>In the bank?</th><th /></tr></thead>
            <tbody>
              {list.data?.map((g) => (
                <tr key={g.id}>
                  <td><strong>{g.providerSettlementId}</strong><div className="muted small">{g.settledOn}{g.utr ? ` · UTR ${g.utr}` : ''} · {g.lineCount} lines{g.problems ? ` · ${g.problems} don’t match` : ''}</div></td>
                  <td>{formatINR(g.paymentsAmount)}{g.refundsAmount ? <div className="muted small">refunds − {formatINR(g.refundsAmount)}</div> : null}</td>
                  <td>{formatINR(g.fees + g.tax)}<div className="muted small">charges {formatINR(g.fees)} + GST {formatINR(g.tax)}</div></td>
                  <td><strong>{formatINR(g.net)}</strong></td>
                  <td>{g.status === 'matched' ? <><Badge tone="success">Arrived</Badge><div className="muted small">{g.bankDate}</div></> : g.status === 'amount_mismatch' ? <Badge tone="warning">Amount differs</Badge> : <Badge>Not yet</Badge>}</td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(g.id)}>Lines</button></td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={6} className="muted">No gateway reports uploaded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {open ? (
        <Modal title={detail.data ? `Gateway payout ${detail.data.payout.providerSettlementId}` : 'Gateway payout'} onClose={() => setOpen(null)} wide>
          {!detail.data ? <Loading /> : (
            <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table>
                <thead><tr><th>Line</th><th>Type</th><th>Payment</th><th>Gateway amount</th><th>VIBE amount</th><th>Charges</th><th>Result</th></tr></thead>
                <tbody>
                  {detail.data.lines.map((l) => (
                    <tr key={l.lineNo}>
                      <td>{l.lineNo}</td><td>{l.type}</td><td><strong>{l.paymentReference ?? l.key}</strong></td><td>{formatINR(l.amount)}</td><td>{l.vibeAmount === null ? '—' : formatINR(l.vibeAmount)}</td>
                      <td className="small">{formatINR(l.fee + l.tax)}</td>
                      <td>{l.result === 'matched' ? <Badge tone="success">Matched</Badge> : <Badge tone="warning">{l.result.replace('_', ' ')}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

function BankLines({ onChanged }: { onChanged: () => void }) {
  const { client } = useAuth();
  const [problems, setProblems] = useState(false);
  const list = useAsync(() => client.get<BankLine[]>(`/v1/admin/escrow/bank-lines${problems ? '?problems=true' : ''}`), [client, problems]);
  const [explaining, setExplaining] = useState<BankLine | null>(null);
  return (
    <>
      <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} /> Only lines not matched</label>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Narration</th><th>Reference</th><th>Money in</th><th>Money out</th><th>Matched to</th><th /></tr></thead>
            <tbody>
              {list.data?.map((l) => (
                <tr key={l.id}>
                  <td className="small">{l.valueDate}</td>
                  <td className="small">{l.narration}</td>
                  <td className="small">{l.reference}</td>
                  <td>{l.credit ? formatINR(l.credit) : ''}</td>
                  <td>{l.debit ? formatINR(l.debit) : ''}</td>
                  <td><Badge tone={BANK[l.result]?.tone ?? 'muted'}>{BANK[l.result]?.label ?? l.result}</Badge><div className="muted small">{l.gatewayPayout ?? (l.settlementRef ? `${l.settlementRef} · ${l.businessName}` : l.note ?? '')}</div></td>
                  <td className="actions">{l.result === 'unknown' || l.result === 'amount_mismatch' ? <button className="btn ghost sm" onClick={() => setExplaining(l)}>Explain</button> : null}</td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">No bank lines yet. Upload the escrow account’s statement.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {explaining ? <Explain lineId={explaining.id} title={explaining.reference || explaining.narration} onClose={() => setExplaining(null)} onDone={() => { setExplaining(null); list.reload(); onChanged(); }} /> : null}
    </>
  );
}
