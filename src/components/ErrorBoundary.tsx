import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { NepefyLogo } from './NepefyLogo';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[App ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-7 text-center space-y-4">
            <div className="flex justify-center pb-1">
              <NepefyLogo size="sm" showTagline={false} />
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-bold text-slate-900">Something went wrong</h1>
              <p className="text-xs text-slate-500 leading-relaxed">
                The interface encountered an unexpected error. Your balances and open orders remain safely stored on the server.
              </p>
              {this.state.message && (
                <p className="text-[11px] font-mono text-slate-400 pt-1 break-words">
                  {this.state.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-4 h-9 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Exchange</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
