'use client';

import { useState } from 'react';

type ApiResponse = { success?: boolean; message?: string; error?: string };

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();

    if (!normalized) {
      setStatus('error');
      setMessage('Enter a valid email address.');
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });

      const data = (await response.json()) as ApiResponse;
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Unable to join the waitlist.');
      }

      setStatus('success');
      setMessage(data.message || 'You’re on the waitlist. We’ll email you when beta spots open.');
      setEmail('');
    } catch (error: any) {
      setStatus('error');
      setMessage(error?.message || 'Unable to join the waitlist.');
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label htmlFor="waitlist-email" className="sr-only">Email</label>
      <input
        id="waitlist-email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="min-w-0 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-lk-accent/60 focus:ring-2 focus:ring-lk-accent/20"
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="rounded-2xl bg-lk-accent px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {status === 'loading' ? 'Joining...' : 'Join waitlist'}
      </button>
      {message ? (
        <p className={`sm:col-span-2 text-sm ${status === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
