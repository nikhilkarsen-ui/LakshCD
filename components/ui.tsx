'use client';
import React from 'react';

export const fmt = (v: number) => { const s = v < 0 ? '-' : ''; return s + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
export const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
export const fmtCompact = (v: number) => v >= 1e9 ? '$'+(v/1e9).toFixed(1)+'B' : v >= 1e6 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1e3 ? '$'+(v/1e3).toFixed(1)+'K' : '$'+v.toFixed(2);

const AC = ['bg-blue-900/60','bg-emerald-900/60','bg-purple-900/60','bg-amber-900/60','bg-cyan-900/60','bg-rose-900/60','bg-indigo-900/60','bg-teal-900/60'];
export function Avatar({ name, i = 0, sz = 'md' }: { name: string; i?: number; sz?: 'sm'|'md'|'lg' }) {
  const init = name.split(' ').map(n => n[0]).join('').slice(0,2);
  const c = { sm:'w-8 h-8 text-xs', md:'w-10 h-10 text-sm', lg:'w-14 h-14 text-lg' }[sz];
  return <div className={`${c} ${AC[i%AC.length]} rounded-xl flex items-center justify-center font-bold text-lk-text flex-shrink-0`}>{init}</div>;
}

export function Card({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <div onClick={onClick} className={`bg-lk-card border border-lk-border rounded-xl p-4 ${onClick ? 'cursor-pointer hover:bg-lk-hover transition-colors' : ''} ${className}`}>{children}</div>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold text-lk-dim tracking-wide uppercase mb-2">{children}</div>;
}

export function Skel({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-lk-border rounded-lg ${className}`} />;
}

export function Toast({ msg, type, onClose }: { msg: string; type: 'ok'|'err'; onClose: () => void }) {
  React.useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-xl text-sm font-semibold shadow-2xl animate-slide-up ${type === 'ok' ? 'bg-lk-accent text-lk-bg' : 'bg-lk-red text-white'}`}>{msg}</div>;
}

export function Badge({ positive }: { positive: boolean }) {
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${positive ? 'bg-lk-accent-dim text-lk-accent' : 'bg-lk-red-dim text-lk-red'}`}>{positive ? 'BUY' : 'SELL'}</span>;
}
