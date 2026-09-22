import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Top-level error boundary: a render error in any page shows a friendly fallback (with a reload)
 * instead of a blank white screen. Deliberately self-contained — it imports no app components, so
 * whatever failed can't take the fallback down with it.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
          <h1 className="font-serif text-xl">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app hit an unexpected error. Your data is safe — reloading usually fixes it.
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-3 max-h-40 overflow-auto rounded bg-muted p-2 text-left text-xs text-destructive">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
