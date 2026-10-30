import { API_URL } from './config';

export type Role = 'SENDER' | 'RIDER' | 'ADMIN';

export type Session = {
  token: string;
  user: {
    id: string;
    fullName: string;
    phone?: string;
    role: Role;
    kycVerified?: boolean;
  };
};

export type DeliveryStatus =
  | 'PENDING'
  | 'MATCHING'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED';

export type DeliveryEvent = {
  status: DeliveryStatus;
  note?: string | null;
  createdAt: string;
};

export type Delivery = {
  id: string;
  trackingCode: string;
  pickupAddress: string;
  dropoffAddress: string;
  receiverName: string;
  receiverPhone: string;
  parcelSize: 'DOCUMENT' | 'SMALL' | 'MEDIUM' | 'LARGE';
  feeKobo: number;
  status: DeliveryStatus;
  createdAt: string;
  rider?: { fullName: string; phone?: string } | null;
  events?: DeliveryEvent[];
};

export type PriceQuote = {
  feeKobo: number;
  currency: 'NGN';
  estimatedMinutes: number;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; token?: string };

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new ApiError(
      `Cannot connect to ParcelGo API at ${API_URL}. Please ensure the API server is running and reachable.`,
      0
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error ?? 'Something went wrong', response.status, payload.code);
  }
  return payload as T;
}

export const register = (
  fullName: string,
  phone: string,
  password: string,
  role: Role = 'SENDER'
) =>
  api<Session>('/auth/register', {
    method: 'POST',
    body: { fullName, phone, password, role }
  });

export const login = (phone: string, password: string) =>
  api<Session>('/auth/login', { method: 'POST', body: { phone, password } });

export const getMe = (token: string) =>
  api<Session['user']>('/auth/me', { token });

export const getQuote = (
  distanceKm: number,
  parcelSize: 'DOCUMENT' | 'SMALL' | 'MEDIUM' | 'LARGE',
  speed: 'STANDARD' | 'EXPRESS'
) =>
  api<PriceQuote>('/pricing/quote', {
    method: 'POST',
    body: { distanceKm, parcelSize, speed }
  });

export const createDelivery = (
  token: string,
  body: {
    pickupAddress: string;
    dropoffAddress: string;
    receiverName: string;
    receiverPhone: string;
    parcelSize: 'DOCUMENT' | 'SMALL' | 'MEDIUM' | 'LARGE';
    description?: string;
    feeKobo: number;
  }
) => api<Delivery>('/deliveries', { method: 'POST', token, body });

export const getMyDeliveries = (token: string) =>
  api<Delivery[]>('/deliveries/mine', { token });

export const getDelivery = (trackingCode: string) =>
  api<Delivery>(`/deliveries/${encodeURIComponent(trackingCode)}`);

export const getAvailableDeliveries = (token: string) =>
  api<Delivery[]>('/rider/deliveries/available', { token });

export const acceptDelivery = (token: string, deliveryId: string) =>
  api<{ id: string; status: DeliveryStatus }>(`/rider/deliveries/${deliveryId}/accept`, {
    method: 'POST',
    token
  });

export const updateDeliveryStatus = (
  token: string,
  deliveryId: string,
  status: DeliveryStatus
) =>
  api<{ id: string; status: DeliveryStatus }>(`/deliveries/${deliveryId}/status`, {
    method: 'PATCH',
    token,
    body: { status }
  });

export const setRiderAvailability = (token: string, isOnline: boolean) =>
  api<any>('/rider/availability', {
    method: 'PATCH',
    token,
    body: { isOnline }
  });

/**
 * Real-time Server-Sent Events (SSE) listener for delivery updates and notifications.
 */
export function subscribeToRealtime(
  token: string,
  onEvent: (data: { type: string; payload?: any }) => void,
  onError?: (err: unknown) => void
): () => void {
  let active = true;
  let xhr: XMLHttpRequest | null = null;
  let lastIndex = 0;

  const connect = () => {
    if (!active) return;
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', `${API_URL}/events?token=${encodeURIComponent(token)}`);
      xhr.setRequestHeader('Accept', 'text/event-stream');

      xhr.onprogress = () => {
        if (!xhr || !active) return;
        const text = xhr.responseText || '';
        const chunk = text.slice(lastIndex);
        lastIndex = text.length;

        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              onEvent(parsed);
            } catch {}
          }
        }
      };

      xhr.onerror = err => {
        onError?.(err);
        if (active) setTimeout(connect, 5000);
      };

      xhr.onloadend = () => {
        if (active) setTimeout(connect, 3000);
      };

      xhr.send();
    } catch (err) {
      onError?.(err);
      if (active) setTimeout(connect, 5000);
    }
  };

  connect();

  return () => {
    active = false;
    if (xhr) {
      xhr.abort();
      xhr = null;
    }
  };
}
