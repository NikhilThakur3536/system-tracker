const { contextBridge, ipcRenderer } = require('electron');

// Subscribe to a channel and return a function that removes exactly this
// listener, so React effects can clean up after themselves.
function subscribe(channel, callback) {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// For channels with a single consumer that registers again on every re-render
// or login (the interval getters): replace the previous listener instead of
// stacking a new one each time.
const singleListeners = {};

function subscribeSingle(channel, callback) {
  if (singleListeners[channel]) {
    ipcRenderer.removeListener(channel, singleListeners[channel]);
  }

  const listener = (_, value) => callback(value);
  singleListeners[channel] = listener;
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
    if (singleListeners[channel] === listener) delete singleListeners[channel];
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Device Id
  getDeviceId: () => ipcRenderer.send('get-device-id'),
  onDeviceId: (callback) =>
    ipcRenderer.once('device-id', (_, deviceId) => callback(deviceId)),

  // exit app
  exitApp: () => ipcRenderer.send('exit-app'),

  // Internet Connection
  notifyOffline: () => ipcRenderer.send('app-offline'),
  notifyOnline: () => ipcRenderer.send('app-online'),
  shouldNotRemoveTimer: () => ipcRenderer.invoke('should-not-remove-timer'),
  onSyncing: (callback) => subscribe('sync-processing', callback),
  removeSyncingListener: () =>
    ipcRenderer.removeAllListeners('sync-processing'),

  onSleepMode: (callback) => subscribe('windows-sleep-mode', callback),
  removeSleepModeListeners: () =>
    ipcRenderer.removeAllListeners('windows-sleep-mode'),

  // Renderer's Data
  sendScreenshotType: (data) => ipcRenderer.send('set-screenshot-type', data),
  sendUserData: (data) => {
    ipcRenderer.send('set-user-data', data);
  },
  sendActivityData: (data) => ipcRenderer.invoke('set-activity-data', data),

  sendOfflineActivityData: (data) =>
    ipcRenderer.invoke('offline-activity-data', data),

  getInitialStats: () => ipcRenderer.invoke('get-initial-stats'),
  startLogging: () => ipcRenderer.invoke('start-logging'),
  clearStoreStats: () => ipcRenderer.invoke('clear-store-stats'),
  restartLogging: () => ipcRenderer.invoke('restart-logging'),
  stopLogging: () => ipcRenderer.send('stop-logging'),
  onUpdateStats: (callback) => subscribe('update-stats', callback),

  // Getting geographical data
  getGeoLocation: () => ipcRenderer.invoke('get-location'),

  // Interval's data
  getCaptureInterval: (callback) => {
    const unsubscribe = subscribeSingle('capture-interval', callback);
    ipcRenderer.send('fetch-capture-interval');
    return unsubscribe;
  },
  getActivityInterval: (callback) => {
    const unsubscribe = subscribeSingle('activity-interval', callback);
    ipcRenderer.send('fetch-activity-interval');
    return unsubscribe;
  },
  getActivitySpeedLocationInterval: (callback) => {
    const unsubscribe = subscribeSingle(
      'activity-speed-location-interval',
      callback
    );
    ipcRenderer.send('fetch-activity-speed-location-interval');
    return unsubscribe;
  },
  getIdleTimeInterval: (callback) => {
    const unsubscribe = subscribeSingle('idle-time-interval', callback);
    ipcRenderer.send('fetch-idle-time-interval');
    return unsubscribe;
  },

  // Show tray alert
  showTrayAlert: () => ipcRenderer.send('show-tray-alert'),

  // Blocker / antivirus alerts (legacy channel, kept for compatibility)
  onBlockerAlert: (callback) => subscribe('blocker-alert', callback),
  removeBlockerAlertListener: () =>
    ipcRenderer.removeAllListeners('blocker-alert'),

  // In-app issue alerts (toasts + Issues panel)
  onAppIssue: (callback) => subscribe('app-issue', callback),
  appIssuesReady: () => ipcRenderer.invoke('app-issues-ready'),
  clearAppIssues: () => ipcRenderer.invoke('clear-app-issues'),
  reportRendererIssue: (data) =>
    ipcRenderer.send('report-renderer-issue', data),
  runAppIssueAction: (action) => ipcRenderer.send('app-issue-action', action),
});
