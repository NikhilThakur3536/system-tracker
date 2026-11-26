const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  powerMonitor,
  Tray,
  Menu,
  crashReporter,
} = require('electron');
const { machineIdSync } = require('node-machine-id');
//updates
const sharp = require('sharp');
const store = require('electron-settings');
const path = require('path');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const moment = require('moment');
const os = require('os');
const fs = require('fs');

const { spawn, execFile, execFileSync } = require('child_process');

// APP Name
app.setName('Activity Tracker - Digital Links');
app.setAppUserModelId('com.infoware-logger.123');

// ============= SINGLE INSTANCE LOCK =============
// Must run before any startup side effects (database, global keyboard hook,
// scroll helper, crash reporter). A second copy that loses the lock exits
// immediately so it cannot leave orphaned helper processes behind. The running
// copy is notified through the 'second-instance' event and shows its window.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  process.exit(0);
}

// API
const { default: axios } = require('axios');
const dns = require('dns');

// Every request from the main process gets a timeout so a stuck connection
// can't pile up pending requests. File uploads pass a longer timeout.
const API_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const CRASH_REPORT_TIMEOUT_MS = 5 * 1000;
axios.defaults.timeout = API_TIMEOUT_MS;

// Environment related set up
const IS_PRODUCTION = true;
const API_URL = `https://webtracker${IS_PRODUCTION ? 'dev' : ''}.infoware.xyz`;
const DOMAIN_TYPE = IS_PRODUCTION ? 'test' : 'test';

const domainId =
  DOMAIN_TYPE === 'production'
    ? 'a2ee38f6-507a-41ae-bbb4-72d2e17b29ed'
    : '2420feae-a698-4de9-9679-332bfbe1ba68';
const API_BASE_URL = `${API_URL}/api`;

const CRASH_REPORT_API = `${API_BASE_URL}/employee/v5/crash-report/add`;

const CRASH_MESSAGE =
  'Something went wrong! If Activity Tracker does not restart automatically, please open it manually.';

// ============= BLOCKER / ANTIVIRUS ALERTS =============

const BLOCKER_ALERT_COOLDOWN_MS = 3 * 60 * 1000;
const SECURITY_SCAN_DELAY_MS = 15 * 1000;
const SECURITY_SCAN_INTERVAL_MS = 10 * 60 * 1000;

// Windows Defender is on by default on almost every machine, so it is ignored
// unless this is switched on. Other security tools are reported once each.
const ALERT_ON_WINDOWS_DEFENDER = false;

const SECURITY_PROCESS_SIGNATURES = [
  {
    label: 'Windows Defender',
    names: ['msmpeng', 'msascui', 'securityhealth', 'windefend'],
  },
  {
    label: 'Quick Heal',
    names: ['quickheal', 'qhwatchdog', 'qhsafe', 'qhguard', 'qhwsc'],
  },
  { label: 'Kaspersky', names: ['avp', 'kaspersky', 'kavsvc'] },
  { label: 'Avast', names: ['avastui', 'avastsvc', 'aswidsagent'] },
  { label: 'AVG', names: ['avgui', 'avgwdsvc', 'avgsvc'] },
  { label: 'Norton', names: ['navw32', 'norton', 'ccsvchst'] },
  { label: 'McAfee', names: ['mcshield', 'mcupdmgr', 'masvc', 'mcuihost'] },
  { label: 'Bitdefender', names: ['bdagent', 'vsserv', 'bdservicehost'] },
  { label: 'ESET', names: ['egui', 'ekrn'] },
  { label: 'Sophos', names: ['sophosui', 'sophosfs', 'savservice'] },
  { label: 'Trend Micro', names: ['tmbmsrv', 'ntrtscan', 'tmccsf'] },
  { label: 'Panda', names: ['psctrl', 'pavsrv'] },
  { label: 'Avira', names: ['avguard', 'avgnt'] },
  { label: 'F-Secure', names: ['fshoster', 'fsorsp'] },
  { label: 'Malwarebytes', names: ['mbam', 'malwarebytes'] },
  { label: 'CrowdStrike Falcon', names: ['csfalconservice', 'falcon'] },
  { label: 'SentinelOne', names: ['sentinelagent', 'sentinelctl'] },
  { label: 'Cylance', names: ['cylance'] },
  { label: 'Webroot', names: ['wrsa', 'webroot'] },
  { label: 'K7 Security', names: ['k7tsmngr', 'k7avis'] },
  { label: 'eScan', names: ['escan', 'mwav'] },
  { label: 'FortiClient', names: ['forticlient', 'fortitray'] },
  { label: 'Zscaler', names: ['zscaler', 'zstatus'] },
  { label: 'TeamViewer', names: ['teamviewer'] },
  { label: 'AnyDesk', names: ['anydesk'] },
];

const DEFAULT_IGNORED_SECURITY_PROCESSES = [
  'msmpeng',
  'msascui',
  'securityhealthservice',
  'securityhealthsystray',
  'windefend',
];

const defenderProcesses = new Set([
  'msmpeng',
  'msascui',
  'securityhealthservice',
  'securityhealthsystray',
  'windefend',
]);

const blockerAlertHistory = new Map();
let securityScanInterval;

// Electron Related (declared here so the alert helpers can use them)
let mainWindow;
let tray;
app.isQuiting = false;

// ============= APP ISSUES (in-app toast alerts) =============
// reportIssue() is the single place that tells the user something is
// stopping or slowing Activity Tracker. Each issue is:
//  - kept in a small log (last 50, saved to issue-log.json) for the Issues
//    panel, so problems that happened while the window was hidden are visible,
//  - sent to the window as a toast ('app-issue'), or queued until the window
//    is ready (startup, reload after a crash),
//  - shown as a tray balloon only when asked for AND the window is hidden.
// The same issue id is shown at most once per cooldown; repeats inside the
// cooldown only bump its count ("x3") without a new popup.

const ISSUE_LOG_LIMIT = 50;
const MAX_PENDING_ISSUES = 10;
const ISSUE_LOG_SAVE_DELAY_MS = 2000;

const issueLog = []; // newest first
let pendingIssues = [];
let isRendererReadyForIssues = false;
let isIssueLogLoaded = false;
let issueLogSaveTimer = null;

function getIssueLogPath() {
  return path.join(app.getPath('userData'), 'issue-log.json');
}

function loadIssueLog() {
  if (isIssueLogLoaded) return;
  isIssueLogLoaded = true;

  try {
    const saved = JSON.parse(fs.readFileSync(getIssueLogPath(), 'utf8'));
    if (Array.isArray(saved)) {
      issueLog.push(
        ...saved
          .filter((issue) => issue && issue.key && issue.message)
          .slice(0, ISSUE_LOG_LIMIT)
      );
    }
  } catch (error) {
    // No saved log yet, or it is unreadable: start empty.
  }
}

function saveIssueLogSoon() {
  if (issueLogSaveTimer) return;

  issueLogSaveTimer = setTimeout(() => {
    issueLogSaveTimer = null;
    fs.writeFile(getIssueLogPath(), JSON.stringify(issueLog), (error) => {
      if (error) console.error('Failed to save issue log:', error);
    });
  }, ISSUE_LOG_SAVE_DELAY_MS);
}

function saveIssueLogSync() {
  if (issueLogSaveTimer) {
    clearTimeout(issueLogSaveTimer);
    issueLogSaveTimer = null;
  }

  try {
    fs.writeFileSync(getIssueLogPath(), JSON.stringify(issueLog));
  } catch (error) {
    console.error('Failed to save issue log:', error);
  }
}

function deliverIssue(issue) {
  if (
    isRendererReadyForIssues &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  ) {
    try {
      mainWindow.webContents.send('app-issue', issue);
      return;
    } catch (error) {
      console.error('Failed to send issue to renderer:', error);
    }
  }

  // Window not ready: keep it for when the window asks for pending issues.
  pendingIssues = [
    ...pendingIssues.filter((pending) => pending.key !== issue.key),
    issue,
  ].slice(-MAX_PENDING_ISSUES);
}

function isMainWindowVisible() {
  try {
    return Boolean(
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    );
  } catch (error) {
    return false;
  }
}

/**
 * Tell the user about something that stops or slows the app.
 * @param {object} issue
 * @param {string} issue.id        Stable id, used for cooldown and repeats.
 * @param {'info'|'warning'|'error'} [issue.severity]
 * @param {string} issue.title
 * @param {string} issue.message
 * @param {string} [issue.detail]  Technical detail (shown small, copyable).
 * @param {boolean} [issue.once]   Show only once per app run.
 * @param {boolean} [issue.balloon] Also show a tray balloon if window hidden.
 * @param {boolean} [issue.silent] Log it in the Issues panel without a toast.
 * @param {string} [issue.action]  Optional action id (e.g. 'retry-sync').
 * @param {number} [issue.cooldownMs]
 */
function reportIssue({
  id,
  severity = 'warning',
  title,
  message,
  detail = '',
  once = false,
  balloon = false,
  silent = false,
  action = null,
  cooldownMs = BLOCKER_ALERT_COOLDOWN_MS,
}) {
  try {
    loadIssueLog();

    const now = Date.now();
    const lastAlertedAt = blockerAlertHistory.get(id);

    if (lastAlertedAt && (once || now - lastAlertedAt < cooldownMs)) {
      if (once) return;

      // Repeat inside the cooldown: count it, no new popup.
      const existing = issueLog.find((issue) => issue.id === id);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
        existing.lastAt = now;
        if (detail) existing.detail = String(detail);
        saveIssueLogSoon();
        deliverIssue({ ...existing, repeat: true });
      }
      return;
    }

    blockerAlertHistory.set(id, now);

    const issue = {
      key: `${id}:${now}`,
      id,
      severity,
      title: String(title || 'Activity Tracker'),
      message: String(message || ''),
      detail: detail ? String(detail) : '',
      at: now,
      lastAt: now,
      count: 1,
      silent: Boolean(silent),
      action,
    };

    issueLog.unshift(issue);
    issueLog.length = Math.min(issueLog.length, ISSUE_LOG_LIMIT);
    saveIssueLogSoon();

    console.warn(`[issue:${severity}] ${issue.title}: ${issue.message}`);

    if (balloon && !silent && tray && !tray.isDestroyed()) {
      if (!isMainWindowVisible()) {
        tray.displayBalloon({
          iconType: severity === 'info' ? 'info' : severity,
          title: issue.title,
          content: issue.detail
            ? `${issue.message} ${issue.detail}`
            : issue.message,
        });
      }
    }

    deliverIssue(issue);
  } catch (error) {
    // Reporting must never crash the app.
    console.error('Failed to report issue:', error);
  }
}

// Kept for the existing call sites (blocked helper, screen capture, security
// software, crashes). Same cooldown/once behaviour as before.
function notifyBlocker(reason, message, options = {}) {
  const {
    detail = '',
    once = false,
    balloon = true,
    severity = 'warning',
    title = 'Activity Tracker may be blocked',
  } = options;

  reportIssue({
    id: reason,
    severity,
    title,
    message,
    detail,
    once,
    balloon,
  });
}

// Short, readable reason for a failed request (shown as toast detail).
function describeError(error) {
  if (!error) return 'Unknown error';
  if (error.response?.status)
    return `Server responded ${error.response.status}`;
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
    return 'Request timed out';
  }
  if (error.code) return `${error.code}: ${error.message}`;
  return error.message || String(error);
}

function getRunningProcessNames() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile(
        'tasklist',
        ['/FO', 'CSV', '/NH'],
        { timeout: 10000, windowsHide: true },
        (error, stdout) => {
          if (error) return resolve([]);

          resolve(
            stdout
              .split(/\r?\n/)
              .map((line) =>
                line.split(',')[0]?.replace(/"/g, '').trim().toLowerCase()
              )
              .filter(Boolean)
          );
        }
      );
      return;
    }

    execFile('ps', ['-axo', 'comm='], { timeout: 10000 }, (error, stdout) => {
      if (error) return resolve([]);

      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => path.basename(line.trim()).toLowerCase())
          .filter(Boolean)
      );
    });
  });
}

async function checkForBlockingSoftware() {
  const runningProcesses = await getRunningProcessNames();
  if (!runningProcesses.length) return;

  const ignoredProcesses = new Set(
    ALERT_ON_WINDOWS_DEFENDER
      ? DEFAULT_IGNORED_SECURITY_PROCESSES.filter(
          (name) => !defenderProcesses.has(name)
        )
      : DEFAULT_IGNORED_SECURITY_PROCESSES
  );

  for (const { label, names } of SECURITY_PROCESS_SIGNATURES) {
    const matched = runningProcesses.find((processName) => {
      const normalized = processName.replace(/\.exe$/, '').toLowerCase();

      if (ignoredProcesses.has(normalized)) return false;

      return names.some((name) => normalized.startsWith(name));
    });

    if (matched) {
      notifyBlocker(
        `security-software:${label}`,
        `${label} is running and may be blocking Activity Tracker.`,
        { once: true }
      );
    }
  }
}

// ============= RESTART GUARD =============
// All automatic relaunches go through requestRelaunch() so a crash that keeps
// repeating cannot turn into an endless restart loop.

const MAX_AUTO_RESTARTS = 3;
const AUTO_RESTART_WINDOW_MS = 10 * 60 * 1000;
const AUTO_RESTART_BASE_DELAY_MS = 5 * 1000;

// Child process exit reasons that mean something actually went wrong.
// 'clean-exit' (normal shutdown of a helper) and 'memory-eviction' are excluded.
const RELAUNCH_CHILD_PROCESS_REASONS = new Set([
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
]);

let isRelaunchScheduled = false;

function getRestartHistoryPath() {
  return path.join(app.getPath('userData'), 'restart-history.json');
}

function readRecentRestarts() {
  try {
    const history = JSON.parse(
      fs.readFileSync(getRestartHistoryPath(), 'utf8')
    );
    if (!Array.isArray(history)) return [];

    const cutoff = Date.now() - AUTO_RESTART_WINDOW_MS;
    return history.filter((entry) => entry && entry.at >= cutoff);
  } catch (error) {
    return [];
  }
}

// Read on the next start so the user is told why the app restarted.
function getRestartNoticePath() {
  return path.join(app.getPath('userData'), 'restart-notice.json');
}

function writeRestartNotice(reason) {
  try {
    fs.writeFileSync(
      getRestartNoticePath(),
      JSON.stringify({ at: Date.now(), reason })
    );
  } catch (error) {
    console.error('Failed to write restart notice:', error);
  }
}

const RESTART_REASON_LABELS = {
  'renderer-oom': 'the tracker window ran out of memory',
  'repeated-errors': 'repeated unexpected errors',
};

function describeRestartReason(reason = '') {
  if (RESTART_REASON_LABELS[reason]) return RESTART_REASON_LABELS[reason];
  if (reason.startsWith('child-process-gone:')) {
    const [, type, why] = reason.split(':');
    return `a background component (${type}) stopped: ${why}`;
  }
  return reason || 'an unexpected problem';
}

function reportRestartNoticeIfAny() {
  let notice;
  try {
    notice = JSON.parse(fs.readFileSync(getRestartNoticePath(), 'utf8'));
    fs.unlinkSync(getRestartNoticePath());
  } catch (error) {
    return; // No restart happened.
  }

  // Ignore stale notices (e.g. the relaunch never completed).
  if (!notice?.at || Date.now() - notice.at > AUTO_RESTART_WINDOW_MS) return;

  reportIssue({
    id: 'auto-restarted',
    severity: 'info',
    title: 'Activity Tracker restarted',
    message: `Activity Tracker restarted automatically because ${describeRestartReason(
      notice.reason
    )}.`,
    detail: `Reason code: ${notice.reason}`,
  });
}

function writeRestartHistory(history) {
  try {
    fs.writeFileSync(getRestartHistoryPath(), JSON.stringify(history));
  } catch (error) {
    console.error('Failed to write restart history:', error);
  }
}

/**
 * Schedule a controlled relaunch of the whole app.
 * Returns false (and does nothing) if the app is quitting, a relaunch is
 * already pending, or the restart limit was reached.
 */
function requestRelaunch(reason) {
  if (app.isQuiting || isRelaunchScheduled) return false;

  const recentRestarts = readRecentRestarts();

  if (recentRestarts.length >= MAX_AUTO_RESTARTS) {
    console.error(
      `Auto restart skipped (${reason}): ${recentRestarts.length} restarts in the last 10 minutes.`
    );
    notifyBlocker(
      'restart-limit',
      'Activity Tracker keeps crashing, so automatic restart is paused. Please close and reopen it, and check your antivirus or security software.',
      { detail: `Last reason: ${reason}` }
    );
    return false;
  }

  isRelaunchScheduled = true;
  writeRestartHistory([...recentRestarts, { at: Date.now(), reason }]);
  writeRestartNotice(reason);

  // 5s, 10s, 20s: back off when crashes repeat.
  const delay = AUTO_RESTART_BASE_DELAY_MS * 2 ** recentRestarts.length;

  setTimeout(() => {
    try {
      flushStatsSync();
      saveIssueLogSync();
      app.isQuiting = true;
      stopScrollTracker();
      stopKeyboardListener();
      if (tray && !tray.isDestroyed()) tray.destroy();
      app.relaunch();
    } catch (error) {
      console.error('Failed to relaunch:', error);
    } finally {
      app.exit(0);
    }
  }, delay);

  return true;
}

// ============= CRASH REPORTING SETUP =============

crashReporter.start({
  productName: 'Activity Tracker',
  companyName: 'Digital Links',
  submitURL: CRASH_REPORT_API,
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
  rateLimit: true,
  compress: true,
});

// Function to get system info
function getSystemInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    osType: os.type(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpuModel: os.cpus()[0]?.model || 'unknown',
    cpuCores: os.cpus().length,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
  };
}

// The same crash type + message is reported at most once per 10 minutes, so a
// repeating error can't turn into a flood of network requests.
const CRASH_REPORT_COOLDOWN_MS = 10 * 60 * 1000;
const crashReportHistory = new Map();

function shouldSendCrashReport(crashType, errorMessage) {
  const key = `${crashType}:${errorMessage}`;
  const now = Date.now();
  const lastSentAt = crashReportHistory.get(key);

  if (lastSentAt && now - lastSentAt < CRASH_REPORT_COOLDOWN_MS) return false;

  // Keep the map small: drop expired entries.
  for (const [entryKey, sentAt] of crashReportHistory) {
    if (now - sentAt >= CRASH_REPORT_COOLDOWN_MS) {
      crashReportHistory.delete(entryKey);
    }
  }

  crashReportHistory.set(key, now);
  return true;
}

async function sendCrashReport(crashType, error, additionalInfo = {}) {
  const crashData = {
    error: {
      message: error?.message || String(error),
      stack: error?.stack || 'No stack trace available',
      name: error?.name || 'UnknownError',
    },
    systemInfo: getSystemInfo(),
    appState: {
      isLogging: global.isLogging || false,
      isOffline: global.isOffline || false,
      authToken: global.authToken ? 'present' : 'missing',
      ownerId: global.ownerId || 'not set',
    },
    ...additionalInfo,
  };

  const errorMessage = error?.message || String(error);

  if (!shouldSendCrashReport(crashType, errorMessage)) return crashData;

  try {
    await axios.post(
      CRASH_REPORT_API,
      {
        crashType,
        errorMessage,
        report: crashData,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: CRASH_REPORT_TIMEOUT_MS,
      }
    );
    console.log('Crash report sent to server');
  } catch (error) {}

  return crashData;
}

// Uncaught errors no longer pass silently: they are reported, shown as a
// toast, and if they keep happening (5 within a minute) the app does a
// controlled restart through the restart guard instead of limping on.
const REPEATED_ERROR_LIMIT = 5;
const REPEATED_ERROR_WINDOW_MS = 60 * 1000;
let recentUncaughtErrors = [];

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);

  // Not awaited: reporting must not block the handler.
  sendCrashReport('main-uncaught-exception', error);

  if (app.isQuiting) return;

  reportIssue({
    id: 'main-uncaught-exception',
    severity: 'error',
    title: 'Activity Tracker hit an unexpected error',
    message:
      'Something went wrong in the background. Tracking continues, but if this keeps happening the app will restart itself.',
    detail: error?.stack || error?.message || String(error),
  });

  const now = Date.now();
  recentUncaughtErrors = [
    ...recentUncaughtErrors.filter((at) => now - at < REPEATED_ERROR_WINDOW_MS),
    now,
  ];

  if (recentUncaughtErrors.length >= REPEATED_ERROR_LIMIT) {
    recentUncaughtErrors = [];
    requestRelaunch('repeated-errors');
  }
});

process.on('unhandledRejection', async (reason, promise) => {
  // Convert non-Error types to Error
  const error = reason instanceof Error ? reason : new Error(String(reason));

  const skipErrors = ['EPERM', 'EACCES', 'ENOENT'];

  if (
    skipErrors.includes(error.code) ||
    /electron-settings/i.test(error.stack || '') ||
    /settings\.json/i.test(error.path || '')
  ) {
    return;
  }

  console.error('Unhandled Rejection at:', promise, 'reason:', reason);

  // Listed in the Issues panel without a popup: these are often harmless.
  reportIssue({
    id: `main-unhandled-rejection:${String(error.message).slice(0, 80)}`,
    severity: 'warning',
    title: 'A background task failed',
    message: error.message || 'Unknown error',
    detail: error.stack || '',
    silent: true,
  });

  await sendCrashReport('main-unhandled-rejection', error, {
    promise: String(promise),
  });
});

// Command line functions for performance efficiency.
app.disableHardwareAcceleration();

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=2048');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Device ID
// machineIdSync reads the Windows registry; if that is blocked it throws, and
// at this point that would stop the app from starting. Fall back to a stored
// random id instead (only used on machines where the lookup fails).
function getDeviceId() {
  try {
    return machineIdSync(true);
  } catch (error) {
    console.error('Failed to read machine id, using fallback id:', error);

    try {
      let fallbackId = store.getSync('fallbackDeviceId');
      if (!fallbackId) {
        fallbackId = require('crypto').randomUUID();
        store.setSync('fallbackDeviceId', fallbackId);
      }
      return fallbackId;
    } catch (storeError) {
      console.error('Failed to store fallback device id:', storeError);
      return require('crypto').randomUUID();
    }
  }
}

const deviceId = getDeviceId();

ipcMain.on('get-device-id', (event) => {
  event.reply('device-id', deviceId);
});

// Offline & Online
let isOffline = false;

// Renderer Data
let isLogging = false;
let screenshotInterval;
let appWebsiteDetailsInterval;

const DEFAULT_SCREENSHOT_TYPE = 'SCREENSHOT';
const DEFAULT_CAPTURE_INTERVAL = 10;
const DEFAULT_APP_WEBSITE_DETAILS_INTERVAL = 10;

const DEFAULT_ACTIVITY_INTERVAL = 1;
const DEFAULT_ACTIVITY_SPEED_LOCATION_INTERVAL = 1800;
const DEFAULT_IDLE_TIME_INTERVAL = 10;

let screenshotType = DEFAULT_SCREENSHOT_TYPE;

let captureIntervalMinutes;
let appWebsiteDetailsMinutes;
let activityIntervalMinutes;
let activitySpeedLocationInterval;
let idleTimeInterval;

// Activities
let clickCount = 0;
let scrollCount = 0;
let keyCount = 0;
let accumulatedText = '';

// Last Activity time
let lastActivityTime = Date.now();

let ownerId = null;
let authToken = null;

// Active window tracking
let lastActiveWindow = null;
let appWebsites = [];
let appWebsiteDetails = [];
let lastAppWebsiteDetails = [];

// Stats

let initialStats = {
  clickCount: 0,
  scrollCount: 0,
  keyCount: 0,
  accumulatedText: '',
  lastActive: '',
  appWebsites: [],
  appWebsiteDetails: [],
};

let stats = initialStats;

// Offline Database and syncing

const Database = require('better-sqlite3');

const OFFLINE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS offlineStats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ownerId TEXT,
    projectTaskActivityId TEXT,
    appWebsites TEXT,
    mouseClick INTEGER,
    scroll INTEGER,
    keystroke INTEGER,
    keyPressed TEXT,
    intervalStartTime TEXT,
    intervalEndTime TEXT,
    timezone TEXT
  );

  CREATE TABLE IF NOT EXISTS offlineScreenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    authToken TEXT,
    ownerId TEXT,
    screenshotTakenTime TEXT,
    fileName TEXT,
    screenshotBlob BLOB
  );

  CREATE TABLE IF NOT EXISTS offlineAppWebsiteDetails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    authToken TEXT,
    ownerId TEXT,
    fileName NUMBER,
    appWebsiteDetailsJSON TEXT
  );
`;

// Error codes that mean the file itself is damaged (not just busy/locked).
const CORRUPT_DB_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB']);

function openDatabaseAt(dbPath) {
  const database = new Database(dbPath);

  try {
    // WAL keeps writes from blocking reads and is more robust to crashes.
    database.pragma('journal_mode = WAL');
  } catch (error) {
    console.error('Could not enable WAL mode:', error);
  }

  database.exec(OFFLINE_TABLES_SQL);
  return database;
}

function moveCorruptDatabaseAside(dbPath) {
  const suffix = `.corrupt-${Date.now()}`;

  ['', '-wal', '-shm'].forEach((ext) => {
    const file = `${dbPath}${ext}`;
    if (fs.existsSync(file)) fs.renameSync(file, `${file}${suffix}`);
  });
}

// A locked or damaged data.db used to stop the app from starting. Now:
//  - damaged file: it is renamed (kept for recovery) and a fresh one created,
//  - any other failure: an in-memory database is used for this run, so
//    tracking keeps working (offline data is not kept across restarts).
function openOfflineDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'data.db');

  try {
    return openDatabaseAt(dbPath);
  } catch (error) {
    console.error('Failed to open offline database:', error);

    if (CORRUPT_DB_CODES.has(error?.code)) {
      try {
        moveCorruptDatabaseAside(dbPath);
        const database = openDatabaseAt(dbPath);

        reportIssue({
          id: 'database-recreated',
          severity: 'warning',
          title: 'Offline storage was repaired',
          message:
            'The offline data file was damaged, so a new one was created. Offline data saved before this may be missing.',
          detail: error.message,
        });

        return database;
      } catch (retryError) {
        console.error('Failed to recreate offline database:', retryError);
      }
    }

    reportIssue({
      id: 'database-unavailable',
      severity: 'error',
      title: 'Offline storage is not available',
      message:
        'Activity Tracker could not open its offline data file. Tracking continues, but data recorded while offline will not be kept if the app closes.',
      detail: error?.message,
    });

    return openDatabaseAt(':memory:');
  }
}

const db = openOfflineDatabase();

function closeOfflineDatabase() {
  try {
    if (db.open) db.close();
  } catch (error) {
    console.error('Failed to close offline database:', error);
  }
}

let shouldNotRemoveTimer = false;

ipcMain.handle('should-not-remove-timer', async () => {
  return shouldNotRemoveTimer;
});

// Offline sync uploads in small batches so a long offline period can't load
// every stored screenshot into memory at once. Only one sync runs at a time.
const OFFLINE_SCREENSHOT_BATCH_SIZE = 5;
const OFFLINE_APP_DETAILS_BATCH_SIZE = 20;

let offlineSyncPromise = null;

function syncOfflineData() {
  // 'app-online' can fire several times in a row; reuse the running sync
  // instead of uploading the same rows twice.
  if (!offlineSyncPromise) {
    offlineSyncPromise = runOfflineSync()
      .catch((error) => {
        console.error('Offline sync failed:', error);
      })
      .finally(() => {
        offlineSyncPromise = null;
      });
  }

  return offlineSyncPromise;
}

function safeParseJSON(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function deleteRowsAndResetSequence(table, ids) {
  // Table names are fixed strings from this file, never user input.
  const deleteRow = db.prepare(`DELETE FROM ${table} WHERE id = ?`);

  db.transaction((rowIds) => {
    rowIds.forEach((id) => deleteRow.run(id));
  })(ids);

  const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
  if (count === 0) {
    db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
  }
}

async function getSignedUrls(authToken, files) {
  const response = await axios.post(
    `${API_BASE_URL}/employee/v5/media/generate-multiple-signed-urls`,
    { ownerId, files },
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const signedUrls = response?.data?.urls?.map((url) => url?.signedUrl);

  if (
    !Array.isArray(signedUrls) ||
    signedUrls.length !== files.length ||
    signedUrls.some((url) => typeof url !== 'string')
  ) {
    throw new Error('Signed URL response did not match the requested files');
  }

  return signedUrls;
}

async function addMedia(authToken, medias) {
  await axios.post(
    `${API_BASE_URL}/employee/v5/media/add`,
    { ownerId, medias },
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function syncOfflineStats(authToken) {
  const statsRows = db.prepare('SELECT * FROM offlineStats').all();
  if (!statsRows.length) return;

  sendToRenderer('sync-processing', true);
  shouldNotRemoveTimer = true;

  try {
    const filteredProjectTaskActivityDetails = statsRows.filter(
      (row) => row?.mouseClick >= 0 && row?.keystroke >= 0 && row?.scroll >= 0
    );

    const projectTaskActivityDetails = filteredProjectTaskActivityDetails.map(
      (row) => {
        let startTime = row.intervalStartTime;
        const endTime = row.intervalEndTime;

        const isEpochStartTime =
          startTime &&
          !isNaN(new Date(startTime).getTime()) &&
          new Date(startTime).getTime() === 0;

        if (isEpochStartTime && endTime) {
          const calculatedStartTime = new Date(
            new Date(endTime).getTime() -
              (activityIntervalMinutes || DEFAULT_ACTIVITY_INTERVAL) * 60 * 1000
          );

          startTime = calculatedStartTime.toISOString();
        }

        return {
          projectTaskActivityId: row.projectTaskActivityId,
          mouseClick: row.mouseClick ?? 0,
          keystroke: row.keystroke ?? 0,
          keyPressed: row.keyPressed ?? '',
          scroll: row.scroll ?? 0,
          appWebsites: safeParseJSON(row.appWebsites, []),
          startTime: startTime ?? '',
          endTime: endTime ?? '',
          timezone: row.timezone || 'unknown',
        };
      }
    );

    if (projectTaskActivityDetails.length > 0) {
      const payload = {
        ownerId:
          ownerId || (await store.get('ownerId')) || statsRows[0]?.ownerId,
        projectTaskActivityDetails,
        deviceId,
      };

      await axios.post(
        `${API_BASE_URL}/employee/v5/project/project/task/activity/detail/add/bulk`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Remove synced rows
      deleteRowsAndResetSequence(
        'offlineStats',
        statsRows.map((row) => row.id)
      );
    }
  } catch (err) {
    console.error('Failed to sync stats row:', err);
    reportOfflineSyncFailure('activity records', statsRows.length, err);
  } finally {
    sendToRenderer('sync-processing', false);
  }
}

async function syncOfflineScreenshots(authToken) {
  const fileType = 'image/png';
  // Read ids first (no image data), then load images one batch at a time.
  const pendingRows = db
    .prepare('SELECT id FROM offlineScreenshots ORDER BY id')
    .all();
  const selectBatch = db.prepare(
    'SELECT * FROM offlineScreenshots WHERE id >= ? ORDER BY id LIMIT ?'
  );

  let processed = 0;
  let nextId = pendingRows[0]?.id;

  while (processed < pendingRows.length && nextId !== undefined) {
    const batch = selectBatch.all(nextId, OFFLINE_SCREENSHOT_BATCH_SIZE);
    if (!batch.length) break;

    try {
      const signedUrls = await getSignedUrls(
        authToken,
        batch.map((row) => ({ fileType, fileName: row.fileName }))
      );

      await Promise.all(
        batch.map((row, idx) =>
          axios.put(signedUrls[idx], row.screenshotBlob, {
            headers: { 'Content-Type': fileType },
            timeout: UPLOAD_TIMEOUT_MS,
          })
        )
      );

      await addMedia(
        authToken,
        batch.map((row, idx) => ({
          url: signedUrls[idx].split('?')[0],
          type: fileType,
          createdAt: new Date(row.screenshotTakenTime).toISOString(),
        }))
      );

      deleteRowsAndResetSequence(
        'offlineScreenshots',
        batch.map((row) => row.id)
      );
    } catch (err) {
      // Keep this and later batches for the next sync.
      console.error('Failed to sync screenshot rows:', err);
      reportOfflineSyncFailure(
        'screenshots',
        pendingRows.length - processed,
        err
      );
      return;
    }

    processed += batch.length;
    nextId = batch[batch.length - 1].id + 1;
  }
}

async function syncOfflineAppWebsiteDetails(authToken) {
  const fileType = 'application/json';
  const rows = db.prepare('SELECT * FROM offlineAppWebsiteDetails').all();

  for (let i = 0; i < rows.length; i += OFFLINE_APP_DETAILS_BATCH_SIZE) {
    const batch = rows.slice(i, i + OFFLINE_APP_DETAILS_BATCH_SIZE);

    try {
      const signedUrls = await getSignedUrls(
        authToken,
        batch.map((row) => ({ fileType, fileName: row.fileName }))
      );

      await Promise.all(
        batch.map((row, idx) =>
          axios.put(signedUrls[idx], row.appWebsiteDetailsJSON, {
            headers: { 'Content-Type': fileType },
            timeout: UPLOAD_TIMEOUT_MS,
          })
        )
      );

      await addMedia(
        authToken,
        batch.map((_, idx) => ({
          url: signedUrls[idx].split('?')[0],
          type: 'text/plain',
        }))
      );

      deleteRowsAndResetSequence(
        'offlineAppWebsiteDetails',
        batch.map((row) => row.id)
      );
    } catch (err) {
      console.error('Failed to sync app website details rows:', err);
      reportOfflineSyncFailure('app usage records', rows.length - i, err);
      return;
    }
  }
}

function reportOfflineSyncFailure(what, count, error) {
  reportIssue({
    id: 'offline-sync-failed',
    severity: 'warning',
    title: 'Offline data not uploaded yet',
    message: `Could not upload ${count} saved ${what}. They are kept on this computer and will be retried.`,
    detail: describeError(error),
    action: 'retry-sync',
  });
}

async function runOfflineSync() {
  const authToken = await store.get('authToken');

  await syncOfflineStats(authToken);
  await syncOfflineScreenshots(authToken);
  await syncOfflineAppWebsiteDetails(authToken);
}

ipcMain.on('set-user-data', async (event, data) => {
  try {
    authToken = data.authToken;
    if (authToken) {
      await store.set('authToken', authToken);
      await fetchCaptureInterval();
    }
  } catch (error) {
    console.error('Failed to set user data:', error);
    event.reply('set-user-data-error', {
      success: false,
      error: error.message,
    });
  }
});

ipcMain.handle('set-activity-data', async (event, data) => {
  try {
    ownerId = data.ownerId;
    await store.set('ownerId', ownerId);

    return { success: true };
  } catch (error) {
    console.error('Failed to set activity data:', error);
    return { success: false, error: error.message };
  }
});

// Function to fetch capture interval from API
ipcMain.on('fetch-capture-interval', async (event) => {
  event.sender.send(
    'capture-interval',
    captureIntervalMinutes || DEFAULT_CAPTURE_INTERVAL
  );
});

// Function to fetch activity interval from API
ipcMain.on('fetch-activity-interval', async (event) => {
  event.sender.send(
    'activity-interval',
    activityIntervalMinutes || DEFAULT_ACTIVITY_INTERVAL
  );
});

// Function to fetch speed activity interval from API
ipcMain.on('fetch-activity-speed-location-interval', async (event) => {
  event.sender.send(
    'activity-speed-location-interval',
    activitySpeedLocationInterval || DEFAULT_ACTIVITY_SPEED_LOCATION_INTERVAL
  );
});

// Function to fetch idle time interval from API
ipcMain.on('fetch-idle-time-interval', async (event) => {
  event.sender.send(
    'idle-time-interval',
    idleTimeInterval || DEFAULT_IDLE_TIME_INTERVAL
  );
});

// Offline & Online - Logic

ipcMain.on('app-offline', () => {
  isOffline = true;
});

ipcMain.on('app-online', async () => {
  isOffline = false;

  db.prepare(
    `
    UPDATE offlineStats
    SET intervalEndTime = ?
    WHERE intervalEndTime IS NULL OR intervalEndTime = ''
    ORDER BY id DESC LIMIT 1
  `
  ).run(new Date().toISOString());

  await syncOfflineData();
});

ipcMain.on('exit-app', () => {
  // Short delay so renderer clean-up already queued (e.g. Hard Reset clears
  // localStorage 500ms later) finishes before the window closes.
  setTimeout(() => {
    app.isQuiting = true;
    app.quit();
  }, 1500);
});

ipcMain.handle('offline-activity-data', async (event, data) => {
  try {
    if (isOffline) {
      db.prepare(
        `
        INSERT INTO offlineStats (
          ownerId,
          projectTaskActivityId,
          appWebsites,
          mouseClick,
          scroll,
          keystroke,
          keyPressed,
          intervalStartTime,
          intervalEndTime,
          timezone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        data.ownerId,
        data.projectTaskActivityId,
        JSON.stringify(data.appWebsites),
        data.mouseClick,
        data.scroll,
        data.keystroke,
        data.keyPressed,
        data.startTime,
        data.endTime,
        data.timezone
      );
    }
  } catch (error) {
    console.error('Failed to save offline activity:', error);
    reportOfflineSaveFailure(error);
    throw error;
  }
});

function checkInternetConnection() {
  return new Promise((resolve) => {
    dns.lookup('google.com', (err) => {
      if (err) {
        isOffline = true;
        resolve(false);
      } else {
        isOffline = false;
        resolve(true);
      }
    });
  });
}

// Interval values come from the server (or the stored copy when offline).
// Missing, NaN, zero or extreme values fall back to defaults or are clamped,
// because a NaN/near-zero delay makes setInterval fire almost continuously.
const MIN_INTERVAL_MINUTES = 10 / 60; // 10 seconds
const MAX_INTERVAL_MINUTES = 24 * 60; // 1 day
const MIN_SPEED_LOCATION_INTERVAL_SECONDS = 10;
const MAX_SPEED_LOCATION_INTERVAL_SECONDS = 24 * 60 * 60;

function sanitizeInterval(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.max(number, min), max);
}

function applyIntervals(raw = {}) {
  captureIntervalMinutes = sanitizeInterval(
    raw.captureIntervalMinutes,
    DEFAULT_CAPTURE_INTERVAL,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  );
  activityIntervalMinutes = sanitizeInterval(
    raw.activityIntervalMinutes,
    DEFAULT_ACTIVITY_INTERVAL,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  );
  activitySpeedLocationInterval = sanitizeInterval(
    raw.activitySpeedLocationInterval,
    DEFAULT_ACTIVITY_SPEED_LOCATION_INTERVAL,
    MIN_SPEED_LOCATION_INTERVAL_SECONDS,
    MAX_SPEED_LOCATION_INTERVAL_SECONDS
  );
  idleTimeInterval = sanitizeInterval(
    raw.idleTimeInterval,
    DEFAULT_IDLE_TIME_INTERVAL,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  );
  appWebsiteDetailsMinutes = sanitizeInterval(
    raw.appWebsiteDetailsMinutes,
    DEFAULT_APP_WEBSITE_DETAILS_INTERVAL,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  );
}

function sendIntervalsToRenderer() {
  // Capture interval is sent with one decimal, as before (shown in the UI).
  sendToRenderer('capture-interval', captureIntervalMinutes.toFixed(1));
  sendToRenderer('activity-interval', activityIntervalMinutes);
  sendToRenderer(
    'activity-speed-location-interval',
    activitySpeedLocationInterval
  );
  sendToRenderer('idle-time-interval', idleTimeInterval);
}

async function fetchCaptureInterval() {
  if (isOffline) {
    let intervals;
    try {
      intervals = await store.get('intervals');
    } catch (error) {
      console.error('Failed to read stored intervals:', error);
    }

    applyIntervals(intervals || {});
    sendIntervalsToRenderer();
    return captureIntervalMinutes;
  }

  try {
    const response = await axios.get(
      `${API_BASE_URL}/employee/v5/auth/configuration/get/${domainId}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const config = response?.data?.data || {};

    applyIntervals({
      captureIntervalMinutes: config.screenshotIntervalInSeconds / 60,
      activityIntervalMinutes: config.activityDetailIntervalInSeconds / 60,
      activitySpeedLocationInterval: config.internetSpeedIntervalInSeconds,
      idleTimeInterval: config.idleTimeInSeconds / 60,
      appWebsiteDetailsMinutes: config.appWebsiteDetailsIntervalInSeconds / 60,
    });

    sendIntervalsToRenderer();

    if (!(Number(config.screenshotIntervalInSeconds) > 0)) {
      reportIssue({
        id: 'invalid-capture-interval',
        severity: 'info',
        title: 'Using default screenshot interval',
        message: `The server did not send a valid screenshot interval, so Activity Tracker is using ${DEFAULT_CAPTURE_INTERVAL} minutes.`,
        once: true,
      });
    }

    // Stored as numbers; older stored strings ("10.0", "NaN") are handled by
    // sanitizeInterval when read back.
    store
      .set('intervals', {
        captureIntervalMinutes,
        appWebsiteDetailsMinutes,
        activityIntervalMinutes,
        activitySpeedLocationInterval,
        idleTimeInterval,
      })
      .catch((error) => console.error('Failed to store intervals:', error));

    return captureIntervalMinutes;
  } catch (error) {
    console.error('Error fetching capture interval:', error);
    return null;
  }
}

function getIconPath() {
  return path.join(__dirname, '..', 'build', 'icon.ico');
}

// Create main application window.
// Several events can ask for a window ('ready', 'second-instance',
// 'activate', tray). Only one window is ever created: callers share the
// in-flight creation and an existing window is reused.
let createWindowPromise = null;

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return Promise.resolve(mainWindow);
  }

  if (!createWindowPromise) {
    createWindowPromise = createMainWindow().finally(() => {
      createWindowPromise = null;
    });
  }

  return createWindowPromise;
}

async function createMainWindow() {
  const isDev = await import('electron-is-dev').then(
    (module) => module.default
  );

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    title: 'Activity Tracker - Digital Links',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    skipTaskbar: false,
    minimizable: true,
    closable: true,
  });

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`${API_URL}/*`] },
    (details, callback) => {
      details.requestHeaders['Cache-Control'] =
        'no-cache, no-store, must-revalidate';
      details.requestHeaders['Pragma'] = 'no-cache';
      details.requestHeaders['Expires'] = '0';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../out/index.html')}`
  );

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);

    startPostWindowTasks();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isRendererReadyForIssues = false;
  });

  // While a page (re)loads, issues are queued and handed over once the new
  // page asks for them ('app-issues-ready').
  mainWindow.webContents.on('did-start-loading', () => {
    isRendererReadyForIssues = false;
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();

      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          iconType: 'info',
          title: 'Activity Tracker',
          content:
            'App is still running in the background. Right-click the tray icon to access options.',
        });
      }

      return false;
    }
  });

  // Note: the deprecated 'crashed' event is no longer handled here.
  // 'render-process-gone' below covers renderer crashes; handling both
  // reloaded the window twice.

  mainWindow.webContents.on('unresponsive', async () => {
    console.warn('Window became unresponsive');

    reportIssue({
      id: 'renderer-unresponsive',
      severity: 'warning',
      title: 'Tracker window is not responding',
      message:
        'The tracker window stopped responding. Tracking continues in the background; the window usually recovers on its own.',
      balloon: true,
    });

    await sendCrashReport(
      'renderer-unresponsive',
      new Error('Renderer process became unresponsive'),
      {
        url: mainWindow?.webContents?.getURL() || 'unknown',
      }
    );
  });

  // Recovery is not a crash, so it is only logged (no crash report).
  mainWindow.webContents.on('responsive', () => {
    console.log('Window became responsive again');
  });

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    // The renderer exits normally while the app is quitting or relaunching.
    if (app.isQuiting || details.reason === 'clean-exit') return;

    console.error('Render process gone:', details);
    isRendererReadyForIssues = false;

    // Not awaited: a slow network must never delay recovery.
    sendCrashReport(
      'render-process-gone',
      new Error('Render process terminated'),
      {
        reason: details.reason,
        exitCode: details.exitCode,
      }
    );

    const reloadWindow = () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    };

    if (details.reason === 'oom') {
      const willRelaunch = requestRelaunch('renderer-oom');

      if (willRelaunch) {
        if (tray && !tray.isDestroyed()) {
          tray.displayBalloon({
            iconType: 'error',
            title: 'Activity Tracker',
            content: CRASH_MESSAGE,
          });
        }

        notifyBlocker(
          'renderer-process',
          'The tracker window ran out of memory and is restarting. If this repeats, check your antivirus or security software.',
          { detail: 'Automatic restart in progress.', balloon: false }
        );
      } else {
        // Restart limit reached: keep the app alive and just reload the window.
        reloadWindow();
      }
    } else {
      notifyBlocker(
        'renderer-process',
        'The tracker window stopped unexpectedly. Antivirus or another app may be blocking Activity Tracker.',
        { detail: `Reason: ${details.reason}` }
      );

      reloadWindow();
    }
  });

  mainWindow.webContents.on(
    'did-fail-load',
    async (event, errorCode, errorDescription, validatedURL) => {
      console.error(`Page failed to load: ${errorDescription} (${errorCode})`);
      await sendCrashReport(
        'renderer-load-failed',
        new Error(errorDescription),
        {
          errorCode,
          validatedURL,
        }
      );
    }
  );

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

async function startPostWindowTasks() {
  try {
    await checkInternetConnection();

    const storeToken = await store.get('authToken');

    if (storeToken) {
      authToken = storeToken;
      await fetchCaptureInterval();
      await loadStats();

      setTimeout(() => {
        sendToRenderer('update-stats', stats);
      }, 500);
    }
  } catch (err) {
    console.error('Post-launch tasks failed:', err);
  }
}

function createTray() {
  tray = new Tray(getIconPath());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Tracker',
      click: showMainWindow,
    },
    {
      label: 'Quit Tracker',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Activity Tracker - Digital Links');
  tray.setContextMenu(contextMenu);

  tray.on('click', showMainWindow);
}

// Show the window, re-creating it if it was destroyed.
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  createWindow()
    .then((window) => {
      window?.show();
      window?.focus();
    })
    .catch((error) => console.error('Failed to show window:', error));
}

// ============= HEALTH MONITORS =============
// Spot problems that slow the whole app down and tell the user about them.

const EVENT_LOOP_CHECK_MS = 1000;
const EVENT_LOOP_LAG_WARN_MS = 2000;
// Longer gaps are almost always sleep/hibernate, not a freeze.
const EVENT_LOOP_LAG_IGNORE_MS = 60 * 1000;
const MEMORY_CHECK_MS = 60 * 1000;
const MEMORY_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;

let eventLoopMonitor = null;
let memoryMonitor = null;
let isSystemSuspended = false;

function startHealthMonitors() {
  let lastTick = Date.now();

  eventLoopMonitor = setInterval(() => {
    const now = Date.now();
    const lag = now - lastTick - EVENT_LOOP_CHECK_MS;
    lastTick = now;

    if (
      !isSystemSuspended &&
      lag >= EVENT_LOOP_LAG_WARN_MS &&
      lag < EVENT_LOOP_LAG_IGNORE_MS
    ) {
      reportIssue({
        id: 'main-process-frozen',
        severity: 'warning',
        title: 'Activity Tracker is running slowly',
        message: `Activity Tracker was frozen for ${(lag / 1000).toFixed(
          1
        )} seconds. The computer may be very busy, or antivirus may be scanning it.`,
      });
    }
  }, EVENT_LOOP_CHECK_MS);

  memoryMonitor = setInterval(() => {
    try {
      // workingSetSize is reported in kilobytes.
      const totalBytes = app
        .getAppMetrics()
        .reduce(
          (sum, metric) => sum + (metric.memory?.workingSetSize || 0) * 1024,
          0
        );

      if (totalBytes >= MEMORY_WARN_BYTES) {
        reportIssue({
          id: 'high-memory',
          severity: 'warning',
          title: 'Activity Tracker is using a lot of memory',
          message: `Activity Tracker is using ${(
            totalBytes /
            (1024 * 1024 * 1024)
          ).toFixed(
            1
          )} GB of memory. If the computer slows down, restart the app.`,
          cooldownMs: 30 * 60 * 1000,
        });
      }
    } catch (error) {
      console.error('Memory check failed:', error);
    }
  }, MEMORY_CHECK_MS);
}

function stopHealthMonitors() {
  if (eventLoopMonitor) clearInterval(eventLoopMonitor);
  if (memoryMonitor) clearInterval(memoryMonitor);
  eventLoopMonitor = null;
  memoryMonitor = null;
}

// ============= APP LIFECYCLE =============
// (single-instance lock is acquired at the top of this file)

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();

    if (process.platform === 'win32') {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.showInactive();
      mainWindow.show();
    }
  } else {
    createWindow();
  }
});

app.on('ready', async () => {
  await createWindow();
  createTray();

  // Tell the user if the last run ended in an automatic restart.
  reportRestartNoticeIfAny();
  startHealthMonitors();

  // Check for interfering security/remote-control software on start and
  // periodically afterwards (e.g. if antivirus is installed while running).
  setTimeout(checkForBlockingSoftware, SECURITY_SCAN_DELAY_MS);
  securityScanInterval = setInterval(
    checkForBlockingSoftware,
    SECURITY_SCAN_INTERVAL_MS
  );

  // Start the scroll helper only in the copy that owns the single-instance lock.
  startScrollTracker();

  powerMonitor.on('suspend', () => {
    isSystemSuspended = true;
    sendToRenderer('windows-sleep-mode', true);
  });

  // Recover in place after sleep instead of spawning a new copy of the app.
  // (Spawning a copy left orphaned helpers behind, and the copy always lost
  // the single-instance lock.)
  powerMonitor.on('resume', () => {
    setTimeout(() => {
      isSystemSuspended = false;
    }, 2 * EVENT_LOOP_CHECK_MS);

    setTimeout(async () => {
      try {
        // The helper may have been suspended or killed during sleep.
        if (!isScrollTrackerRunning()) {
          scrollTrackerRestartAttempts = 0;
          startScrollTracker();
        }

        await checkInternetConnection();
      } catch (err) {
        console.error('Failed to recover after resume:', err);
      } finally {
        sendToRenderer('windows-sleep-mode', false);
      }
    }, 5000);
  });
});

// Mark every kind of quit (tray menu, exit-app, Windows shutdown/logoff,
// auto-update) so the window 'close' handler lets it through and crash
// handlers don't treat normal shutdown as a crash.
app.on('before-quit', () => {
  app.isQuiting = true;
});

app.on('session-end', () => {
  app.isQuiting = true;
});

app.on('window-all-closed', () => {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }

  if (appWebsiteDetailsInterval) {
    clearInterval(appWebsiteDetailsInterval);
    appWebsiteDetailsInterval = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
  if (appWebsiteDetailsInterval) {
    clearInterval(appWebsiteDetailsInterval);
    appWebsiteDetailsInterval = null;
  }
  if (securityScanInterval) {
    clearInterval(securityScanInterval);
    securityScanInterval = null;
  }

  flushStatsSync();
  stopHealthMonitors();
  stopScrollTracker();
  stopKeyboardListener();
  saveIssueLogSync();
  closeOfflineDatabase();
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
});

app.on('child-process-gone', (event, details) => {
  // Helpers exit normally while quitting, and Chromium shuts down idle
  // utility processes with 'clean-exit'. Neither is a crash.
  if (app.isQuiting || details.reason === 'clean-exit') return;

  console.error('Child process gone:', details);

  // Not awaited: a slow network must never delay recovery.
  sendCrashReport('child-process-gone', new Error(details.reason), {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
  });

  notifyBlocker(
    'child-process',
    'A tracker component stopped unexpectedly. Antivirus or another app may be blocking Activity Tracker.',
    {
      detail: `Type: ${details.type}, reason: ${details.reason}`,
      balloon: false,
    }
  );

  if (!RELAUNCH_CHILD_PROCESS_REASONS.has(details.reason)) return;

  const willRelaunch = requestRelaunch(
    `child-process-gone:${details.type}:${details.reason}`
  );

  if (willRelaunch && tray && !tray.isDestroyed()) {
    tray.displayBalloon({
      iconType: 'error',
      title: 'Activity Tracker',
      content: CRASH_MESSAGE,
    });
  }
});

// The deprecated 'gpu-process-crashed' event is no longer handled:
// GPU crashes arrive through 'child-process-gone' above.

async function getActiveWindowInfo() {
  try {
    const { activeWindow } = await import('get-windows');
    const window = await activeWindow();
    if (window) {
      return {
        platform: window?.platform,
        name: window.owner.name,
        title: window.title,
        memoryUsage: window?.memoryUsage,
        time: new Date().toISOString(),
      };
    }
  } catch (error) {
    console.error('Error getting active window info:', error);
  }
  return null;
}

// ------- Stats -------
// Input events (key, click, scroll) only bump counters and call
// recordActivity(). The expensive work (reading the active window, sending
// stats to the window, writing settings.json) is throttled: at most once per
// second for the UI, and once per 30 seconds for the saved copy on disk.

const STATS_REFRESH_MS = 1000;
const STATS_SAVE_INTERVAL_MS = 30 * 1000;
// Safety cap in case uploads keep failing (e.g. not logged in).
const MAX_APP_WEBSITE_DETAILS = 2000;

let statsRefreshTimer = null;
let lastStatsRefreshAt = 0;
let isRefreshingStats = false;
let statsSaveTimer = null;
let lastStatsSavedAt = 0;

function recordActivity() {
  lastActivityTime = Date.now();
  scheduleStatsRefresh();
}

function scheduleStatsRefresh() {
  if (statsRefreshTimer) return;

  const wait = Math.max(
    0,
    STATS_REFRESH_MS - (Date.now() - lastStatsRefreshAt)
  );
  statsRefreshTimer = setTimeout(runStatsRefresh, wait);
}

async function runStatsRefresh() {
  statsRefreshTimer = null;
  if (!isLogging) return;

  if (isRefreshingStats) {
    // A refresh is still running (slow active-window lookup); try again soon.
    scheduleStatsRefresh();
    return;
  }

  isRefreshingStats = true;
  lastStatsRefreshAt = Date.now();

  try {
    await updateStats();
  } catch (error) {
    console.error('Failed to update stats:', error);
  } finally {
    isRefreshingStats = false;
  }
}

function cancelPendingStatsWork() {
  if (statsRefreshTimer) {
    clearTimeout(statsRefreshTimer);
    statsRefreshTimer = null;
  }

  if (statsSaveTimer) {
    clearTimeout(statsSaveTimer);
    statsSaveTimer = null;
  }
}

function scheduleStatsSave() {
  if (statsSaveTimer) return;

  const wait = Math.max(
    0,
    STATS_SAVE_INTERVAL_MS - (Date.now() - lastStatsSavedAt)
  );

  statsSaveTimer = setTimeout(() => {
    statsSaveTimer = null;
    if (!isLogging) return;

    lastStatsSavedAt = Date.now();
    saveStats(stats);
  }, wait);
}

// Write the latest stats right away (used on quit / relaunch so the last
// few seconds of counts are not lost).
function flushStatsSync() {
  cancelPendingStatsWork();
  if (!isLogging) return;

  try {
    store.setSync('stats', stats);
  } catch (error) {
    console.error('Failed to save stats on exit:', error);
  }
}

// Function to update and send stats
async function updateStats(isActivity = false) {
  const currentTime = Date.now();

  if (isActivity) {
    lastActivityTime = currentTime;
  }

  const activeWindow = await getActiveWindowInfo();

  // Logging may have stopped while the active window was being read.
  if (!isLogging) return;

  if (
    activeWindow &&
    activeWindow.name?.toLowerCase().trim() !== 'electron' &&
    (lastActiveWindow === null ||
      activeWindow.name !== lastActiveWindow.name ||
      activeWindow.title !== lastActiveWindow.title)
  ) {
    if (
      lastActiveWindow === null ||
      !appWebsites?.includes(activeWindow?.name)
    ) {
      appWebsites?.unshift(activeWindow?.name);
    }
    appWebsiteDetails?.unshift(activeWindow);

    // Newest entries are at the front; drop the oldest beyond the cap.
    if (appWebsiteDetails?.length > MAX_APP_WEBSITE_DETAILS) {
      appWebsiteDetails.length = MAX_APP_WEBSITE_DETAILS;
    }

    lastActiveWindow = activeWindow;
  }

  stats = {
    clickCount,
    scrollCount,
    keyCount,
    accumulatedText,
    lastActive: moment(lastActivityTime).format('hh:mm:ss A'),
    appWebsites,
    appWebsiteDetails,
  };

  // The window does not use appWebsiteDetails, so it is not sent on every
  // update (it can be large). It is still saved and uploaded as before.
  sendToRenderer('update-stats', {
    clickCount,
    scrollCount,
    keyCount,
    accumulatedText,
    lastActive: stats.lastActive,
    appWebsites,
  });
  scheduleStatsSave();
}

// ------- Window helpers -------

// Send to the renderer only when the window still exists. Several handlers
// run after sleep/resume or during quit, when mainWindow can be null/destroyed.
function sendToRenderer(channel, ...args) {
  try {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch (error) {
    console.error(`Failed to send '${channel}' to renderer:`, error);
  }
}

function isMainWindowFocused() {
  return Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()
  );
}

// Set up global keyboard listener
// Use the unpacked WinKeyServer.exe when the installer provides one (see
// asarUnpack in package.json); otherwise the library's default path is used.
function getKeyServerPath() {
  if (process.platform !== 'win32') return undefined;

  try {
    const packageDir = path.dirname(
      require.resolve('node-global-key-listener/package.json')
    );
    const unpacked = path
      .join(packageDir, 'bin', 'WinKeyServer.exe')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

    return fs.existsSync(unpacked) ? unpacked : undefined;
  } catch (error) {
    return undefined;
  }
}

const keyboardListener = new GlobalKeyboardListener({
  windows: {
    serverPath: getKeyServerPath(),
    // Called when WinKeyServer.exe exits (e.g. blocked by antivirus).
    onError: (code) => {
      if (app.isQuiting) return;

      console.error('Keyboard listener stopped with code:', code);
      notifyBlocker(
        'keyboard-monitor',
        'Keyboard and click tracking stopped. Antivirus or another app may have blocked it. Please restart Activity Tracker.',
        { detail: `Exit code: ${code}`, severity: 'error' }
      );
    },
  },
});
keyboardListener.addListener((e) => {
  if (isLogging && !isMainWindowFocused()) {
    if (e.name === 'MOUSE LEFT' || e.name === 'MOUSE RIGHT') {
      if (e.state === 'UP') {
        clickCount++;
      }
    } else {
      if (e.state === 'DOWN') {
        keyCount++;
        accumulatedText +=
          e.name === 'SPACE'
            ? ' '
            : e.name?.length === 1
              ? e.name?.toLowerCase()
              : '';
      }
    }

    recordActivity();
  }
});

function stopKeyboardListener() {
  try {
    if (typeof keyboardListener.kill === 'function') keyboardListener.kill();
  } catch (error) {
    console.error('Failed to stop keyboard listener:', error);
  }
}

// ------- Scroll helper (scroll_tracker) -------
// One helper process at a time. It is started after 'ready', restarted with
// backoff if it exits unexpectedly, and its whole process tree is killed on
// quit (PyInstaller --onefile runs as a parent + child process pair).

const SCROLL_TRACKER_MAX_RESTARTS = 5;
const SCROLL_TRACKER_RESTART_BASE_DELAY_MS = 5 * 1000;
// If the helper stayed up this long, count the next exit as a fresh failure.
const SCROLL_TRACKER_STABLE_AFTER_MS = 60 * 1000;

let scrollTrackerProcess = null;
let scrollTrackerStartedAt = 0;
let scrollTrackerRestartAttempts = 0;
let scrollTrackerRestartTimer = null;
let isStoppingScrollTracker = false;
// Guards the async gap in startScrollTracker() so two callers (e.g. resume
// and a pending restart timer) can't spawn two helpers.
let isStartingScrollTracker = false;

function isScrollTrackerRunning() {
  return Boolean(
    scrollTrackerProcess &&
      scrollTrackerProcess.exitCode === null &&
      scrollTrackerProcess.signalCode === null
  );
}

async function getScrollTrackerCommand() {
  const isDev = await import('electron-is-dev').then(
    (module) => module.default
  );

  if (isDev) {
    return { command: 'python', args: ['main/scroll_tracker.py'] };
  }

  const executableExtension = process.platform === 'win32' ? '.exe' : '';

  return {
    command: path.join(
      process.resourcesPath,
      'resources',
      'dist',
      `scroll_tracker${executableExtension}`
    ),
    args: [],
  };
}

function scheduleScrollTrackerRestart(reason) {
  if (app.isQuiting || isStoppingScrollTracker || scrollTrackerRestartTimer) {
    return;
  }

  if (scrollTrackerRestartAttempts >= SCROLL_TRACKER_MAX_RESTARTS) {
    notifyBlocker(
      'input-monitor-stopped',
      'Scroll tracking has stopped after several failed restarts. Antivirus or another app may be blocking Activity Tracker. Please restart the app.',
      { detail: reason }
    );
    return;
  }

  // 5s, 10s, 20s, 40s, 80s
  const delay =
    SCROLL_TRACKER_RESTART_BASE_DELAY_MS * 2 ** scrollTrackerRestartAttempts;
  scrollTrackerRestartAttempts++;

  scrollTrackerRestartTimer = setTimeout(() => {
    scrollTrackerRestartTimer = null;
    startScrollTracker();
  }, delay);
}

async function startScrollTracker() {
  if (app.isQuiting || isStartingScrollTracker || isScrollTrackerRunning()) {
    return;
  }

  isStoppingScrollTracker = false;
  isStartingScrollTracker = true;

  let child;
  try {
    const { command, args } = await getScrollTrackerCommand();

    // Re-check after the await: the app may have started quitting.
    if (app.isQuiting || isStoppingScrollTracker) return;

    child = spawn(command, args, { windowsHide: true });
  } catch (error) {
    console.error('Failed to start input monitoring helper:', error);
    notifyBlocker(
      'input-monitor',
      'The input monitoring helper could not start. Antivirus or another app may be blocking Activity Tracker.',
      { detail: error?.message }
    );
    scheduleScrollTrackerRestart(error?.message || 'spawn failed');
    return;
  } finally {
    isStartingScrollTracker = false;
  }

  scrollTrackerProcess = child;
  scrollTrackerStartedAt = Date.now();

  child.stdout.on('data', (data) => {
    const message = data.toString().trim();

    if (message === 'scrolled' && isLogging && !isMainWindowFocused()) {
      scrollCount++;
      recordActivity();
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  child.on('close', (code) => {
    console.log(`child process exited with code ${code}`);

    if (scrollTrackerProcess === child) scrollTrackerProcess = null;
    if (app.isQuiting || isStoppingScrollTracker) return;

    if (Date.now() - scrollTrackerStartedAt >= SCROLL_TRACKER_STABLE_AFTER_MS) {
      scrollTrackerRestartAttempts = 0;
    }

    if (code !== 0) {
      notifyBlocker(
        'input-monitor',
        'The input monitoring helper stopped unexpectedly. Antivirus or another app may be blocking Activity Tracker.',
        { detail: `Exit code: ${code}` }
      );
    }

    scheduleScrollTrackerRestart(`Exit code: ${code}`);
  });

  child.on('error', (error) => {
    console.error('Failed to start input monitoring helper:', error);

    if (scrollTrackerProcess === child) scrollTrackerProcess = null;
    if (app.isQuiting || isStoppingScrollTracker) return;

    notifyBlocker(
      'input-monitor',
      'The input monitoring helper could not start. Antivirus or another app may be blocking Activity Tracker.',
      { detail: error?.message }
    );

    scheduleScrollTrackerRestart(error?.message || 'spawn error');
  });
}

// Synchronous so it completes inside 'will-quit' and before app.exit().
function stopScrollTracker() {
  isStoppingScrollTracker = true;

  if (scrollTrackerRestartTimer) {
    clearTimeout(scrollTrackerRestartTimer);
    scrollTrackerRestartTimer = null;
  }

  const child = scrollTrackerProcess;
  scrollTrackerProcess = null;

  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (process.platform === 'win32' && child.pid) {
      // /T kills the PyInstaller bootloader and the real helper it started.
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore',
      });
    } else {
      child.kill();
    }
  } catch (error) {
    // taskkill fails if the process already exited; fall back to a plain kill.
    try {
      child.kill();
    } catch (killError) {
      console.error('Failed to stop input monitoring helper:', killError);
    }
  }
}

// ------- Screenshot Start -------

// Function to capture and save screenshot
ipcMain.on('set-screenshot-type', (event, data) => {
  screenshotType = data || DEFAULT_SCREENSHOT_TYPE;
});

// Upload failures are shown once they repeat (3 in a row), so a single
// network blip doesn't alarm the user.
const UPLOAD_FAILURE_ALERT_THRESHOLD = 3;
let consecutiveUploadFailures = 0;

function recordUploadResult(ok, error, what = 'data') {
  if (ok) {
    consecutiveUploadFailures = 0;
    return;
  }

  consecutiveUploadFailures++;

  if (consecutiveUploadFailures >= UPLOAD_FAILURE_ALERT_THRESHOLD) {
    reportIssue({
      id: 'upload-failing',
      severity: 'warning',
      title: 'Uploads are failing',
      message: `Could not upload ${what} ${consecutiveUploadFailures} times in a row. Activity Tracker will keep trying.`,
      detail: describeError(error),
    });
  }
}

function reportOfflineSaveFailure(error) {
  reportIssue({
    id: 'offline-save-failed',
    severity: 'error',
    title: 'Could not save offline data',
    message:
      'Activity Tracker could not save data while offline. Some screenshots or activity may be lost.',
    detail: error?.message,
  });
}

async function captureAndSaveScreenshot() {
  // SCREENSHOT, BACKGROUND, NO-SCREENSHOT, BLURRED-SCREENSHOT

  try {
    if (screenshotType === 'NO-SCREENSHOT') {
      return;
    }

    let captureOptions = {
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    };

    if (screenshotType === 'BACKGROUND') {
      captureOptions.types = ['window'];
      captureOptions.thumbnailSize = { width: 1280, height: 720 };
    }

    let sources;
    try {
      sources = await desktopCapturer.getSources(captureOptions);
    } catch (error) {
      notifyBlocker(
        'screen-capture',
        'Screen capture failed. Antivirus or another app may be blocking Activity Tracker.',
        { detail: error?.message }
      );
      throw error;
    }

    if (!sources || sources.length === 0) {
      notifyBlocker(
        'screen-capture',
        'Screen capture returned no screens. Antivirus or another app may be blocking Activity Tracker.'
      );
      return;
    }

    let primaryDisplay;

    if (screenshotType === 'BACKGROUND') {
      primaryDisplay =
        sources.find((source) => source.name !== 'Entire Screen') || sources[0];
    } else {
      primaryDisplay = sources[0];
    }

    if (primaryDisplay) {
      let screenshotBuffer = await sharp(primaryDisplay.thumbnail.toPNG())
        .png({
          quality: 75,
        })
        .toBuffer();

      if (screenshotType === 'BLURRED-SCREENSHOT') {
        try {
          screenshotBuffer = await sharp(screenshotBuffer)
            .blur(10)
            .png()
            .toBuffer();
        } catch (blurError) {
          console.warn(
            'Blur effect failed, using original screenshot:',
            blurError
          );
        }
      }

      let fileName;
      switch (screenshotType) {
        case 'BLURRED-SCREENSHOT':
          fileName = `Blurred_${moment().format('YYYY-MM-DD_HH-mm-ss')}.png`;
          break;
        case 'BACKGROUND':
          fileName = `Background_${moment().format('YYYY-MM-DD_HH-mm-ss')}.png`;
          break;
        default:
          fileName = `Screenshot_${moment().format('YYYY-MM-DD_HH-mm-ss')}.png`;
      }

      authToken = authToken || (await store.get('authToken'));
      ownerId = ownerId || (await store.get('ownerId'));

      if (!ownerId || !authToken) {
        throw new Error('ownerId or authToken not set');
      }

      if (isOffline) {
        try {
          db.prepare(
            `
            INSERT INTO offlineScreenshots (
              authToken,
              ownerId,
              screenshotTakenTime,
              fileName,
              screenshotBlob
            ) VALUES (?, ?, ?, ?, ?)
          `
          ).run(
            authToken,
            ownerId,
            new Date().toISOString(),
            fileName,
            screenshotBuffer
          );
        } catch (err) {
          console.error('Failed to save screenshot offline:', err);
          reportOfflineSaveFailure(err);
        }
      } else {
        const fileType = 'image/png';
        const response = await axios.post(
          `${API_BASE_URL}/employee/v5/media/generate-signed-url`,
          {
            ownerId,
            fileName,
            fileType,
          },
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const signedUrl = await response?.data?.signedUrl;

        await axios.put(signedUrl, screenshotBuffer, {
          headers: {
            'Content-Type': 'image/png',
          },
          timeout: UPLOAD_TIMEOUT_MS,
        });

        const mediaUrl = signedUrl.split('?')[0];

        await axios.post(
          `${API_BASE_URL}/employee/v5/media/add`,
          { ownerId, medias: [{ url: mediaUrl, type: fileType }] },
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        recordUploadResult(true);
      }
    }
  } catch (error) {
    console.error('Error capturing or uploading screenshot:', error);
    if (error?.isAxiosError) recordUploadResult(false, error, 'screenshots');
  }
}

// Function to start screenshot capture
async function startScreenshotCapture() {
  if (screenshotInterval) {
    stopScreenshotCapture();
  }

  screenshotInterval = setInterval(
    captureAndSaveScreenshot,
    (captureIntervalMinutes || DEFAULT_CAPTURE_INTERVAL) * 60 * 1000
  );
}

// Function to stop screenshot capture
function stopScreenshotCapture() {
  clearInterval(screenshotInterval);
}

// ------- Screenshot End -------

// ------- App Website Details Start -------

async function uploadAppWebsiteDetails() {
  try {
    authToken = authToken || (await store.get('authToken'));
    ownerId = ownerId || (await store.get('ownerId'));

    if (!ownerId || !authToken) {
      throw new Error('ownerId or authToken not set');
    }

    const appWebsiteDetailsDifference = appWebsiteDetails?.slice(
      0,
      appWebsiteDetails?.length - lastAppWebsiteDetails?.length
    );

    const jsonString = JSON.stringify(
      appWebsiteDetailsDifference || [],
      null,
      2
    );
    const fileName = `${Date.now()}-app-website-details.json`;

    // Everything up to now has been handed off (uploaded or stored offline),
    // so start a fresh list instead of keeping a growing copy in memory.
    appWebsiteDetails = [];
    lastAppWebsiteDetails = [];

    if (isOffline) {
      try {
        db.prepare(
          `
          INSERT INTO offlineAppWebsiteDetails (
            authToken,
            ownerId,
            fileName,
            appWebsiteDetailsJSON
          ) VALUES (?, ?, ?, ?)
        `
        ).run(authToken, ownerId, fileName, jsonString);
      } catch (err) {
        console.error('Failed to save app usage details offline:', err);
        reportOfflineSaveFailure(err);
      }
    } else {
      const fileBuffer = Buffer.from(jsonString, 'utf-8');
      const fileType = 'application/json';

      const response = await axios.post(
        `${API_BASE_URL}/employee/v5/media/generate-signed-url`,
        {
          ownerId,
          fileName,
          fileType,
        },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const signedUrl = await response?.data?.signedUrl;

      await axios.put(signedUrl, fileBuffer, {
        headers: {
          'Content-Type': fileType,
        },
        timeout: UPLOAD_TIMEOUT_MS,
      });

      const docUrl = signedUrl.split('?')[0];

      await axios.post(
        `${API_BASE_URL}/employee/v5/media/add`,
        { ownerId, medias: [{ url: docUrl, type: 'text/plain' }] },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      recordUploadResult(true);
    }
  } catch (error) {
    console.error('Error uploading app website details:', error);
    if (error?.isAxiosError) {
      recordUploadResult(false, error, 'app usage details');
    }
  }
}

// Function to start app website details interval
async function startAppWebsiteDetailsInterval() {
  if (appWebsiteDetailsInterval) {
    stopAppWebsiteDetailsInterval();
  }

  appWebsiteDetailsInterval = setInterval(
    uploadAppWebsiteDetails,
    (appWebsiteDetailsMinutes || DEFAULT_APP_WEBSITE_DETAILS_INTERVAL) *
      60 *
      1000
  );
}

// Function to stop app website details interval
function stopAppWebsiteDetailsInterval() {
  clearInterval(appWebsiteDetailsInterval);
}

// ------- App Website Details End -------

// IPC handlers

ipcMain.handle('start-logging', async () => {
  cancelPendingStatsWork();
  await store.set('stats', initialStats);
  isLogging = true;
  clickCount = 0;
  scrollCount = 0;
  keyCount = 0;
  accumulatedText = '';
  lastActivityTime = Date.now();
  lastActiveWindow = null;
  appWebsites = [];
  appWebsiteDetails = [];
  lastAppWebsiteDetails = [];
  await startScreenshotCapture();
  await startAppWebsiteDetailsInterval();
});

ipcMain.handle('restart-logging', async () => {
  authToken = await store.get('authToken');
  ownerId = await store.get('ownerId');
  const savedStats = (await store.get('stats')) || initialStats;

  isLogging = true;
  clickCount = savedStats.clickCount || 0;
  scrollCount = savedStats.scrollCount || 0;
  keyCount = savedStats.keyCount || 0;
  accumulatedText = savedStats.accumulatedText || '';
  lastActivityTime = Date.now();
  lastActiveWindow = await getActiveWindowInfo();
  appWebsites = savedStats.appWebsites || [];
  // Saved details were already handled before the restart (same as before:
  // they were never re-uploaded), so start with an empty list.
  appWebsiteDetails = [];
  lastAppWebsiteDetails = [];
  await startScreenshotCapture();
  await startAppWebsiteDetailsInterval();
});

ipcMain.handle('clear-store-stats', async () => {
  cancelPendingStatsWork();
  await store.set('stats', initialStats);
});

ipcMain.handle('get-location', async () => {
  let location = null;
  try {
    const response = await axios.get('http://ip-api.com/json/');
    location = {
      latitude: response.data.lat,
      longitude: response.data.lon,
      city: `${response.data.city}, ${response.data.country}`,
    };
  } catch (error) {
    console.error('Failed to fetch location:', error.message);
  }

  return location;
});

ipcMain.on('stop-logging', () => {
  isLogging = false;
  cancelPendingStatsWork();
  stopScreenshotCapture();
  stopAppWebsiteDetailsInterval();
  stats = initialStats;
  store.reset('stats');
});

ipcMain.handle('get-initial-stats', async () => {
  return stats;
});

// ------- In-app issue alerts (toasts) -------

// The window calls this once its toast listener is set up. It gets the
// recent issue log (for the Issues panel) and any issues that happened while
// it was loading, which it shows as toasts.
ipcMain.handle('app-issues-ready', () => {
  loadIssueLog();
  isRendererReadyForIssues = true;

  const pending = pendingIssues;
  pendingIssues = [];

  return { recent: issueLog, pending };
});

ipcMain.handle('clear-app-issues', () => {
  issueLog.length = 0;
  saveIssueLogSoon();
  return true;
});

// Errors caught in the window (React error boundary, window.onerror,
// unhandled promise rejections) are logged and shown like any other issue.
ipcMain.on('report-renderer-issue', (event, data = {}) => {
  const message = String(data?.message || 'Unknown error').slice(0, 500);

  reportIssue({
    id: `renderer-error:${message.slice(0, 80)}`,
    severity: data?.severity === 'warning' ? 'warning' : 'error',
    title: 'Something went wrong in the tracker window',
    message,
    detail: String(data?.detail || '').slice(0, 4000),
    silent: Boolean(data?.silent),
  });
});

ipcMain.on('app-issue-action', (event, action) => {
  if (action === 'retry-sync' && !isOffline) {
    syncOfflineData();
  }
});

ipcMain.on('show-tray-alert', () => {
  if (!tray || tray.isDestroyed()) return;

  tray.displayBalloon({
    iconType: 'warning',
    title: 'Are you active?',
    content:
      'You have been idle for quite a long time. Please check the tracker.',
  });
});

function saveStats(stats) {
  store
    .set('stats', stats)
    .catch((error) => console.error('Failed to save stats:', error));
}

async function loadStats() {
  const savedStats = await store.get('stats');
  if (savedStats) {
    stats = savedStats;
    clickCount = stats.clickCount;
    scrollCount = stats.scrollCount || 0;
    keyCount = stats.keyCount;
    accumulatedText = stats.accumulatedText;
    lastActivityTime = Date.now();
    appWebsites = stats.appWebsites || [];
    // Saved details were already handled before the restart (they were never
    // re-uploaded), so start with an empty list.
    appWebsiteDetails = [];
    lastAppWebsiteDetails = [];
  } else {
    stats = initialStats;
    lastAppWebsiteDetails = [];
  }
}

async function clearRendererStorage() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      await mainWindow.webContents.session.clearStorageData({
        storages: ['localStorage'],
      });
      await store.reset();
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  }
}

app.on('will-uninstall', async (event) => {
  event.preventDefault();
  try {
    await clearRendererStorage();
  } catch (error) {
    console.error('Error clearing renderer storage:', error);
  }
  event.continue();
});
