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

const sharp = require('sharp');
const store = require('electron-settings');
const path = require('path');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const moment = require('moment');
const os = require('os');

const { spawn } = require('child_process');

// APP Name
app.setName('Activity Tracker - Digital Links');
app.setAppUserModelId('com.infoware-logger.123');

// API
const { default: axios } = require('axios');
const dns = require('dns');

const IS_PRODUCTION = false;
const API_URL = `https://webtracker${IS_PRODUCTION ? 'prod' : ''}.infoware.xyz`;
const API_BASE_URL = `${API_URL}/api`;

const CRASH_REPORT_API = `${API_BASE_URL}/employee/v4/crash-report/add`;

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
      }
    );
    console.log('Crash report sent to server');
  } catch (error) {}

  return crashData;
}

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await sendCrashReport('main-uncaught-exception', error);
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

  await sendCrashReport('main-unhandled-rejection', error, {
    promise: String(promise),
  });
});

// Command line functions for performance efficiency.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Offline & Online
let isOffline = false;

// Electron Related
let mainWindow;
let tray;
app.isQuiting = false;

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
const db = new Database(path.join(app.getPath('userData'), 'data.db'));

db.prepare(
  `
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
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS offlineScreenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    authToken TEXT,
    ownerId TEXT,
    screenshotTakenTime TEXT,
    fileName TEXT,
    screenshotBlob BLOB
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS offlineAppWebsiteDetails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    authToken TEXT,
    ownerId TEXT,
    fileName NUMBER,
    appWebsiteDetailsJSON TEXT
  )
`
).run();

let shouldNotRemoveTimer = false;

ipcMain.handle('should-not-remove-timer', async () => {
  return shouldNotRemoveTimer;
});

async function syncOfflineData() {
  const authToken = await store.get('authToken');

  // Sync offline stats
  const statsRows = db.prepare('SELECT * FROM offlineStats').all();

  if (statsRows && statsRows?.length > 0) {
    mainWindow.webContents.send('sync-processing', true);
    shouldNotRemoveTimer = true;

    const filteredProjectTaskActivityDetails = statsRows?.filter(
      (row) => row?.mouseClick >= 0 && row?.keystroke >= 0 && row?.scroll >= 0
    );

    const projectTaskActivityDetails = filteredProjectTaskActivityDetails.map(
      (row) => ({
        projectTaskActivityId: row.projectTaskActivityId,
        mouseClick: row.mouseClick ?? 0,
        keystroke: row.keystroke ?? 0,
        keyPressed: row.keyPressed ?? '',
        scroll: row.scroll ?? 0,
        appWebsites: row.appWebsites ? JSON.parse(row.appWebsites) : [],
        startTime: row.intervalStartTime ?? '',
        endTime: row.intervalEndTime ?? '',
        timezone: row.timezone || 'unknown',
      })
    );

    const payload = {
      ownerId:
        ownerId || (await store.get('ownerId')) || statsRows?.[0]?.ownerId,
      projectTaskActivityDetails,
    };

    if (projectTaskActivityDetails && projectTaskActivityDetails?.length > 0) {
      try {
        await axios.post(
          `${API_BASE_URL}/employee/v4/project/project/task/activity/detail/add/bulk`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        // Remove synced row
        statsRows.forEach((row) =>
          db.prepare('DELETE FROM offlineStats WHERE id = ?').run(row.id)
        );

        // Reset sequence if table is empty
        const statsCount = db
          .prepare('SELECT COUNT(*) as count FROM offlineStats')
          .get().count;
        if (statsCount === 0) {
          db.prepare(
            "DELETE FROM sqlite_sequence WHERE name='offlineStats'"
          ).run();
        }
      } catch (err) {
        // Remove synced row
        console.error('Failed to sync stats row:', err);
      }
    }

    mainWindow.webContents.send('sync-processing', false);
  }

  // Sync offline screenshots
  const screenshotRows = db.prepare('SELECT * FROM offlineScreenshots').all();

  if (screenshotRows && screenshotRows?.length > 0) {
    try {
      // 1. Generate Signed URL for all screenshots
      const fileType = 'image/png';
      const response = await axios.post(
        `${API_BASE_URL}/employee/v4/media/generate-multiple-signed-urls`,
        {
          ownerId,
          files: screenshotRows.map((row) => ({
            fileType,
            fileName: row.fileName,
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const signedUrls = await response?.data?.urls?.map(
        (url) => url?.signedUrl
      );

      // 2. Upload all files in one request

      await Promise.all(
        screenshotRows?.map(async (row, idx) => {
          await axios.put(signedUrls[idx], row.screenshotBlob, {
            headers: {
              'Content-Type': fileType,
            },
          });
        })
      );

      // 3. Prepare screenshot payload with mediaUrl and createdAt using index match
      const mediaUrls = signedUrls.map((url) => url.split('?')[0]);

      await axios.post(
        `${API_BASE_URL}/employee/v4/media/add`,
        {
          ownerId,
          medias: screenshotRows?.map((row, idx) => ({
            url: mediaUrls[idx],
            type: fileType,
            createdAt: new Date(row.screenshotTakenTime).toISOString(),
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // 4. Delete synced screenshots from DB
      screenshotRows.forEach((row) => {
        db.prepare('DELETE FROM offlineScreenshots WHERE id = ?').run(row.id);
      });

      // Reset sequence if table is empty
      const screenshotsCount = db
        .prepare('SELECT COUNT(*) as count FROM offlineScreenshots')
        .get().count;
      if (screenshotsCount === 0) {
        db.prepare(
          "DELETE FROM sqlite_sequence WHERE name='offlineScreenshots'"
        ).run();
      }
    } catch (err) {
      console.error('Failed to sync screenshot rows:', err);
    }
  }

  // Sync offline app website details
  const appWebsiteDetailsRows = db
    .prepare('SELECT * FROM offlineAppWebsiteDetails')
    .all();

  if (appWebsiteDetailsRows && appWebsiteDetailsRows?.length > 0) {
    try {
      // 1. Generate Signed URL for all screenshots
      const fileType = 'application/json';

      const response = await axios.post(
        `${API_BASE_URL}/employee/v4/media/generate-multiple-signed-urls`,
        {
          ownerId,
          files: appWebsiteDetailsRows.map((row) => ({
            fileType,
            fileName: row.fileName,
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const signedUrls = await response?.data?.urls?.map(
        (url) => url?.signedUrl
      );

      // 2. Upload all files in one request

      await Promise.all(
        appWebsiteDetailsRows?.map(async (row, idx) => {
          await axios.put(signedUrls[idx], row.appWebsiteDetailsJSON, {
            headers: {
              'Content-Type': fileType,
            },
          });
        })
      );

      const docUrls = signedUrls.map((url) => url.split('?')[0]);

      await axios.post(
        `${API_BASE_URL}/employee/v4/media/add`,
        {
          ownerId,
          medias: appWebsiteDetailsRows?.map((_, idx) => ({
            url: docUrls[idx],
            type: 'text/plain',
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // 4. Delete synced app website details from DB
      appWebsiteDetailsRows.forEach((row) => {
        db.prepare('DELETE FROM offlineAppWebsiteDetails WHERE id = ?').run(
          row.id
        );
      });

      // 5. Reset sequence if table is empty
      const appWebsiteDetailsCount = db
        .prepare('SELECT COUNT(*) as count FROM offlineAppWebsiteDetails')
        .get().count;
      if (appWebsiteDetailsCount === 0) {
        db.prepare(
          "DELETE FROM sqlite_sequence WHERE name='offlineAppWebsiteDetails'"
        ).run();
      }
    } catch (err) {
      console.error('Failed to sync app website details rows:', err);
    }
  }
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
  app.quit();
});

ipcMain.handle('offline-activity-data', async (event, data) => {
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

async function fetchCaptureInterval() {
  if (isOffline) {
    const intervals = await store.get('intervals');

    // 1) Screenshot capture interval
    captureIntervalMinutes = intervals.captureIntervalMinutes;

    // 2) Activity interval
    activityIntervalMinutes = intervals.activityIntervalMinutes;

    // 3) Speed location interval
    activitySpeedLocationInterval = +intervals.activitySpeedLocationInterval;

    // 4) Idle time interval
    idleTimeInterval = +intervals.idleTimeInterval;

    // 5) App Website Details Interval
    appWebsiteDetailsMinutes = +intervals.appWebsiteDetailsMinutes;

    if (mainWindow) {
      mainWindow.webContents.send(
        'capture-interval',
        intervals.captureIntervalMinutes
      );
      mainWindow.webContents.send(
        'acitivity-interval',
        intervals.activityIntervalMinutes
      );
      mainWindow.webContents.send(
        'activity-speed-location-interval',
        +intervals.activitySpeedLocationInterval
      );
      mainWindow.webContents.send(
        'idle-time-interval',
        +intervals.idleTimeInterval
      );
    }
  } else {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/employee/auth/configuration/get`,
        {},
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // 1) Screenshot capture interval
      captureIntervalMinutes =
        response?.data?.data?.screenshotIntervalInSeconds / 60;

      // 2) Activity interval
      activityIntervalMinutes =
        response?.data?.data?.activityDetailIntervalInSeconds / 60;

      // 3) Speed location interval
      activitySpeedLocationInterval =
        response?.data?.data?.internetSpeedIntervalInSeconds;

      // 4) Idle time interval
      idleTimeInterval = response?.data?.data?.idleTimeInSeconds / 60;

      // 5) App Website Details interval
      appWebsiteDetailsMinutes =
        response?.data?.data?.appWebsiteDetailsIntervalInSeconds / 60;

      if (mainWindow) {
        mainWindow.webContents.send(
          'capture-interval',
          captureIntervalMinutes?.toFixed(1) || DEFAULT_CAPTURE_INTERVAL
        );
        mainWindow.webContents.send(
          'acitivity-interval',
          activityIntervalMinutes || DEFAULT_ACTIVITY_INTERVAL
        );
        mainWindow.webContents.send(
          'activity-speed-location-interval',
          +activitySpeedLocationInterval ||
            DEFAULT_ACTIVITY_SPEED_LOCATION_INTERVAL
        );
        mainWindow.webContents.send(
          'idle-time-interval',
          +idleTimeInterval || DEFAULT_IDLE_TIME_INTERVAL
        );
      }

      store.set('intervals', {
        captureIntervalMinutes:
          captureIntervalMinutes?.toFixed(1) || DEFAULT_CAPTURE_INTERVAL,
        appWebsiteDetailsMinutes:
          appWebsiteDetailsMinutes || DEFAULT_APP_WEBSITE_DETAILS_INTERVAL,
        activityIntervalMinutes:
          activityIntervalMinutes || DEFAULT_ACTIVITY_INTERVAL,
        activitySpeedLocationInterval:
          +activitySpeedLocationInterval ||
          DEFAULT_ACTIVITY_SPEED_LOCATION_INTERVAL,
        idleTimeInterval: +idleTimeInterval || DEFAULT_IDLE_TIME_INTERVAL,
      });

      return captureIntervalMinutes;
    } catch (error) {
      console.error('Error fetching capture interval:', error);
      return null;
    }
  }
}

function getIconPath() {
  return path.join(__dirname, '..', 'build', 'icon.ico');
}

// Create main application window
async function createWindow() {
  const isDev = await import('electron-is-dev').then(
    (module) => module.default
  );

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    simpleFullscreen: true,
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
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();

      if (tray) {
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

  mainWindow.webContents.on('crashed', async (event, killed) => {
    console.error('Window crashed, attempting to reload...');
    await sendCrashReport(
      'renderer-crashed',
      new Error('Renderer process crashed'),
      {
        killed,
        url: mainWindow?.webContents?.getURL() || 'unknown',
      }
    );

    if (!mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  mainWindow.webContents.on('unresponsive', async () => {
    console.warn('Window became unresponsive');
    await sendCrashReport(
      'renderer-unresponsive',
      new Error('Renderer process became unresponsive'),
      {
        url: mainWindow?.webContents?.getURL() || 'unknown',
      }
    );
  });

  mainWindow.webContents.on('responsive', async () => {
    console.log('Window became responsive again');
    await sendCrashReport(
      'renderer-responsive',
      new Error('Renderer became responsive again'),
      {
        url: mainWindow?.webContents?.getURL() || 'unknown',
      }
    );
  });

  mainWindow.webContents.on('render-process-gone', async (_, details) => {
    console.error('Render process gone:', details);
    await sendCrashReport(
      'render-process-gone',
      new Error('Render process terminated'),
      {
        reason: details.reason,
        exitCode: details.exitCode,
      }
    );

    if (details.reason === 'oom') {
      if (tray) {
        tray.displayBalloon({
          iconType: 'error',
          title: 'Activity Tracker',
          content:
            'Something went wrong! If Activity Tracker does not restart automatically, please open it manually.',
        });
      }

      setTimeout(() => {
        try {
          if (tray) tray.destroy();
          app.relaunch();
        } catch (e) {
          console.error('Failed to relaunch:', e);
        } finally {
          app.exit(0);
        }
      }, 5000);
    } else {
      if (!mainWindow.isDestroyed()) mainWindow.reload();
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
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('update-stats', stats);
        }
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
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
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

  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
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

    powerMonitor.on('suspend', () => {
      mainWindow.webContents.send('windows-sleep-mode', true);
    });

    powerMonitor.on('resume', async () => {
      const isDev = await import('electron-is-dev').then((mod) => mod.default);

      const execPath = isDev ? process.argv[0] : process.execPath;
      const args = isDev ? [path.join(__dirname, '..')] : [];

      setTimeout(() => {
        try {
          spawn(execPath, args, {
            detached: true,
            stdio: 'ignore',
          }).unref();

          setTimeout(() => {
            mainWindow.webContents.send('windows-sleep-mode', false);
          }, 5000);
        } catch (err) {
          console.error('Failed to relaunch app:', err);
        } finally {
          app.quit();
        }
      }, 1000);
    });
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
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });

  app.on('child-process-gone', async (event, details) => {
    console.error('Child process gone:', details);
    await sendCrashReport('child-process-gone', new Error(details.reason), {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  app.on('gpu-process-crashed', async (event, killed) => {
    await sendCrashReport(
      'gpu-process-crashed',
      new Error('GPU process crashed'),
      {
        killed,
        platform: process.platform,
      }
    );
  });
}

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

// Function to update and send stats
async function updateStats(isActivity = false) {
  const currentTime = Date.now();

  if (isActivity) {
    lastActivityTime = currentTime;
  }

  const activeWindow = await getActiveWindowInfo();

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

  mainWindow.webContents.send('update-stats', stats);
  saveStats(stats);
}

// Set up global keyboard listener
const keyboardListener = new GlobalKeyboardListener();
keyboardListener.addListener((e) => {
  if (isLogging && !mainWindow.isFocused()) {
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

    updateStats(true);
  }
});

// Set up scroll events

async function getScrollTracker() {
  const isDev = await import('electron-is-dev').then(
    (module) => module.default
  );

  if (!isDev) {
    const executableExtension = process.platform === 'win32' ? '.exe' : '';
    pythonExecutablePath = path.join(
      process.resourcesPath,
      'resources',
      'dist',
      `scroll_tracker${executableExtension}`
    );

    const child = spawn(pythonExecutablePath);

    child.stdout.on('data', (data) => {
      const message = data.toString().trim();

      if (message === 'scrolled' && isLogging && !mainWindow.isFocused()) {
        scrollCount++;
        updateStats(true);
      }
    });

    child.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    child.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
    });
  } else {
    const child = spawn('python', ['main/scroll_tracker.py']);

    child.stdout.on('data', (data) => {
      const message = data.toString().trim();

      if (message === 'scrolled' && isLogging && !mainWindow.isFocused()) {
        scrollCount++;
        updateStats(true);
      }
    });

    child.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    child.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
    });
  }
}

getScrollTracker();

// ------- Screenshot Start -------

// Function to capture and save screenshot
ipcMain.on('set-screenshot-type', (event, data) => {
  screenshotType = data || DEFAULT_SCREENSHOT_TYPE;
});

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

    const sources = await desktopCapturer.getSources(captureOptions);
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

      const screenshotBlob = new Blob([screenshotBuffer], {
        type: 'image/png',
      });

      const file = new File([screenshotBlob], fileName, { type: 'image/png' });

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
        }
      } else {
        const fileType = file.type;
        const response = await axios.post(
          `${API_BASE_URL}/employee/v4/media/generate-signed-url`,
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
        });

        const mediaUrl = signedUrl.split('?')[0];

        await axios.post(
          `${API_BASE_URL}/employee/v4/media/add`,
          { ownerId, medias: [{ url: mediaUrl, type: fileType }] },
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      }
    }
  } catch (error) {
    console.error('Error capturing or uploading screenshot:', error);
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

    lastAppWebsiteDetails = JSON.parse(JSON.stringify(appWebsiteDetails));

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
        console.error('Failed to save screenshot offline:', err);
      }
    } else {
      const fileBuffer = Buffer.from(jsonString, 'utf-8');
      const fileType = 'application/json';

      const response = await axios.post(
        `${API_BASE_URL}/employee/v4/media/generate-signed-url`,
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
      });

      const docUrl = signedUrl.split('?')[0];

      await axios.post(
        `${API_BASE_URL}/employee/v4/media/add`,
        { ownerId, medias: [{ url: docUrl, type: 'text/plain' }] },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  } catch (error) {
    console.error('Error uploading app website details:', error);
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
  const savedStats = await store.get('stats');

  isLogging = true;
  clickCount = savedStats.clickCount;
  scrollCount = savedStats.scrollCount || 0;
  keyCount = savedStats.keyCount;
  accumulatedText = savedStats.accumulatedText;
  lastActivityTime = Date.now();
  lastActiveWindow = await getActiveWindowInfo();
  appWebsites = savedStats.appWebsites;
  appWebsiteDetails = savedStats.appWebsiteDetails;
  lastAppWebsiteDetails = JSON.parse(
    JSON.stringify(savedStats.appWebsiteDetails || [])
  );
  await startScreenshotCapture();
  await startAppWebsiteDetailsInterval();
});

ipcMain.handle('clear-store-stats', async () => {
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
  stopScreenshotCapture();
  stopAppWebsiteDetailsInterval();
  stats = initialStats;
  store.reset('stats');
});

ipcMain.handle('get-initial-stats', async () => {
  return stats;
});

ipcMain.on('show-tray-alert', () => {
  tray.displayBalloon({
    iconType: 'warning',
    title: 'Are you active?',
    content:
      'You have been idle for quite a long time. Please check the tracker.',
  });
});

function saveStats(stats) {
  store.set('stats', stats);
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
    appWebsites = stats.appWebsites;
    appWebsiteDetails = stats.appWebsiteDetails;
    lastAppWebsiteDetails = JSON.parse(
      JSON.stringify(stats.appWebsiteDetails || [])
    );
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
