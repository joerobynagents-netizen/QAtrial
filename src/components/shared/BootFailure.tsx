import { useState } from 'react';
import { clearClientDataAndReload } from '../../lib/clientRecovery';

interface BootFailureProps {
  message: string;
}

/** A visible, self-service recovery state for errors before the app shell loads. */
export function BootFailure({ message }: BootFailureProps) {
  const [recovering, setRecovering] = useState(false);

  const recover = () => {
    setRecovering(true);
    void clearClientDataAndReload();
  };

  return (
    <main className="min-h-screen bg-surface-secondary flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-lg">
        <h1 className="text-lg font-semibold text-text-primary">We couldn’t open QAtrial</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Your browser could not complete startup. Clear its cached application data and try again.
        </p>
        <p className="mt-3 rounded-md bg-surface-secondary px-3 py-2 text-left font-mono text-xs text-text-secondary" role="status">
          {message}
        </p>
        <button
          type="button"
          onClick={recover}
          disabled={recovering}
          className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {recovering ? 'Clearing cache…' : 'Clear cache & reload'}
        </button>
      </section>
    </main>
  );
}
