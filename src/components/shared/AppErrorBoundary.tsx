import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * The final client-side safety net. A render error should leave the user with
 * a recovery screen, not an empty document.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Intentionally do not rethrow. The recovery UI is the terminal state for
    // this render failure and prevents a render/crash loop.
  }

  private returnToProjects = () => {
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-surface-secondary flex items-center justify-center p-4">
          <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-lg">
            <h1 className="text-lg font-semibold text-text-primary">We couldn’t open this page</h1>
            <p className="mt-2 text-sm text-text-secondary">
              The application recovered safely. Return to your projects and try again.
            </p>
            <button
              type="button"
              onClick={this.returnToProjects}
              className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Return to projects
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
