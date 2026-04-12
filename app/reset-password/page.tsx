// Server component — provides the Suspense boundary so the client component
// using useSearchParams doesn't cause a prerender error.
import { Suspense } from 'react';
import ResetPasswordClient from './ResetPasswordClient';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordClient />
    </Suspense>
  );
}
