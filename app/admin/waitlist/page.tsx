'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks';

type WaitlistEntry = {
  id: string;
  email: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  notes: string | null;
};

type ApiResponse = {
  entries?: WaitlistEntry[];
  error?: string;
};

export default function AdminWaitlistPage() {
  const { user, session } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/waitlist', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Unable to load waitlist.');
      }
      setEntries(data.entries || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load waitlist.');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    if (!session?.access_token) return;
    setActionLoading(id);
    setError(null);

    try {
      const res = await fetch('/api/admin/waitlist', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Unable to update entry.');
      }
      await fetchEntries();
    } catch (err: any) {
      setError(err?.message || 'Unable to update entry.');
    } finally {
      setActionLoading(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-lk-bg text-white px-6 py-20">
        <div className="mx-auto max-w-2xl rounded-[2rem] border border-white/10 bg-white/5 p-10 text-center shadow-2xl shadow-black/20">
          <p className="text-sm uppercase tracking-[0.35em] text-lk-accent">Admin access required</p>
          <h1 className="mt-4 text-3xl font-bold text-white">Sign in with an admin account to manage the waitlist.</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-lk-bg px-6 py-20 text-white">
      <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-lk-accent">Admin waitlist</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Approve beta access requests</h1>
          </div>
          <p className="text-sm text-lk-text">Signed in as {user.email}</p>
        </div>

        {error ? <p className="mt-6 text-sm text-rose-300">{error}</p> : null}
        {loading ? (
          <p className="mt-6 text-sm text-lk-text">Loading waitlist…</p>
        ) : (
          <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-black/40">
            <div className="grid grid-cols-[1.6fr_1fr_1fr_1.4fr_1.2fr] gap-4 border-b border-white/10 bg-white/5 px-6 py-4 text-left text-xs uppercase tracking-[0.24em] text-lk-accent">
              <span>Email</span>
              <span>Status</span>
              <span>Created</span>
              <span>Approved</span>
              <span className="text-right">Actions</span>
            </div>
            {entries.length === 0 ? (
              <div className="px-6 py-8 text-sm text-lk-text">No waitlist entries yet.</div>
            ) : (
              entries.map(entry => (
                <div key={entry.id} className="grid grid-cols-[1.6fr_1fr_1fr_1.4fr_1.2fr] gap-4 border-t border-white/10 px-6 py-4 text-sm text-white">
                  <span>{entry.email}</span>
                  <span className={entry.status === 'approved' ? 'text-emerald-300' : entry.status === 'rejected' ? 'text-rose-300' : 'text-lk-text'}>{entry.status}</span>
                  <span>{new Date(entry.created_at).toLocaleString()}</span>
                  <span>{entry.approved_at ? new Date(entry.approved_at).toLocaleString() : '—'}</span>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      disabled={actionLoading === entry.id || entry.status === 'approved'}
                      onClick={() => handleAction(entry.id, 'approve')}
                      className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={actionLoading === entry.id || entry.status === 'rejected'}
                      onClick={() => handleAction(entry.id, 'reject')}
                      className="rounded-full bg-rose-500 px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
