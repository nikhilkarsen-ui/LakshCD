'use client';
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'laksh_onboarded_v1';

const STEPS = [
  {
    icon: (
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#00d4aa" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
      </svg>
    ),
    title: "You start with $10,000 in virtual cash",
    body: "Every participant gets $10,000 in virtual cash to trade with. Your performance relative to other players determines your share of the real prize pool at season end on June 15.",
    sub: "Virtual money to trade with — real competition for real prizes.",
  },
  {
    icon: (
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#00d4aa" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Trade NBA player shares",
    body: "Buy shares in any of the 80 players on the market. Each player has a live price driven by their real stats and trading activity. Buy low, sell high — or hold until settlement.",
    sub: "Prices update every 5 seconds. Live games move prices in real time.",
  },
  {
    icon: (
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#00d4aa" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
      </svg>
    ),
    title: "Outperform to win",
    body: "On June 15, the prize pool is split based on your portfolio's performance relative to everyone else. The more you outperform, the bigger your share. Top performers take home more than they put in.",
    sub: "Your virtual portfolio is the scorecard — your real payout depends on how you rank.",
  },
];

export default function OnboardingModal({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay so the modal fades in after the app loads
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  function finish() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    onDone();
  }

  const isLast = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <div className={`fixed inset-0 z-[300] flex items-end sm:items-center justify-center transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={finish} />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-4 mb-6 sm:mb-0 bg-lk-card border border-lk-border rounded-2xl p-6 shadow-2xl">

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-lk-accent' : 'w-1.5 bg-lk-border'}`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-lk-accent/10 border border-lk-accent/20 flex items-center justify-center">
            {s.icon}
          </div>
        </div>

        {/* Content */}
        <h2 className="text-xl font-bold text-center mb-2">{s.title}</h2>
        <p className="text-sm text-lk-dim text-center leading-relaxed mb-2">{s.body}</p>
        <p className="text-xs text-lk-muted text-center leading-relaxed mb-6">{s.sub}</p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={finish}
            className="flex-1 py-2.5 rounded-xl border border-lk-border text-sm text-lk-dim hover:text-lk-text transition-colors"
          >
            Skip
          </button>
          <button
            onClick={() => isLast ? finish() : setStep(s => s + 1)}
            className="flex-1 py-2.5 rounded-xl bg-lk-accent text-lk-bg text-sm font-semibold hover:bg-lk-accent/90 transition-colors"
          >
            {isLast ? 'Start trading' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Mark as seen immediately — don't wait for the user to click through.
        // If we write only on dismiss, closing the tab mid-modal means the key
        // never gets saved and the modal reappears on every login.
        localStorage.setItem(STORAGE_KEY, '1');
        setShow(true);
      }
    } catch {}
  }, []);

  return { show, dismiss: () => setShow(false) };
}
