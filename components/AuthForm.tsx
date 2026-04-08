'use client';
import { useState } from 'react';
import { Toast } from './ui';

export default function AuthForm({ onSignIn, onSignUp }: { onSignIn: (e:string,p:string) => Promise<any>; onSignUp: (e:string,p:string,n:string) => Promise<any> }) {
  const [mode, setMode] = useState<'login'|'signup'>('login');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{msg:string;type:'ok'|'err'}|null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!email||!pw) return; if (mode==='signup'&&!name) return;
    setLoading(true);
    try {
      const { error } = mode==='login' ? await onSignIn(email,pw) : await onSignUp(email,pw,name);
      if (error) setToast({msg:error.message,type:'err'});
      else if (mode==='signup') setToast({msg:'Account created! Check email.',type:'ok'});
    } catch(err:any) { setToast({msg:err.message,type:'err'}); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-lk-bg flex items-center justify-center px-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-lk-accent to-emerald-500 flex items-center justify-center mx-auto mb-4 text-lk-bg font-extrabold text-2xl shadow-lg shadow-lk-accent/20">L</div>
          <h1 className="text-2xl font-bold tracking-wider">Laksh</h1>
          <p className="text-xs text-lk-dim tracking-[3px] uppercase mt-1">The 24/7 Sports Exchange</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode==='signup' && <input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Display Name" className="w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50"/>}
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" className="w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50"/>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" className="w-full px-4 py-3 rounded-xl border border-lk-border bg-lk-card text-lk-text text-sm outline-none focus:border-lk-accent/50"/>
          <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl bg-lk-accent text-lk-bg font-semibold text-sm hover:brightness-110 disabled:opacity-50">{loading?'Loading...':mode==='login'?'Sign In':'Create Account'}</button>
        </form>
        <div className="text-center mt-6"><span className="text-xs text-lk-dim">{mode==='login'?"Don't have an account?":'Have an account?'}</span>
          <button onClick={()=>setMode(mode==='login'?'signup':'login')} className="text-xs text-lk-accent font-medium ml-1.5 hover:underline">{mode==='login'?'Sign Up':'Sign In'}</button>
        </div>
        <p className="mt-8 text-center text-[10px] text-lk-muted">Trade athlete futures. Start with $10,000 simulated funds.</p>
      </div>
    </div>
  );
}
