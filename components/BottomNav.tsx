'use client';
const tabs = [
  { id:'home', label:'Market', d:'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
  { id:'portfolio', label:'Portfolio', d:'M2 3h20v14H2zM8 21h8M12 17v4' },
  { id:'leaderboard', label:'Rankings', d:'M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z' },
  { id:'profile', label:'Profile', d:'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2' },
];
export default function BottomNav({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-lk-card border-t border-lk-border flex py-1.5">
      {tabs.map(t => {
        const a = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all ${a ? 'text-lk-accent' : 'text-lk-dim'}`}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d={t.d}/>{t.id === 'profile' && <circle cx="12" cy="7" r="4"/>}</svg>
            <span className={`text-[10px] ${a ? 'font-semibold' : ''}`}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
