import * as SecureStore from 'expo-secure-store';
import type { Session } from './api';

const SESSION_KEY = 'parcelgo.session';
export const loadSession = async (): Promise<Session | null> => { const raw = await SecureStore.getItemAsync(SESSION_KEY); return raw ? JSON.parse(raw) as Session : null; };
export const saveSession = (session: Session) => SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
export const clearSession = () => SecureStore.deleteItemAsync(SESSION_KEY);
