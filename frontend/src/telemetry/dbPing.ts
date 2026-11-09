import { readSupabaseConfig } from './supabaseConfig';

export type DbStatus = 'checking' | 'online' | 'offline' | 'unconfigured';

/**
 * Pings the root of the Supabase REST API (bypasses RLS restrictions on the
 * games table, which is INSERT-only for anon).
 */
export async function pingDatabase(timeoutMs = 6000): Promise<Exclude<DbStatus, 'checking'>> {
  const cfg = readSupabaseConfig();
  if (!cfg) return 'unconfigured';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(`${cfg.url}/rest/v1/`, {
      headers: { apikey: cfg.anonKey },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    return response.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  } finally {
    clearTimeout(timer);
  }
}
