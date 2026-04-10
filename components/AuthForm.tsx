'use client';
import { useState } from 'react';
import { Toast } from './ui';

export default function AuthForm({ onSignIn }: { onSignIn: (email: string, password: string) => Promise<any> }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pw) return;
    setLoading(true);
    try {
      const { error } = await onSignIn(email, pw);
      if (error) {
        setToast({ msg: error.message, type: 'err' });
      }
    } catch (err: any) {
      setToast({ msg: err.message, type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center px-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center mx-auto mb-4 text-lk-bg font-extrabold text-2xl shadow-lg shadow-lk-accent/20">L</div>
          <h1 className="text-2xl font-bold tracking-wider">Laksh</h1>
          <p className="text-xs text-lk-dim tracking-[3px] uppercase mt-1">The 24/7 Sports Exchange</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50"
          />
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-lk-accent text-lk-bg font-semibold text-sm hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-lk-text">Only approved Laksh beta users can sign in. Join the waitlist if you don’t have access yet.</p>
      </div>
    </div>
  );
}
