const TOKEN_KEY = 'nepefy_jwt_token';
const LEGACY_TOKEN_KEY = 'clearledger_jwt_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function formatUsd(value: number, decimals = 2): string {
  const num = Number(value || 0);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function getPriceDecimals(price: number): number {
  const p = Number(price || 0);
  if (p <= 0) return 2;
  if (p < 0.0001) return 8;
  if (p < 0.01) return 6;
  if (p < 0.1) return 5;
  if (p < 2) return 4;
  if (p < 50) return 3;
  return 2;
}

export function getQtyDecimals(price: number): number {
  const p = Number(price || 0);
  if (p >= 5000) return 8;
  if (p >= 1000) return 6;
  if (p >= 50) return 4;
  if (p >= 0.5) return 2;
  return 0;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
