/**
 * Supabase connection settings, injected by Vite at build time from
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.local locally, GitHub
 * secrets in CI). The anon key is public by design: Row Level Security only
 * allows anonymous INSERTs into the games table.
 */
export interface SupabaseConfig {
  url: string; // e.g. https://abcdefgh.supabase.co (no trailing slash)
  anonKey: string;
}

export function readSupabaseConfig(): SupabaseConfig | null {
  // `?? {}` keeps this safe outside Vite (e.g. headless tests with tsx)
  const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
