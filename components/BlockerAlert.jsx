'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const BlockerAlert = ({ alert }) => {
  const [isVisible, setIsVisible] = useState(true);
  const lastShownRef = useRef({ message: '', at: 0 });

  useEffect(() => {
    if (!alert) return;

    const now = Date.now();

    // The main process dedupes by reason; this also guards against duplicate
    // renderer listeners or repeated alerts with the same text.
    if (
      lastShownRef.current.message === alert.message &&
      now - lastShownRef.current.at < 30000
    ) {
      return;
    }

    lastShownRef.current = { message: alert.message, at: now };
    setIsVisible(true);

    const timeout = setTimeout(() => setIsVisible(false), 8000);
    return () => clearTimeout(timeout);
  }, [alert]);

  if (!alert || !isVisible) return null;

  return (
    <div className="fixed top-4 right-4 z-50 w-full max-w-md">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-amber-300 dark:border-amber-700 overflow-hidden">
        <div className="bg-amber-50 dark:bg-amber-900/30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            <h3 className="font-medium text-amber-800 dark:text-amber-300">
              Activity Tracker may be blocked
            </h3>
          </div>
          <button
            onClick={() => setIsVisible(false)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="p-4">
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {alert.message}
          </p>

          {alert.detail ? (
            <p className="mt-2 text-xs font-mono text-gray-500 dark:text-gray-400">
              {alert.detail}
            </p>
          ) : null}

          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            If tracking stops, check your antivirus or security software and
            allow Activity Tracker.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BlockerAlert;
