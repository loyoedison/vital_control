let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'VitalControl');
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && unauthorizedHandler && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/status')) {
    unauthorizedHandler();
  }

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: 'Respuesta inesperada del servidor.' };
  }

  if (!response.ok) {
    const error = new Error(String(data.error || `Error HTTP ${response.status}`)) as Error & {
      status?: number;
      payload?: Record<string, unknown>;
    };
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data as T;
}
