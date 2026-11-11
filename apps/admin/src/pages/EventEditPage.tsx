import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { EventForm, Loading, Notice, PageHead, emptyEvent, eventToDraft, useAsync, useAuth, type EventDraft, type EventInput, type EventRow } from '@kit';

export function EventEditPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { client } = useAuth();
  const navigate = useNavigate();
  const ev = useAsync(() => (isNew ? Promise.resolve(null) : client.get<EventRow>(`/v1/admin/events/${id}`)), [client, id]);
  const [draft, setDraft] = useState<EventDraft>(emptyEvent);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (ev.data && loadedFor !== ev.data.id) { setLoadedFor(ev.data.id); setDraft(eventToDraft(ev.data)); }
  }, [ev.data, loadedFor]);

  if (!isNew && ev.loading && !ev.data) return <Loading />;
  if (!isNew && ev.error && !ev.data) return <Notice tone="error">{ev.error}</Notice>;
  const e = ev.data;

  const submit = async (input: EventInput) => {
    if (isNew) await client.post('/v1/admin/events', input); else await client.put(`/v1/admin/events/${id}`, input);
    navigate('/events');
  };

  return (
    <>
      <PageHead title={isNew ? 'Create event' : e?.title ?? 'Event'} sub={e ? `By ${e.organiser}${e.businessName ? ` (${e.businessName})` : ''}. Saving keeps the current status.` : 'Events you create publish straight away.'} />
      {e?.status === 'pending' ? <Notice tone="info">This event is waiting for review. Check the details, then publish or reject it from the Events list.</Notice> : null}
      {e?.reviewNote ? <Notice tone="info">Last review note: {e.reviewNote}</Notice> : null}
      <EventForm draft={draft} onChange={setDraft} admin submitLabel={isNew ? 'Create and publish' : 'Save changes'} onSubmit={submit} onCancel={() => navigate('/events')} />
    </>
  );
}
