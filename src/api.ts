import { API_URL } from './config';

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; token?: string };

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong');
  return payload as T;
}

export type PriceQuote = { feeKobo: number; currency: 'NGN'; estimatedMinutes: number };
export const getQuote = (distanceKm: number, parcelSize: 'DOCUMENT' | 'SMALL' | 'MEDIUM' | 'LARGE', speed: 'STANDARD' | 'EXPRESS') =>
  api<PriceQuote>('/pricing/quote', { method: 'POST', body: { distanceKm, parcelSize, speed } });
