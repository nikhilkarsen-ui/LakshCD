'use client';
import { useState } from 'react';
import { Toast } from './ui';
import LakshLogo from './LakshLogo';

interface AuthFormProps {
  onSignIn: (email: string, password: string) => Promise<any>;
  onSignUp?: (email: string, password: string, displayName: string) => Promise<any>;
}

export default function AuthForm({ onSignIn, onSignUp }: AuthFormProps) {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pw) return;
    setLoading(true);
    try {
      const response = mode === 'signUp' && onSignUp ? await onSignUp(email, pw, name || email.split('@')[0]) : await onSignIn(email, pw);
      if (response?.error) {
        setToast({ msg: response.error.message || 'Unable to complete request.', type: 'err' });
      } else {
        setToast({ msg: mode === 'signUp' ? 'Account created. If approved, you’ll be signed in shortly.' : 'Signed in successfully.', type: 'ok' });
      }
    } catch (err: any) {
      setToast({ msg: err?.message || 'Something went wrong.', type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center px-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <LakshLogo className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold tracking-wider">Laksh</h1>
          <p className="text-xs text-lk-dim tracking-[3px] uppercase mt-1">The 24/7 Sports Market</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setMode('signIn')}
              className={`flex-1 rounded-full border px-4 py-2 text-sm ${mode === 'signIn' ? 'border-lk-accent bg-lk-accent text-black' : 'border-white/10 bg-white/5 text-white'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('signUp')}
              className={`flex-1 rounded-full border px-4 py-2 text-sm ${mode === 'signUp' ? 'border-lk-accent bg-lk-accent text-black' : 'border-white/10 bg-white/5 text-white'}`}
            >
              Create Account
            </button>
          </div>

          {mode === 'signUp' ? (
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Display name"
              className="w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50"
            />
          ) : null}

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
            {loading ? 'Loading...' : mode === 'signUp' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-lk-text space-y-2">
          {mode === 'signIn' ? (
            <p>
              Just joined the beta?{' '}
              <button type="button" onClick={() => setMode('signUp')} className="font-semibold text-white underline underline-offset-4">
                Create an account.
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button type="button" onClick={() => setMode('signIn')} className="font-semibold text-white underline underline-offset-4">
                Sign in.
              </button>
            </p>
          )}
          <p>Account creation only works for approved beta emails. If you’re not approved yet, join the waitlist.</p>
        </div>
      </div>
    </div>
  );
}
