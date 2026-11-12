import { createContext, useContext } from 'react';

import type { AdminArea, AdminMe } from '@kit';

/** What the signed-in VIBE team member may do, loaded once when they sign in. */
export const AccessContext = createContext<AdminMe | null>(null);

export function useAccess(): AdminMe & { full: boolean; can: (area: AdminArea) => boolean } {
  const a = useContext(AccessContext);
  if (!a) throw new Error('useAccess outside AccessContext');
  const full = a.role === 'super_admin' || a.role === 'admin';
  return { ...a, full, can: (area) => full || a.areas.includes(area) };
}
