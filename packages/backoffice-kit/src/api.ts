/** A tiny typed client for the VIBE backend. Errors keep the server's stable `code` so screens can react to them. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Role = 'ADMIN' | 'MERCHANT';
export type Staff = { id: string; email: string; name: string; role: Role; businessId: string | null; active: boolean; owner: boolean; mustChangePassword: boolean };
export type Session = { token: string; expiresAt: string; staff: Staff };

export type Client = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
  login(email: string, password: string): Promise<Session>;
  /** Uploads an image (PNG, JPEG or WebP, up to 5 MB) and returns the link to save. */
  upload(file: File): Promise<{ id: string; url: string }>;
  /** Downloads a file the server makes (a spreadsheet) and saves it on this computer. */
  download(path: string, filename: string): Promise<void>;
};

/**
 * Headers added to every request, set by the app (the admin dashboard sends the category being looked at). A function, so the value is read
 * at the moment of each request.
 */
let extraHeaders: () => Record<string, string> = () => ({});
export function setExtraHeaders(fn: () => Record<string, string>): void { extraHeaders = fn; }

export function createClient(opts: { baseUrl: string; token: () => string | null; onUnauthorized: () => void }): Client {
  async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders() };
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    // A file upload sets its own multipart boundary, so no Content-Type is sent for it.
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const token = opts.token();
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.');
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      if (res.status === 401 && auth && token) opts.onUnauthorized();
      const e = (data ?? {}) as { code?: string; message?: string };
      throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong.');
    }
    return data as T;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    put: (p, b) => request('PUT', p, b ?? {}),
    del: (p) => request('DELETE', p),
    login: (email, password) => request('POST', '/v1/staff/login', { email, password }, false),
    upload: (file) => {
      const form = new FormData();
      form.append('file', file);
      return request('POST', '/v1/media', form);
    },
    download: async (path, filename) => {
      const token = opts.token();
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}${path}`, { headers: { ...extraHeaders(), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      } catch {
        throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.');
      }
      if (!res.ok) {
        if (res.status === 401 && token) opts.onUnauthorized();
        const e = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'The download didn’t work.');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.');
