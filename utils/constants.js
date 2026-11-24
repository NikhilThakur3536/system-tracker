// Environment related set up
export const IS_PRODUCTION = true;
export const DOMAIN_TYPE = IS_PRODUCTION ? 'test' : 'test';
// export const BASE_URL = `https://webtracker${IS_PRODUCTION ? 'dev' : ''}.infoware.xyz`;
export const BASE_URL = 'https://webtrackerprod.infoware.xyz';

// API & Tracker related constants
export const API_BASE_URL = `${BASE_URL}/api`;

export const TRACKER_VERSION = '1.1.9';

export const DEFAULT_SCREENSHOT_TYPE = 'SCREENSHOT';

// Intervals and Time Related Constants
export const UPDATE_CHECKER_TIME = 30 * 60 * 1000;
export const REFRESH_CALL_TIME = 5 * 60 * 1000;
export const APP_OFFLINE_SWITCH_INTERVAL = 10 * 60 * 1000;

export const SERVER_ERROR_INTERVAL_RETEST = 3;
