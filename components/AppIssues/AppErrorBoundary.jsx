'use client';

import { Component } from 'react';
import { AlertCircle } from 'lucide-react';

// Catches render errors in the tracker screen. Without it, one error left a
// blank white window. Now the error is reported (logged + shown in the Issues
// panel) and the user gets a Reload button.
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      window?.electronAPI?.reportRendererIssue?.({
        message: error?.message || String(error),
        detail: `${error?.stack || ''}\n${info?.componentStack || ''}`.trim(),
      });
    } catch {
      // Reporting must never throw from the boundary.
    }
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-red-200 dark:border-red-900 p-8 text-center">
          <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <AlertCircle className="text-red-500" size={32} />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            Something went wrong in the tracker window
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Reload the window to continue. If this keeps happening, open Issues
            at the bottom left and copy the details for support.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-6 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            Reload window
          </button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
