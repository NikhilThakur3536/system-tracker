'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  Copy,
  Info,
  RotateCw,
  X,
} from 'lucide-react';

// Shows whatever is stopping or slowing Activity Tracker, as reported by the
// main process (reportIssue in main/main.js):
//  - up to 3 toasts at the top right (errors stay until closed, warnings
//    close after 8s, info after 5s; repeats update the "xN" count),
//  - an "Issues" button at the bottom left with the recent issue log, so
//    problems that happened while the window was hidden can still be seen.
// It also reports errors from this window (uncaught errors and unhandled
// promise rejections) to the main process so they are logged the same way.

const MAX_VISIBLE_TOASTS = 3;
const MAX_ISSUES = 50;
const AUTO_HIDE_MS = { info: 5000, warning: 8000 }; // errors stay
const RENDERER_REPORT_COOLDOWN_MS = 30 * 1000;
const IGNORED_RENDERER_ERRORS = [/ResizeObserver loop/i];

const ACTION_LABELS = {
  'retry-sync': 'Retry now',
};

const SEVERITY_STYLES = {
  error: {
    Icon: AlertCircle,
    border: 'border-red-300 dark:border-red-800',
    header: 'bg-red-50 dark:bg-red-900/30',
    icon: 'text-red-500 dark:text-red-400',
    title: 'text-red-800 dark:text-red-300',
  },
  warning: {
    Icon: AlertTriangle,
    border: 'border-amber-300 dark:border-amber-700',
    header: 'bg-amber-50 dark:bg-amber-900/30',
    icon: 'text-amber-500 dark:text-amber-400',
    title: 'text-amber-800 dark:text-amber-300',
  },
  info: {
    Icon: Info,
    border: 'border-blue-200 dark:border-blue-800',
    header: 'bg-blue-50 dark:bg-blue-900/30',
    icon: 'text-blue-500 dark:text-blue-400',
    title: 'text-blue-800 dark:text-blue-300',
  },
};

function getStyles(severity) {
  return SEVERITY_STYLES[severity] || SEVERITY_STYLES.warning;
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function issueToText(issue) {
  return [
    issue.title,
    issue.message,
    issue.detail,
    `Time: ${new Date(issue.at).toLocaleString()}`,
    issue.count > 1 ? `Repeated ${issue.count} times` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where the Clipboard API is not allowed.
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
}

function CopyButton({ issue }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => setCopied(await copyText(issueToText(issue)))}
      className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : 'Copy details'}
    </button>
  );
}

function ActionButton({ issue }) {
  const label = ACTION_LABELS[issue.action];
  if (!label) return null;

  return (
    <button
      type="button"
      onClick={() => window?.electronAPI?.runAppIssueAction?.(issue.action)}
      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
    >
      <RotateCw className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function IssueToast({ issue, onClose }) {
  const styles = getStyles(issue.severity);
  const { Icon } = styles;

  return (
    <div
      role={issue.severity === 'error' ? 'alert' : 'status'}
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg border ${styles.border} overflow-hidden animate-slide-up`}
    >
      <div
        className={`${styles.header} px-4 py-2.5 flex items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-5 w-5 shrink-0 ${styles.icon}`} />
          <h3 className={`font-medium truncate ${styles.title}`}>
            {issue.title}
          </h3>
          {issue.count > 1 ? (
            <span className="shrink-0 rounded-full bg-gray-200 dark:bg-gray-700 px-2 text-xs text-gray-700 dark:text-gray-200">
              ×{issue.count}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {issue.message}
        </p>

        {issue.detail ? (
          <p className="mt-2 text-xs font-mono text-gray-500 dark:text-gray-400 break-words line-clamp-3">
            {issue.detail}
          </p>
        ) : null}

        <div className="mt-2 flex items-center gap-4">
          <span className="text-xs text-gray-400">
            {formatTime(issue.lastAt || issue.at)}
          </span>
          <CopyButton issue={issue} />
          <ActionButton issue={issue} />
        </div>
      </div>
    </div>
  );
}

function IssuesPanel({ issues, onClose, onClear }) {
  return (
    <div className="fixed bottom-16 left-4 z-[60] w-[calc(100%-2rem)] max-w-md max-h-[60vh] flex flex-col bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-medium text-gray-800 dark:text-gray-100">
          Recent issues
        </h3>
        <div className="flex items-center gap-3">
          {issues.length ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </div>

      <ul className="overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
        {issues.length === 0 ? (
          <li className="px-4 py-6 text-sm text-center text-gray-500">
            No issues. Everything is running normally.
          </li>
        ) : (
          issues.map((issue) => {
            const styles = getStyles(issue.severity);
            const { Icon } = styles;

            return (
              <li key={issue.key} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${styles.icon}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {issue.title}
                        {issue.count > 1 ? ` ×${issue.count}` : ''}
                      </p>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatTime(issue.lastAt || issue.at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      {issue.message}
                    </p>
                    {issue.detail ? (
                      <p className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 break-words line-clamp-2">
                        {issue.detail}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-4">
                      <CopyButton issue={issue} />
                      <ActionButton issue={issue} />
                    </div>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

const AppIssueToasts = () => {
  const [toasts, setToasts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const hideTimers = useRef({});
  const isPanelOpenRef = useRef(false);

  useEffect(() => {
    isPanelOpenRef.current = isPanelOpen;
    if (isPanelOpen) setUnseenCount(0);
  }, [isPanelOpen]);

  const dismissToast = useCallback((key) => {
    clearTimeout(hideTimers.current[key]);
    delete hideTimers.current[key];
    setToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  const showToast = useCallback(
    (issue) => {
      if (!issue || issue.silent) return;

      setToasts((current) =>
        [issue, ...current.filter((toast) => toast.key !== issue.key)].slice(
          0,
          MAX_VISIBLE_TOASTS
        )
      );

      const hideAfter = AUTO_HIDE_MS[issue.severity];
      if (hideAfter) {
        clearTimeout(hideTimers.current[issue.key]);
        hideTimers.current[issue.key] = setTimeout(
          () => dismissToast(issue.key),
          hideAfter
        );
      }
    },
    [dismissToast]
  );

  const handleIssue = useCallback(
    (issue) => {
      if (!issue?.key) return;

      setIssues((current) =>
        [issue, ...current.filter((item) => item.key !== issue.key)].slice(
          0,
          MAX_ISSUES
        )
      );

      if (issue.repeat) {
        // Same issue again: update the count on a visible toast, no new popup.
        setToasts((current) =>
          current.map((toast) => (toast.key === issue.key ? issue : toast))
        );
        return;
      }

      showToast(issue);
      if (!isPanelOpenRef.current) setUnseenCount((count) => count + 1);
    },
    [showToast]
  );

  // Listen for issues from the main process, then fetch the log and any
  // issues that happened before this window was ready.
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.onAppIssue) return;

    let cancelled = false;
    const unsubscribe = api.onAppIssue(handleIssue);

    api
      .appIssuesReady?.()
      .then((result) => {
        if (cancelled || !result) return;

        if (Array.isArray(result.recent)) {
          setIssues(result.recent.slice(0, MAX_ISSUES));
        }

        const pending = Array.isArray(result.pending) ? result.pending : [];
        pending.forEach(showToast);
        if (pending.length) setUnseenCount((count) => count + pending.length);
      })
      .catch(() => {});

    const timers = hideTimers.current;

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      Object.values(timers).forEach(clearTimeout);
    };
  }, [handleIssue, showToast]);

  // Report errors from this window to the main process.
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.reportRendererIssue) return;

    const lastSentAt = new Map();

    const send = (message, detail, options = {}) => {
      const text = String(message || 'Unknown error');
      if (IGNORED_RENDERER_ERRORS.some((pattern) => pattern.test(text))) return;

      const now = Date.now();
      const key = text.slice(0, 200);
      if (now - (lastSentAt.get(key) || 0) < RENDERER_REPORT_COOLDOWN_MS)
        return;
      lastSentAt.set(key, now);

      api.reportRendererIssue({ message: text, detail, ...options });
    };

    const handleError = (event) => {
      // Ignore failed image/script loads (they have no message).
      if (!event?.message) return;
      send(
        event.message,
        event.error?.stack ||
          `${event.filename || ''}:${event.lineno || ''}:${event.colno || ''}`
      );
    };

    const handleRejection = (event) => {
      const reason = event?.reason;
      // Often harmless (e.g. a cancelled request): log only, no popup.
      send(reason?.message || String(reason), reason?.stack || '', {
        severity: 'warning',
        silent: true,
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  const clearIssues = () => {
    setIssues([]);
    setUnseenCount(0);
    window?.electronAPI?.clearAppIssues?.();
  };

  return (
    <>
      {toasts.length ? (
        <div className="fixed top-4 right-4 z-[60] w-[calc(100%-2rem)] max-w-md flex flex-col gap-2">
          {toasts.map((issue) => (
            <IssueToast
              key={issue.key}
              issue={issue}
              onClose={() => dismissToast(issue.key)}
            />
          ))}
        </div>
      ) : null}

      {issues.length ? (
        <button
          type="button"
          onClick={() => setIsPanelOpen((open) => !open)}
          className="fixed bottom-4 left-4 z-[60] inline-flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-md px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Bell className="h-4 w-4" />
          Issues
          {unseenCount > 0 ? (
            <span className="rounded-full bg-red-500 text-white text-xs px-1.5">
              {unseenCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {isPanelOpen ? (
        <IssuesPanel
          issues={issues}
          onClose={() => setIsPanelOpen(false)}
          onClear={clearIssues}
        />
      ) : null}
    </>
  );
};

export default AppIssueToasts;
