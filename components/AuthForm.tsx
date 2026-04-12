'use client';
import { useState } from 'react';
import { Toast } from './ui';
import LakshLogo from './LakshLogo';

type Mode = 'signIn' | 'signUp' | 'forgotPassword';

interface AuthFormProps {
  onSignIn: (email: string, password: string) => Promise<any>;
  onSignUp?: (email: string, password: string, displayName: string) => Promise<any>;
  onForgotPassword?: (email: string) => Promise<any>;
}

export default function AuthForm({ onSignIn, onSignUp, onForgotPassword }: AuthFormProps) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    if (mode !== 'forgotPassword' && !pw) return;
    setLoading(true);
    try {
      if (mode === 'forgotPassword') {
        if (!onForgotPassword) return;
        const response = await onForgotPassword(email);
        if (response?.error) {
          setToast({ msg: response.error.message || 'Unable to send reset email.', type: 'err' });
        } else {
          setToast({ msg: 'Password reset email sent. Check your inbox.', type: 'ok' });
          setEmail('');
        }
        return;
      }
      const response = mode === 'signUp' && onSignUp
        ? await onSignUp(email, pw, name || email.split('@')[0])
        : await onSignIn(email, pw);
      if (response?.error) {
        setToast({ msg: response.error.message || 'Unable to complete request.', type: 'err' });
      } else {
        setToast({ msg: mode === 'signUp' ? "Account created. If approved, you'll be signed in shortly." : 'Signed in successfully.', type: 'ok' });
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

        {mode === 'forgotPassword' ? (
          <form onSubmit={submit} className="space-y-4">
            <div className="text-center mb-2">
              <p className="text-sm font-semibold text-white">Reset your password</p>
              <p className="text-xs text-lk-dim mt-1">Enter your email and we'll send you a reset link.</p>
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              className={inputClass}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-lk-accent text-lk-bg font-semibold text-sm hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <button
              type="button"
              onClick={() => setMode('signIn')}
              className="w-full py-2 text-sm text-lk-dim hover:text-white transition"
            >
              ← Back to sign in
            </button>
          </form>
        ) : (
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

            {mode === 'signUp' && (
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Display name"
                className={inputClass}
              />
            )}

            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              className={inputClass}
            />
            <div className="relative">
              <input
                type="password"
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="Password"
                required
                className={inputClass}
              />
              {mode === 'signIn' && (
                <button
                  type="button"
                  onClick={() => setMode('forgotPassword')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-lk-dim hover:text-lk-accent transition"
                >
                  Forgot?
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-lk-accent text-lk-bg font-semibold text-sm hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Loading...' : mode === 'signUp' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-lk-text space-y-2">
          {mode === 'signIn' && (
            <p>
              Just joined the beta?{' '}
              <button type="button" onClick={() => setMode('signUp')} className="font-semibold text-white underline underline-offset-4">
                Create an account.
              </button>
            </p>
          )}
          {mode === 'signUp' && (
            <p>
              Already have an account?{' '}
              <button type="button" onClick={() => setMode('signIn')} className="font-semibold text-white underline underline-offset-4">
                Sign in.
              </button>
            </p>
          )}
          {mode !== 'forgotPassword' && (
            <p>Account creation only works for approved beta emails. If you're not approved yet, join the waitlist.</p>
          )}
        </div>

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
