import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverSupa } from '@/lib/supabase';

export async function getUser(req: NextRequest) {
  const h = req.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(h.replace('Bearer ', ''));
  return user ?? null;
}

export const unauth = () => Response.json({ error: 'Unauthorized' }, { status: 401 });

export async function getAppUser(req: NextRequest) {
  const authUser = await getUser(req);
  if (!authUser?.id) return null;

  const db = serverSupa();
  const { data, error } = await db
    .from('users')
    .select('id,email,display_name,is_approved,approved_at,balance,initial_balance')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) {
    console.error('App user lookup failed:', error);
    return null;
  }

  return data;
}

export async function getApprovedAppUser(req: NextRequest) {
  const appUser = await getAppUser(req);
  if (!appUser || !appUser.is_approved) return null;
  return appUser;
}
