import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function getUser(req: NextRequest) {
  const h = req.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(h.replace('Bearer ', ''));
  return user ?? null;
}

export const unauth = () => Response.json({ error: 'Unauthorized' }, { status: 401 });
