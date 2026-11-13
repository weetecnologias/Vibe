import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { setExtraHeaders, type Workspace, type WorkspaceList } from '@kit';

/**
 * Which part of VIBE the admin is looking at: all of it, or one category (Food and dining, Movies, Sports...). Every request carries it in the
 * X-Vibe-Workspace header, and the backend narrows each list, total and download to that category, so each category's team has its own
 * merchants, money, approvals and pay run. Remembered on this computer.
 */
export type CurrentWorkspace = { id: string | null; name: string };

type Ctx = { list: WorkspaceList; current: CurrentWorkspace; choose: (ws: CurrentWorkspace) => void };
const WorkspaceContext = createContext<Ctx | null>(null);
const KEY = 'vibe.admin.workspace';
const ALL: CurrentWorkspace = { id: null, name: 'All of VIBE' };

function remembered(list: WorkspaceList): CurrentWorkspace {
  let saved: CurrentWorkspace | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    saved = raw ? (JSON.parse(raw) as CurrentWorkspace) : null;
  } catch {
    saved = null;
  }
  if (saved && (saved.id === null ? list.all : true)) {
    // A category manager can only work in their own categories.
    if (list.all || list.categories.some((c) => c.id === saved!.id)) return saved;
  }
  return list.all ? ALL : list.categories[0] ? { id: list.categories[0].id, name: list.categories[0].name } : ALL;
}

export function WorkspaceProvider({ list, children }: { list: WorkspaceList; children: (key: string) => ReactNode }) {
  const [current, setCurrent] = useState<CurrentWorkspace>(() => remembered(list));
  const ref = useRef(current);
  ref.current = current;
  // Set before any child renders and fetches, and read at the moment of each request.
  setExtraHeaders((): Record<string, string> => (ref.current.id ? { 'X-Vibe-Workspace': ref.current.id } : {}));
  const value = useMemo<Ctx>(() => ({
    list,
    current,
    choose: (ws) => {
      ref.current = ws;
      try { localStorage.setItem(KEY, JSON.stringify(ws)); } catch { /* private window: just not remembered */ }
      setCurrent(ws);
    },
  }), [list, current]);
  return <WorkspaceContext.Provider value={value}>{children(current.id ?? 'all')}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}

/** The picker above the menu. Switching keeps you on the same kind of page (Settlements stays Settlements) in the other category. */
export function WorkspaceSwitcher() {
  const { list, current, choose } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const options: Workspace[] = list.categories;
  const drilled = current.id !== null && !options.some((o) => o.id === current.id);
  const pick = (id: string) => {
    const ws = id === 'all' ? ALL : id === current.id ? current : { id, name: options.find((o) => o.id === id)?.name ?? current.name };
    choose(ws);
    navigate(`/${location.pathname.split('/')[1] || 'overview'}`);
  };
  return (
    <div className="ws-switch">
      <label htmlFor="ws">Looking at</label>
      <select id="ws" value={current.id ?? 'all'} onChange={(e) => pick(e.target.value)}>
        {list.all ? <option value="all">All of VIBE</option> : null}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        {drilled ? <option value={current.id!}>{current.name}</option> : null}
      </select>
      {current.id ? <span className="ws-path">Only {current.name}: its merchants, money and approvals.</span> : null}
    </div>
  );
}
