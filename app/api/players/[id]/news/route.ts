// GET /api/players/[id]/news
// Fetches recent NBA news for a player via Google News RSS.
// No API key required. Results cached in memory for 15 minutes per player.

import { NextRequest, NextResponse } from 'next/server';
import { serverSupa } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

const CACHE = new Map<string, { articles: Article[]; fetchedAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

export interface Article {
  title:       string;
  url:         string;
  source:      string;
  publishedAt: string; // ISO string
}

function parseRSS(xml: string): Article[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  return items.slice(0, 6).map(item => {
    const get = (tag: string) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const title      = get('title').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const link       = get('link') || item.match(/<link\s*\/?>([^<]+)/)?.[1]?.trim() || '';
    const pubDate    = get('pubDate');
    const sourceName = item.match(/<source[^>]*>([^<]+)<\/source>/)?.[1]?.trim()
                    || new URL(link || 'https://news.google.com').hostname.replace(/^www\./, '');
    return {
      title,
      url:         link,
      source:      sourceName,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    };
  }).filter(a => a.title && a.url);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  // Fetch player name from DB
  const db = serverSupa();
  const { data: player } = await db
    .from('players').select('name').eq('id', id).single();
  if (!player) return NextResponse.json({ articles: [] });

  const cached = CACHE.get(id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ articles: cached.articles });
  }

  try {
    const query     = encodeURIComponent(`${player.name} NBA`);
    const rssUrl    = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const response  = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error('RSS fetch failed');
    const xml      = await response.text();
    const articles = parseRSS(xml);

    CACHE.set(id, { articles, fetchedAt: Date.now() });
    return NextResponse.json({ articles });
  } catch {
    return NextResponse.json({ articles: cached?.articles ?? [] });
  }
}
