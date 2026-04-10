'use client';
import { fmt } from './ui';
import LakshLogo from './LakshLogo';

export default function Header({ balance, onSignOut }: { balance: number; onSignOut: () => void }) {
  return (
    <header className="flex items-center justify-between px-5 py-4 border-b border-lk-border bg-lk-bg/95 backdrop-blur-xl sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <LakshLogo className="w-9 h-9" />
        <div>
          <div className="text-lg font-bold tracking-wider text-lk-text">Laksh</div>
          <div className="text-[9px] text-lk-dim tracking-[3px] uppercase -mt-0.5">The 24/7 Sports Market</div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-[10px] text-lk-dim">Balance</div>
          <div className="text-sm font-semibold text-lk-text">{fmt(balance)}</div>
        </div>
        <button onClick={onSignOut} className="text-lk-dim hover:text-lk-red transition-colors" title="Sign Out">
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        </button>
      </div>
    </header>
  );
}
