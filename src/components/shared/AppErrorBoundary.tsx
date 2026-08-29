import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearClientDataAndReload } from '../../lib/clientRecovery';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * The final client-side safety net. A render error should leave the user with
 * a recovery screen, not an empty document.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unknown render error' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Keep the page usable while retaining enough information to diagnose a
    // client-side regression from the browser console.
    console.error('QAtrial render error', error, errorInfo);
  }

  private clearCacheAndReload = () => {
    void clearClientDataAndReload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-surface-secondary flex items-center justify-center p-4">
          <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-lg">
            <h1 className="text-lg font-semibold text-text-primary">We couldn’t open this page</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Clear cached application data and reload to recover safely.
            </p>
            <p className="mt-3 rounded-md bg-surface-secondary px-3 py-2 text-left font-mono text-xs text-text-secondary" role="status">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={this.clearCacheAndReload}
              className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Clear cache & reload
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
