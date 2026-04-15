import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser } from '@/lib/auth';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

// POST /api/analytics/event
// Records session events for admin analytics.
// Events: 'start' | 'page_view' | 'end'
//
// start:     { session_id }
// page_view: { session_id, page }
// end:       { session_id, duration_seconds }

export async function POST(req: NextRequest) {
  // Best-effort: don't block the user on analytics failures
  try {
    // sendBeacon passes the token as a query param since it can't set headers
    const qToken = req.nextUrl.searchParams.get('token');
    const authReq = qToken
      ? new Request(req.url, {
          method: req.method,
          headers: { ...Object.fromEntries(req.headers), Authorization: `Bearer ${qToken}` },
          body: req.body,
          // @ts-ignore
          duplex: 'half',
        })
      : req;

    const user = await getApprovedAppUser(authReq as NextRequest);
    if (!user) return NextResponse.json({ ok: false }, { status: 403 });

    const body = await req.json().catch(() => null);
    if (!body?.session_id || !body?.event) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const { session_id, event, page, duration_seconds } = body;
    if (!['start', 'page_view', 'end'].includes(event)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const db = serverSupa();

    if (event === 'start') {
      await db.from('user_sessions').upsert({
        user_id:    user.id,
        session_id,
        started_at: new Date().toISOString(),
        page_views: 0,
        pages_visited: [],
      }, { onConflict: 'session_id', ignoreDuplicates: true });

    } else if (event === 'page_view' && page) {
      // Increment page_views and append to pages_visited array
      const { data: existing } = await db
        .from('user_sessions')
        .select('page_views, pages_visited')
        .eq('session_id', session_id)
        .eq('user_id', user.id)
        .single();

      if (existing) {
        const pages = existing.pages_visited ?? [];
        // Only append if different from last page (avoid duplicates from re-renders)
        if (pages[pages.length - 1] !== page) {
          await db.from('user_sessions').update({
            page_views:    (existing.page_views ?? 0) + 1,
            pages_visited: [...pages, page],
          }).eq('session_id', session_id).eq('user_id', user.id);
        }
      }

    } else if (event === 'end') {
      const dur = typeof duration_seconds === 'number' && duration_seconds > 0
        ? Math.round(duration_seconds)
        : null;
      await db.from('user_sessions').update({
        ended_at:         new Date().toISOString(),
        duration_seconds: dur,
      }).eq('session_id', session_id).eq('user_id', user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('Analytics event error:', e.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
