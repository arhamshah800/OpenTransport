import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  readonly fallbackTitle?: string;
  readonly onReset?: () => void;
}

interface State {
  readonly error: Error | null;
}

/** Catches render/effect failures so a bad save or map init cannot blank the whole app. */
export class GameErrorBoundary extends Component<Props, State> {
  public state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('OpenTransport UI error', error, info.componentStack);
  }

  public render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-shell error-boundary-panel" role="alert">
        <p className="eyebrow">SOMETHING WENT WRONG</p>
        <h1>{this.props.fallbackTitle ?? 'Unable to open this city'}</h1>
        <p className="intro">{this.state.error.message}</p>
        <div className="level-actions">
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Return to levels
          </button>
        </div>
      </main>
    );
  }
}
