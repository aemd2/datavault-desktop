import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Helps debug which dashboard block failed. */
  componentName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in dashboard sections so the whole app does not go blank.
 * Sentry can be wired in later; we log to console for now (see .cursor/skills/error-boundaries).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary][${this.props.componentName ?? "Unknown"}]`, {
      message: error.message,
      stack: errorInfo.componentStack,
    });
    // TODO: send to monitoring (e.g. Sentry) when configured.
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-6 rounded-lg border border-destructive/50 bg-destructive/10 text-center">
            <p className="text-destructive font-medium">Something went wrong</p>
            <p className="text-muted-foreground text-sm mt-1">
              This section failed to load. Try refreshing the page.
            </p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
