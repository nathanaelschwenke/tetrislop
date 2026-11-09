import { TELEMETRY_CONFIG } from '../config/gameConfig';
import { readSupabaseConfig } from './supabaseConfig';

export type DbStatus = 'checking' | 'online' | 'offline' | 'unconfigured';

/**
 * Checks that the games table is reachable with the public key.
 *
 * The REST root (`/rest/v1/`) is no longer an option: Supabase only serves it
 * to secret keys ("Secret API key required"). Instead we ask for zero rows of
 * the games table. anon has no SELECT grant there (INSERT-only), so Postgres
 * answers with error 42501 "permission denied". That answer can only come
 * from the database itself with the key accepted, so it counts as online.
 * A wrong key, a paused project or a network failure gives anything else.
 */
export async function pingDatabase(timeoutMs = 6000): Promise<Exclude<DbStatus, 'checking'>> {
  const cfg = readSupabaseConfig();
  if (!cfg) return 'unconfigured';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(`${cfg.url}/rest/v1/${TELEMETRY_CONFIG.table}?select=game_id&limit=0`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (response.ok) return 'online'; // in case SELECT is ever granted
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    return body?.code === '42501' ? 'online' : 'offline';
  } catch {
    return 'offline';
  } finally {
    clearTimeout(timer);
  }
}
