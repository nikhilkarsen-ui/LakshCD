'use client';
import { useRouter } from 'next/navigation';
import LakshLogo from '@/components/LakshLogo';
import WaitlistForm from '@/components/WaitlistForm';

export default function WaitlistPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-lk-bg flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">

        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-lk-dim hover:text-lk-text transition-colors"
        >
          ← Back
        </button>

        <div className="text-center">
          <LakshLogo className="w-12 h-12 mx-auto mb-6 opacity-80" />
          <div className="text-xs uppercase tracking-[0.3em] text-lk-accent mb-3">Beta Access</div>
          <h1 className="text-2xl font-bold text-lk-text mb-3">Join the waitlist</h1>
          <p className="text-sm text-lk-dim leading-relaxed">
            Drop your email and we'll let you in when beta spots open. Everyone starts with $10,000 in the prize pool.
          </p>
        </div>

        <div className="rounded-2xl border border-lk-border bg-lk-card p-6">
          <WaitlistForm />
        </div>

        <div className="space-y-3 text-xs text-lk-dim">
          <div className="flex gap-2.5">
            <span className="text-lk-accent mt-0.5 flex-shrink-0">—</span>
            <span>Trade NBA player shares with $10,000 in virtual cash</span>
          </div>
          <div className="flex gap-2.5">
            <span className="text-lk-accent mt-0.5 flex-shrink-0">—</span>
            <span>Prices update in real time based on live game stats</span>
          </div>
          <div className="flex gap-2.5">
            <span className="text-lk-accent mt-0.5 flex-shrink-0">—</span>
            <span>Top portfolios share the prize pool on June 15, 2026</span>
          </div>
        </div>

      </div>
    </div>
  );
}
