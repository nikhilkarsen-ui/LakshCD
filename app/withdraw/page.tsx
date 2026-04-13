'use client';
import { useRouter } from 'next/navigation';
import LakshLogo from '@/components/LakshLogo';

export default function WithdrawPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-lk-bg flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center space-y-6">

        <LakshLogo className="w-12 h-12 mx-auto opacity-60" />

        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-lk-dim mb-3">Withdrawals</div>
          <h1 className="text-2xl font-bold text-lk-text mb-3">Not available yet</h1>
          <p className="text-sm text-lk-dim leading-relaxed">
            Withdrawals aren't available during the beta — all balances are virtual cash used to test the platform. When Laksh launches with real money, withdrawals will be processed here.
          </p>
        </div>

        <div className="rounded-2xl border border-lk-border bg-lk-card p-5 text-left space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-lk-dim">What happens at launch</div>
          <div className="space-y-2 text-xs text-lk-dim leading-relaxed">
            <div className="flex gap-2">
              <span className="text-lk-accent mt-0.5">—</span>
              <span>Hold until season end (June 15, 2026) and receive your proportional share of the prize pool</span>
            </div>
            <div className="flex gap-2">
              <span className="text-lk-accent mt-0.5">—</span>
              <span>Exit early at any time at your current portfolio value, minus a 3% early exit fee</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => router.back()}
          className="w-full py-3.5 rounded-xl bg-lk-card border border-lk-border text-sm font-semibold text-lk-text hover:bg-lk-border/50 transition-colors"
        >
          ← Go Back
        </button>
      </div>
    </div>
  );
}
