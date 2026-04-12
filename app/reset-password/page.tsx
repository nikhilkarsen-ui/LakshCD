'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import LakshLogo from '@/components/LakshLogo';
import { Toast } from '@/components/ui';

type Stage = 'waiting' | 'ready' | 'done' | 'error';

// Use a plain supabase-js client (not @supabase/ssr) so it correctly detects
// the #access_token hash fragment and fires the PASSWORD_RECOVERY event.
function makeClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('waiting');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  // Keep a single client instance for this page so updateUser reuses the same session
  const sbRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    const sb = makeClient();
    sbRef.current = sb;

    // onAuthStateChange fires PASSWORD_RECOVERY when Supabase processes the hash
    const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStage('ready');
    });

    // Fallback: if the page loaded after the hash was already consumed (e.g. fast
    // navigation), check the session — but only treat it as a recovery if the URL
    // still carries the type=recovery hint or an access_token.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash.includes('type=recovery') || hash.includes('access_token')) {
      sb.auth.getSession().then(({ data: { session } }) => {
        if (session) setStage('ready');
      });
    } else {
      // No recovery token present at all — show error after a short grace period
      // (give onAuthStateChange a tick to fire first)
      const t = setTimeout(() => setStage('error'), 1500);
      return () => { clearTimeout(t); subscription.unsubscribe(); };
    }

    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) {
      setToast({ msg: 'Passwords do not match.', type: 'err' });
      return;
    }
    if (pw.length < 8) {
      setToast({ msg: 'Password must be at least 8 characters.', type: 'err' });
      return;
    }
    setLoading(true);
    try {
      const sb = sbRef.current!;
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) {
        setToast({ msg: error.message || 'Failed to update password.', type: 'err' });
      } else {
        setStage('done');
        setTimeout(() => router.push('/'), 2500);
      }
    } catch (err: any) {
      setToast({ msg: err?.message || 'Something went wrong.', type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50";

  return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center px-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <LakshLogo className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold tracking-wider">Laksh</h1>
          <p className="text-xs text-lk-dim tracking-[3px] uppercase mt-1">The 24/7 Sports Market</p>
        </div>

        {stage === 'waiting' && (
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-lk-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-lk-dim">Verifying reset link…</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="text-center space-y-4">
            <p className="text-sm text-lk-dim">This reset link is invalid or has expired.</p>
            <button
              onClick={() => router.push('/')}
              className="w-full py-3.5 rounded-xl bg-lk-accent text-lk-bg font-semibold text-sm hover:brightness-110"
            >
              Back to sign in
            </button>
          </div>
        )}

        {stage === 'ready' && (
          <form onSubmit={submit} className="space-y-4">
            <div className="text-center mb-2">
              <p className="text-sm font-semibold text-white">Set a new password</p>
              <p className="text-xs text-lk-dim mt-1">Choose a strong password for your account.</p>
            </div>
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="New password"
              required
              minLength={8}
              className={inputClass}
            />
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              required
              className={inputClass}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-lk-accent text-lk-bg font-semibold text-sm hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        {stage === 'done' && (
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-lk-accent/15 border border-lk-accent/30 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-lk-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white">Password updated</p>
            <p className="text-xs text-lk-dim">Redirecting you back to sign in…</p>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-white/8 text-center text-xs text-lk-dim">
          Have any questions?{' '}
          <a href="mailto:nikhil@laksh.app" className="text-lk-accent hover:underline underline-offset-4">
            Contact nikhil@laksh.app
          </a>
        </div>
      </div>
    </div>
  );
}
