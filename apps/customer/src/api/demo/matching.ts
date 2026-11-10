/**
 * One-on-one visibility rules used by the DEMO adapter to stand in for the backend.
 * The production backend owns this logic: the app must never receive invites a
 * member is not allowed to see, so preferences can't be bypassed from the client.
 */
import type { Gender, MeetPreference } from '../types';

export const AGE_BANDS = ['18–24', '25–29', '30–34', '35–39', '40+'];

/** Does a person of `gender` fall inside what `pref` is open to? */
export function accepts(pref: MeetPreference, gender: Gender): boolean {
  if (pref === 'anyone') return true;
  if (pref === 'men') return gender === 'man';
  return gender === 'woman';
}

/**
 * Two people can be shown to each other only when it works both ways:
 * the host is open to the viewer, and the viewer is open to the host.
 * Members who don't state a gender only take part in "anyone" invites.
 */
export function canMeet(
  viewer: { gender: Gender; meetPreference: MeetPreference },
  host: { gender: Gender; openTo: MeetPreference },
): boolean {
  return accepts(host.openTo, viewer.gender) && accepts(viewer.meetPreference, host.gender);
}
