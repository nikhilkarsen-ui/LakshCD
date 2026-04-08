import { createBrowserClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _b: SupabaseClient | null = null;
export function browserSupa(): SupabaseClient {
  if (!_b) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('@supabase/ssr: Your project\'s URL and API key are required to create a Supabase client!');
    }
    _b = createBrowserClient(url, key);
  }
  return _b;
}

export function serverSupa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('Missing Supabase environment variables:', { hasUrl: !!url, hasKey: !!key });
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
