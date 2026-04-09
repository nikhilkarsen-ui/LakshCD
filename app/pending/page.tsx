import Link from 'next/link';

export default function PendingPage() {
  return (
    <div className="min-h-screen bg-lk-bg text-white px-6 py-20">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-white/10 bg-white/5 p-10 shadow-2xl shadow-black/20">
        <p className="text-sm uppercase tracking-[0.35em] text-lk-accent">Pending approval</p>
        <h1 className="mt-4 text-4xl font-bold text-white">Your account has been created, but you haven’t been approved for the Laksh beta yet.</h1>
        <p className="mt-4 text-sm leading-6 text-lk-text">We’ll email you as soon as your access is ready.</p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Link href="/" className="inline-flex rounded-full bg-lk-accent px-7 py-3 text-sm font-semibold text-black transition hover:brightness-110">Back to home</Link>
          <Link href="/admin/waitlist" className="inline-flex rounded-full border border-white/10 bg-white/5 px-7 py-3 text-sm text-white transition hover:bg-white/10">Admin waitlist</Link>
        </div>
      </div>
    </div>
  );
}
