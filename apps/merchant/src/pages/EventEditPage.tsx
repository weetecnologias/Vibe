import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { EventForm, Loading, Notice, PageHead, emptyEvent, eventToDraft, useAsync, useAuth, type EventDraft, type EventInput, type EventRow } from '@kit';

export function EventEditPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { client } = useAuth();
  const navigate = useNavigate();
  const ev = useAsync(() => (isNew ? Promise.resolve(null) : client.get<EventRow>(`/v1/merchant/events/${id}`)), [client, id]);
  const [draft, setDraft] = useState<EventDraft>(emptyEvent);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (ev.data && loadedFor !== ev.data.id) { setLoadedFor(ev.data.id); setDraft(eventToDraft(ev.data)); }
  }, [ev.data, loadedFor]);

  if (!isNew && ev.loading && !ev.data) return <Loading />;
  if (!isNew && ev.error && !ev.data) return <Notice tone="error">{ev.error}</Notice>;
  const e = ev.data;

  const submit = async (input: EventInput) => {
    if (isNew) await client.post('/v1/merchant/events', input); else await client.put(`/v1/merchant/events/${id}`, input);
    navigate('/events');
  };

  return (
    <>
      <PageHead title={isNew ? 'Create event' : e?.title ?? 'Event'} sub="VIBE reviews the event before customers can see it." />
      {e?.status === 'rejected' ? <Notice tone="error">Not approved{e.reviewNote ? `: ${e.reviewNote}` : '.'} Fix the details and save to send it back for review.</Notice> : null}
      {e?.status === 'published' ? <Notice tone="info">This event is live. Saving changes sends it back to VIBE for review, and it is hidden from customers until it is approved again.</Notice> : null}
      <EventForm draft={draft} onChange={setDraft} submitLabel={isNew ? 'Submit for review' : 'Save and resubmit'} onSubmit={submit} onCancel={() => navigate('/events')} />
    </>
  );
}
