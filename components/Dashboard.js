import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Hourglass,
  X,
  Activity,
  Package,
  Keyboard,
  Gauge,
  RefreshCcw,
} from 'lucide-react';
import Task from './Task/Task';
import PastActivities from './PastActivities';
import { gettingEmployeeActionsList } from '../redux/employee/employeeActions';
import InternetSpeedTracker from './InternetSpeedTracker';
import AppUsage from './AppUsage';
import { IS_PRODUCTION, TRACKER_VERSION } from '../utils/constants';
import { fetchTrackingTimeDetails } from '../redux/activity/activityActions';
import SlidingTimeDisplay from './SlidingTimeDisplay';
import ManualOffline from './ManualOffline';
import StatsCards from './StatsCards';
import { RefreshCw } from 'lucide-react';

function ActivityLogger({
  onLogout,
  stats,
  startLogging,
  stopLogging,
  isLogging,
  captureInterval,
  authToken,
  activityInterval,
  activityLocationInterval,
  endedActivityRestart,
  setEndedActivityRestart,
  setIsLoading,
  isSleepMode,
  setClearStats,
}) {
  const dispatch = useDispatch();
  const isOnline = useSelector(
    (state) => state.employee.internetConnectionStatus
  );

  const [ownerId, setOwnerId] = useState(null);

  function fetchWorkspaces() {
    dispatch(
      gettingEmployeeActionsList(
        authToken,
        'employee/auth/workspace/list',
        'workspaces'
      )
    );
  }

  useEffect(() => {
    if (!isLogging) {
      fetchWorkspaces();
    }
  }, [isLogging]);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showCannotLogoutModal, setShowCannotLogoutModal] = useState(false);
  const [activeTab, setActiveTab] = useState('current');

  const [projectTaskId, setProjectTaskId] = useState('');
  const [description, setDescription] = useState('');
  const [activeSession, setActiveSession] = useState(null);

  const user = useSelector((state) => state?.auth?.employeeDetails);

  const workspaces = useSelector((state) => state?.employee?.workspaces?.list);

  const handleLogout = () => {
    onLogout();
    setShowLogoutModal(false);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedIsLogging = JSON.parse(localStorage.getItem('isLogging'));
      const storedOwnerId = localStorage.getItem('ownerId');
      const storedActiveSession = localStorage.getItem('activeSession');
      const storedProjectTaskId = localStorage.getItem('projectTaskId');
      if (storedIsLogging) {
        if (storedOwnerId) {
          setOwnerId(storedOwnerId);
        }
        if (storedActiveSession) {
          const storedActiveSessionObj = JSON.parse(storedActiveSession);
          setActiveSession(storedActiveSessionObj);
          setDescription(storedActiveSessionObj?.description);
        }
        if (storedProjectTaskId) {
          setProjectTaskId(storedProjectTaskId);
        }
      }
    }
  }, []);

  const handleWorkspaceSelection = (e) => {
    const value = e.target.value;
    setOwnerId(value);
    localStorage.setItem('ownerId', value);
  };

  const [animate, setAnimate] = useState(false);
  const [trackedHourDetails, setTrackedHourDetails] = useState({
    trackedHourInSeconds: 0,
    idleTime: 0,
  });

  const [updatedDetailsFromActivity, setUpdatedDetailsFromActivity] =
    useState(null);

  const updateTrackedHourDetails = useCallback(
    (newSeconds, idleTimeInSeconds) => {
      setUpdatedDetailsFromActivity({ newSeconds, idleTimeInSeconds });
    },
    [trackedHourDetails]
  );

  useEffect(() => {
    if (updatedDetailsFromActivity) {
      if (isOnline) {
        setTrackedHourDetails((prev) => {
          setAnimate(true);
          setTimeout(() => setAnimate(false), 300);

          const shouldUpdateTrackedTime =
            updatedDetailsFromActivity.idleTimeInSeconds === 0;

          localStorage.setItem(
            'offlineTrackedHours',
            JSON.stringify({
              trackedHourInSeconds: shouldUpdateTrackedTime
                ? +prev?.trackedHourInSeconds +
                  (+updatedDetailsFromActivity?.newSeconds ?? 0)
                : +prev?.trackedHourInSeconds,
              idleTime:
                +prev?.idleTime +
                (+updatedDetailsFromActivity?.idleTimeInSeconds ?? 0),
            })
          );

          return {
            trackedHourInSeconds: shouldUpdateTrackedTime
              ? +prev?.trackedHourInSeconds +
                (+updatedDetailsFromActivity?.newSeconds ?? 0)
              : +prev?.trackedHourInSeconds,
            idleTime:
              +prev?.idleTime +
              (+updatedDetailsFromActivity?.idleTimeInSeconds ?? 0),
          };
        });
      } else {
        setAnimate(true);
        setTrackedHourDetails({
          trackedHourInSeconds: updatedDetailsFromActivity?.newSeconds,
          idleTime: updatedDetailsFromActivity?.idleTimeInSeconds,
        });
        setTimeout(() => setAnimate(false), 300);
      }
    }

    setUpdatedDetailsFromActivity(null);
  }, [updatedDetailsFromActivity, isOnline]);

  useEffect(() => {
    let trackedHourTimeout;

    if (authToken && ownerId && isOnline) {
      const trackedHourDetailApiCall = () =>
        dispatch(
          fetchTrackingTimeDetails(authToken, {
            ownerId,
          })
        ).then((res) => {
          const newSeconds = res?.data?.data?.uniqueMinuteCount
            ? +res?.data?.data?.uniqueMinuteCount
            : 0;

          setTrackedHourDetails((prev) => {
            if (prev.trackedHourInSeconds !== newSeconds) {
              setAnimate(true);
              setTimeout(() => setAnimate(false), 300);
            }

            localStorage.setItem(
              'offlineTrackedHours',
              JSON.stringify({
                idleTime: 0,
                trackedHourInSeconds: newSeconds,
              })
            );

            return {
              idleTime: 0,
              trackedHourInSeconds: newSeconds,
            };
          });
        });

      trackedHourTimeout = setTimeout(trackedHourDetailApiCall, 0);
      trackedHourTimeout = setTimeout(
        trackedHourDetailApiCall,
        (activityInterval || 1) * 60 * 1000 + 1000
      );
    }

    return () => {
      if (trackedHourTimeout) clearTimeout(trackedHourTimeout);
    };
  }, [authToken, ownerId, isOnline]);

  useEffect(() => {
    if (isOnline && typeof window !== undefined)
      localStorage.removeItem('offlineTrackedHours');
  }, [isOnline]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const offlineTrackedHours = JSON.parse(
        localStorage.getItem('offlineTrackedHours')
      );
      if (offlineTrackedHours) {
        setTrackedHourDetails(offlineTrackedHours);
      }
    }
  }, []);

  function fetchActiveTime() {
    let trackedHourTimeout;

    if (authToken && ownerId) {
      if (isOnline) {
        const trackedHourDetailApiCall = () =>
          dispatch(
            fetchTrackingTimeDetails(authToken, {
              ownerId,
            })
          ).then((res) => {
            const newSeconds = res?.data?.data?.uniqueMinuteCount
              ? +res?.data?.data?.uniqueMinuteCount
              : 0;

            setTrackedHourDetails((prev) => {
              if (prev.trackedHourInSeconds !== newSeconds) {
                setAnimate(true);
                setTimeout(() => setAnimate(false), 300);
              }

              return {
                idleTime: 0,
                trackedHourInSeconds: newSeconds,
              };
            });
          });

        trackedHourTimeout = setTimeout(trackedHourDetailApiCall, 0);
        trackedHourTimeout = setTimeout(
          trackedHourDetailApiCall,
          (activityInterval || 1) * 60 * 1000 + 1000
        );
      }
    }

    if (trackedHourTimeout) clearTimeout(trackedHourTimeout);
  }

  // Initial Speed
  const [initialSpeed, setInitialSpeed] = useState(null);

  // Offline triggering handler
  const [manualOffline, setManualOffline] = useState(false);
  const manualOfflineRef = useRef(null);

  function manualOfflineTriggerHandler() {
    manualOfflineRef?.current?.onManualOfflineTrigger?.();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 sm:mb-8 space-y-4 sm:space-y-0">
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
                Activity Logger
              </h1>
              <Activity className="text-indigo-600 text-xl sm:text-3xl ml-2" />
            </div>
            <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 shadow-sm">
              <Package className="h-4 w-4" />
              <span>Current Version: {TRACKER_VERSION}</span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {ownerId ? (
              isLogging ? (
                <div className="bg-gray-100 border border-gray-300 text-gray-900 text-sm rounded-lg  block p-2.5">
                  {activeSession?.workspaceName}
                </div>
              ) : (
                <select
                  value={ownerId}
                  disabled={isLogging}
                  onChange={handleWorkspaceSelection}
                  className="bg-gray-100 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.ownerId} value={workspace.ownerId}>
                      {workspace.workspaceName}
                    </option>
                  ))}
                </select>
              )
            ) : null}
            <div
              className="relative w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-semibold cursor-pointer"
              style={{ backgroundColor: '#059669' }}
              onClick={() => !isLogging && setShowLogoutModal(true)}
              onMouseEnter={() => isLogging && setShowCannotLogoutModal(true)}
              onMouseLeave={() => isLogging && setShowCannotLogoutModal(false)}
            >
              {user?.firstName?.[0]?.toUpperCase()}

              {showCannotLogoutModal && (
                <div className="absolute top-full right-0 mt-2 z-50 max-w-[200px]">
                  <div className="relative w-max text-white bg-red-500 text-xs px-3 py-2 rounded shadow-lg">
                    <div className="absolute -top-2 right-3 w-0 h-0 border-l-6 border-r-6 border-b-6 border-l-transparent border-r-transparent border-b-white"></div>
                    Cannot logout while activity logging
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {ownerId ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="flex">
                <button
                  className={`px-4 py-2 font-medium text-sm ${
                    activeTab === 'current'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => setActiveTab('current')}
                >
                  Active Tab Session
                </button>
                <button
                  className={`px-4 py-2 font-medium text-sm ${
                    activeTab === 'past'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => setActiveTab('past')}
                >
                  Past Activities
                </button>
                <button
                  className={`px-4 py-2 font-medium text-sm ${
                    activeTab === 'app-usage'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}
                  onClick={() => setActiveTab('app-usage')}
                >
                  App Usage
                </button>
              </div>

              {isLogging && (
                <ManualOffline
                  manualOffline={manualOffline}
                  setManualOffline={setManualOffline}
                  ref={manualOfflineRef}
                />
              )}
            </div>

            <div
              className={`${activeTab === 'current' ? 'visible' : 'hidden'}`}
            >
              <Task
                startLogging={startLogging}
                stopLogging={stopLogging}
                isLogging={isLogging}
                activeSession={activeSession}
                setActiveSession={setActiveSession}
                ownerId={ownerId}
                authToken={authToken}
                stats={stats}
                activityInterval={activityInterval}
                projectTaskId={projectTaskId}
                setProjectTaskId={setProjectTaskId}
                description={description}
                setDescription={setDescription}
                endedActivityRestart={endedActivityRestart}
                setEndedActivityRestart={setEndedActivityRestart}
                setIsLoading={setIsLoading}
                trackedHourDetails={trackedHourDetails}
                updateTrackedHourDetails={updateTrackedHourDetails}
                initialSpeed={initialSpeed}
                onManualOfflineTrigger={manualOfflineTriggerHandler}
                isSleepMode={isSleepMode}
                setClearStats={setClearStats}
                setOwnerId={setOwnerId}
                setManualOffline={setManualOffline}
              />

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xxl:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
                <StatsCards
                  stats={stats}
                  authToken={authToken}
                  ownerId={ownerId}
                  isOnline={isOnline}
                  activityInterval={activityInterval}
                  isLogging={isLogging}
                />

                {/* {isOnline ? (
                  <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <ClockAlert className="text-red-600 text-xl sm:text-2xl" />
                      <p className="text-2xl sm:text-3xl font-bold text-red-800">
                        {Math.floor((+trackedHourDetails.idleTime ?? 0) / 60)}
                      </p>
                    </div>
                    <p className="text-sm text-red-600 font-medium">
                      Idle Time (min)
                    </p>
                  </div>
                ) : null} */}

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <Gauge className="text-purple-600 text-xl sm:text-2xl" />
                    <p className="text-2xl sm:text-3xl font-bold">
                      <InternetSpeedTracker
                        interval={activityLocationInterval}
                        isOnline={isOnline}
                        isLogging={isLogging}
                        setInitialSpeed={setInitialSpeed}
                        authToken={authToken}
                        ownerId={ownerId}
                        key={isOnline}
                      />
                    </p>
                  </div>
                  <p className="text-sm text-purple-600 font-medium">
                    Internet Speed (Mbps)
                  </p>
                </div>

                <div className="bg-gradient-to-br from-emerald-100 to-green-200 p-4 sm:p-6 rounded-xl shadow shadow-emerald-200 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <Hourglass className="text-emerald-600 !h-6 !w-6" />
                    <SlidingTimeDisplay
                      seconds={trackedHourDetails.trackedHourInSeconds}
                      animate={animate}
                      fetchActiveTime={fetchActiveTime}
                      isOnline={isOnline}
                    />
                  </div>
                  <p className="text-sm text-emerald-700 font-semibold">
                    Active Time
                  </p>
                </div>

                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <Activity className="text-purple-600 text-xl sm:text-2xl" />
                    <p className="text-indigo-600 text-2xl sm:text-3xl font-bold">
                      {stats.lastActive || '--'}
                    </p>
                  </div>
                  <p className="text-sm text-purple-600 font-medium">
                    Last Active
                  </p>
                </div>

                {/* <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <FiClock className="text-orange-600 text-xl sm:text-2xl" />
                    <p className="text-orange-800 text-2xl sm:text-3xl font-bold">
                      {captureInterval}{' '}
                      {captureInterval <= 1 ? 'minute' : 'minutes'}
                    </p>
                  </div>
                  <p className="text-sm text-orange-600 font-medium">
                    Capture Interval
                  </p>
                </div> */}
              </div>

              {isOnline ? (
                <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-xl p-4 leading-relaxed">
                  <p>
                    When App goes from{' '}
                    <span className="font-semibold">offline</span> to
                    <span className="font-semibold"> online</span>, then there
                    is a sync from the
                    <span className="font-semibold"> local exe</span> to the
                    <span className="font-semibold"> server</span>.{' '}
                    <span className="font-semibold">Active time</span> may take
                    few minutes to update or click
                    <span className="font-semibold"> refresh icon</span>{' '}
                    <span className="inline-block align-middle">
                      <RefreshCw size={16} />
                    </span>{' '}
                    in the active time section.
                  </p>

                  <p className="mt-1 text-xs italic text-blue-700">
                    * Sync duration may vary depending on network speed and data
                    size.
                  </p>
                </div>
              ) : null}

              {/* Keys Pressed Section */}
              {IS_PRODUCTION ? null : (
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6 rounded-xl shadow-sm mb-6 min-h-[300px] sm:min-h-[400px] overflow-y-auto">
                  <div className="flex items-center mb-3">
                    <Keyboard className="text-gray-600 text-lg sm:text-xl mr-2" />
                    <h2 className="font-semibold text-gray-700 text-base sm:text-lg">
                      Keys pressed:
                    </h2>
                  </div>
                  <p className="whitespace-normal break-words text-gray-600 text-sm sm:text-base">
                    {stats.accumulatedText}
                  </p>
                </div>
              )}
            </div>

            {activeTab === 'past' && (
              <PastActivities
                authToken={authToken}
                ownerId={ownerId}
                isOnline={isOnline}
              />
            )}

            {activeTab === 'app-usage' && (
              <AppUsage
                authToken={authToken}
                ownerId={ownerId}
                isOnline={isOnline}
              />
            )}
          </>
        ) : (
          <>
            <div className="flex justify-center items-center h-64">
              <select
                onChange={handleWorkspaceSelection}
                className="bg-gray-100 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
              >
                <option value="">Select a workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.ownerId} value={workspace.ownerId}>
                    {workspace.workspaceName}
                  </option>
                ))}
              </select>
            </div>

            <div className="px-6 pb-4 border-gray-200 sm:px-8">
              <p className="text-center text-sm text-gray-600 mb-3">
                Can’t see your workspace list? <br />
                <span className="text-red-600 font-bold">
                  Click below to refresh
                </span>{' '}
                after waiting for at least{' '}
                <span className="font-bold">1-2 minutes.</span>
              </p>

              <button
                onClick={fetchWorkspaces}
                className="mx-auto w-max flex justify-center items-center py-2 px-4 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-800 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 transition duration-150"
              >
                <RefreshCcw className="mr-2 !w-4 !h-4" />
                Fetch Workspaces
              </button>
            </div>
          </>
        )}
      </div>

      {/* Logout Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-gray-900 bg-opacity-50 z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">
                Confirm Logout
              </h2>
              <button
                onClick={() => setShowLogoutModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <p className="text-gray-600 mb-4">
                Are you sure you want to logout?
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivityLogger;
