import { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { gettingEmployeeActionsList } from '../../redux/employee/employeeActions';
import { activityActions } from '../../redux/activity/activityActions';
import { BASE_URL, TRACKER_VERSION } from '../../utils/constants';
import { getSpeed, getSystemTimezone } from '../../utils/helpers';
import {
  DEFAULT_SCREENSHOT_TYPE,
  SERVER_ERROR_INTERVAL_RETEST,
} from '../../utils/constants';
import axios from 'axios';

const useTaskLogic = (
  ownerId,
  authToken,
  stats,
  activityInterval,
  setActiveSession,
  stopLogging,
  startLogging,
  projects,
  tasks,
  projectTaskId,
  setProjectTaskId,
  description,
  setDescription,
  endedActivityRestart,
  setEndedActivityRestart,
  setIsLoading,
  trackedHourDetails,
  updateTrackedHourDetails,
  setApiError,
  isLogging,
  initialSpeed,
  onManualOfflineTrigger,
  isSleepMode,
  setClearStats,
  setOwnerId
) => {
  const dispatch = useDispatch();
  const isOnline = useSelector(
    (state) => state.employee.internetConnectionStatus
  );
  const workspaces = useSelector((state) => state?.employee?.workspaces?.list);

  const activityIntervalRef = useRef(null);
  const intervalStartTimeRef = useRef(null);
  const statsRef = useRef(stats);
  const projectTaskActivityDetailIdRef = useRef(null);

  const initialLastStats = {
    clickCount: 0,
    scrollCount: 0,
    keyCount: 0,
    accumulatedText: [],
    // appWebsiteDetails: [],
  };
  const lastStatsRef = useRef(initialLastStats);
  const [hasInitialisedLastStats, setHasInitialisedLastStats] = useState(false);

  const [projectId, setProjectId] = useState('');

  const [projectTaskActivityId, setProjectTaskActivityId] = useState(null);
  const [projectTaskActivityDetailId, setProjectTaskActivityDetailId] =
    useState(null);

  useEffect(() => {
    setProjectId('');
    setProjectTaskId('');
    if (authToken && !isLogging) {
      if (!projects || projects?.length === 0)
        dispatch(
          gettingEmployeeActionsList(
            authToken,
            'employee/project/project/list',
            'projects',
            { ownerId }
          )
        );
    }
  }, [ownerId, authToken, dispatch, isLogging]);

  useEffect(() => {
    setProjectTaskId('');
    if (projectId && authToken) {
      dispatch(
        gettingEmployeeActionsList(
          authToken,
          'employee/project/project/task/list',
          'tasks',
          {
            ownerId,
            projectId,
          }
        )
      );
    }
  }, [projectId, ownerId, authToken, dispatch]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    projectTaskActivityDetailIdRef.current = projectTaskActivityDetailId;
  }, [projectTaskActivityDetailId]);

  const fetchSpeed = useCallback(async () => {
    if (isLogging && authToken && isOnline) {
      const speed = await getSpeed();
      return speed || 0;
    }
  }, [isLogging, authToken, isOnline]);

  const getIpAddress = useCallback(async () => {
    let ipAddress = 'offline';
    if (authToken && isOnline) {
      try {
        const response = await axios.get('https://api.ipify.org?format=json');
        ipAddress = response.data.ip;
      } catch (error) {
        ipAddress = 'unknown';
        console.error('Failed to fetch ip address:', error.message);
      }

      return ipAddress;
    }
  }, [isLogging, authToken, isOnline]);

  // ----- Offline tracked time start -------

  const idleTimeIntervalRef = useRef(5);

  useEffect(() => {
    if (typeof window !== 'undefined' && window?.electronAPI) {
      window.electronAPI.getIdleTimeInterval((interval) => {
        idleTimeIntervalRef.current = interval;
      });
    }
  }, [authToken]);

  const inactivityCountRef = useRef(0);
  const trackedHourDetailsRef = useRef({
    totalTime: 0,
    idleTime: 0,
  });

  useEffect(() => {
    if (!isOnline && trackedHourDetails?.trackedHourInSeconds >= 0) {
      trackedHourDetailsRef.current = {
        ...trackedHourDetails,
      };
    }
  }, [isOnline]);

  // ----- Offline tracked time end -------

  const failureCountRef = useRef(0);

  async function serverOfflineTriggerHandler(status) {
    if (String(status?.error?.status)?.startsWith('5')) {
      try {
        const response = await fetch(`${BASE_URL}/test`, {
          method: 'HEAD',
          mode: 'cors',
          cache: 'no-store',
        }).catch(() => onManualOfflineTrigger?.());

        if (!response.ok) {
          if (
            status?.error?.data?.error?.toLowerCase() !== 'socket hang up' &&
            !String(status?.error).includes('hang up')
          ) {
            onManualOfflineTrigger?.();
          }
        }
      } catch (err) {
        onManualOfflineTrigger?.();
      }
    }
  }

  const activityDataHandler = async () => {
    const dipatchActivityDetailsInterval = () => {
      const updatedStats = statsRef.current;
      const lastStats = lastStatsRef.current;

      const getPositiveDifference = (current = 0, previous = 0) => {
        const diff = +current - +previous;
        return diff > 0 ? diff : 0;
      };

      const activityDifference = {
        mouseClick: getPositiveDifference(
          updatedStats?.clickCount,
          lastStats.clickCount
        ),
        scroll: getPositiveDifference(
          updatedStats?.scrollCount,
          lastStats.scrollCount
        ),
        keystroke: getPositiveDifference(
          updatedStats?.keyCount,
          lastStats.keyCount
        ),
        keyPressed: updatedStats?.accumulatedText?.slice(
          lastStats?.accumulatedText?.length
        ),
        // appWebsiteDetails: updatedStats?.appWebsiteDetails?.slice(
        //   0,
        //   updatedStats?.appWebsiteDetails?.length -
        //     lastStats?.appWebsiteDetails?.length
        // ),
      };

      lastStatsRef.current = {
        clickCount: +updatedStats?.clickCount,
        scrollCount: +updatedStats?.scrollCount,
        keyCount: +updatedStats?.keyCount,
        accumulatedText: updatedStats?.accumulatedText,
        // appWebsiteDetails: updatedStats?.appWebsiteDetails,
      };

      if (isOnline) {
        const currentProjectActivityId =
          projectTaskActivityId ||
          localStorage.getItem('projectTaskActivityId');

        const startTime = intervalStartTimeRef.current;
        intervalStartTimeRef.current = Date.now();

        dispatch(
          activityActions(
            authToken,
            'interval',
            {
              ownerId,
              appWebsites: updatedStats?.appWebsites || [],
              timezone: getSystemTimezone(),
              projectTaskActivityId: currentProjectActivityId,
              ...activityDifference,
              startTime: new Date(startTime).toISOString(),
              endTime: new Date().toISOString(),
            },
            true
          )
        ).then(async (status) => {
          if (status?.success) {
            failureCountRef.current = 0;

            const hasActivity =
              activityDifference.mouseClick > 0 ||
              activityDifference.scroll > 0 ||
              activityDifference.keystroke > 0;

            if (hasActivity) {
              inactivityCountRef.current = 0;
              updateTrackedHourDetails(status?.totalTime, 0);
            } else {
              inactivityCountRef.current += 1;

              if (inactivityCountRef.current <= idleTimeIntervalRef.current) {
                updateTrackedHourDetails(status?.totalTime, 0);
              }
            }

            setProjectTaskActivityDetailId(status?.id);
            localStorage.setItem('projectTaskActivityDetailId', status?.id);
          } else {
            console.log('End activity error:', status?.error?.data?.error);

            failureCountRef.current += 1;

            if (failureCountRef.current === SERVER_ERROR_INTERVAL_RETEST) {
              await serverOfflineTriggerHandler(status);
              failureCountRef.current = 0;
            }
          }
        });
      } else {
        const now = Date.now();
        const durationInSec = Math.floor(
          (now - intervalStartTimeRef.current) / 1000
        );

        const offlineActivityData = {
          ownerId,
          projectTaskActivityId:
            projectTaskActivityId ||
            localStorage.getItem('projectTaskActivityId'),
          appWebsites: updatedStats?.appWebsites || [],
          timezone: getSystemTimezone(),
          ...activityDifference,
          startTime: new Date(intervalStartTimeRef.current).toISOString(),
          endTime: new Date().toISOString(),
        };

        const hasActivity =
          activityDifference.mouseClick > 0 ||
          activityDifference.scroll > 0 ||
          activityDifference.keystroke > 0;

        if (hasActivity) {
          inactivityCountRef.current = 0;
          trackedHourDetailsRef.current.trackedHourInSeconds += durationInSec;
          window.electronAPI.sendOfflineActivityData?.(offlineActivityData);
        } else {
          inactivityCountRef.current += 1;

          if (inactivityCountRef.current <= idleTimeIntervalRef.current) {
            trackedHourDetailsRef.current.trackedHourInSeconds += durationInSec;
            window.electronAPI.sendOfflineActivityData?.(offlineActivityData);
          } else {
            trackedHourDetailsRef.current.idleTime += durationInSec;
          }
        }

        updateTrackedHourDetails(
          trackedHourDetailsRef.current.trackedHourInSeconds,
          trackedHourDetailsRef.current.idleTime
        );

        localStorage.setItem(
          'offlineTrackedHours',
          JSON.stringify({
            trackedHourInSeconds:
              trackedHourDetailsRef.current.trackedHourInSeconds,
            idleTime: trackedHourDetailsRef.current.idleTime,
          })
        );

        intervalStartTimeRef.current = Date.now();
      }
    };

    if (!isOnline && intervalStartTimeRef.current) {
      const bufferTimeInSeconds = 5000;
      const currentTime = Date.now();
      const intervalDuration = (activityInterval || 1) * 1000 * 60;
      const elapsedTime = currentTime - intervalStartTimeRef.current;
      const remainingTime =
        intervalDuration - elapsedTime + bufferTimeInSeconds;

      if (remainingTime > 0) {
        setTimeout(() => {
          intervalStartTimeRef.current = Date.now() + bufferTimeInSeconds;

          if (activityIntervalRef.current) {
            clearInterval(activityIntervalRef.current);
          }

          activityIntervalRef.current = setInterval(
            dipatchActivityDetailsInterval,
            (activityInterval || 1) * 1000 * 60
          );
        }, remainingTime);

        return;
      }
    }

    if (activityIntervalRef.current) {
      clearInterval(activityIntervalRef.current);
    }

    activityIntervalRef.current = setInterval(
      dipatchActivityDetailsInterval,
      (activityInterval || 1) * 1000 * 60
    );
  };

  const projectDetailActions = async () => {
    intervalStartTimeRef.current = Date.now();

    setIsLoading(false);
    await activityDataHandler();
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    setIsLoading(true);

    const geoLocation = await window.electronAPI.getGeoLocation();
    const speed = initialSpeed || (await fetchSpeed());

    const payload = {
      ownerId,
      ...(projectTaskId ? { projectTaskId } : {}),
      ...(description ? { description } : {}),
      timezone: getSystemTimezone(),
      ...geoLocation,
      speed,
      trackerVersion: TRACKER_VERSION,
      ipAddress: await getIpAddress(),
    };

    const activeSessionObj = {
      projectName: projects.find((p) => p?.id === projectId)?.name,
      projectTaskName: tasks?.find((t) => t?.id === projectTaskId)?.name,
      description,
      workspaceName: workspaces?.find((w) => w.ownerId === ownerId)
        ?.workspaceName,
    };

    setActiveSession(activeSessionObj);
    localStorage.setItem('activeSession', JSON.stringify(activeSessionObj));
    localStorage.setItem('projectTaskId', projectTaskId);

    dispatch(activityActions(authToken, 'start', payload))
      .then(async (status) => {
        if (status?.success) {
          setProjectTaskActivityId(status?.id);
          localStorage.setItem('projectTaskActivityId', status?.id);

          const userData = {
            ownerId,
          };
          window.electronAPI.sendActivityData(userData);
          startLogging();

          projectDetailActions();
        } else {
          console.log(status?.error);
        }
      })
      .finally(() => setIsLoading(false));
  };

  const stopLoggingHandler = async () => {
    setIsLoading(true);

    if (activityIntervalRef.current) {
      clearInterval(activityIntervalRef.current);
      activityIntervalRef.current = null;
    }

    let ipAddress = await getIpAddress();

    const lastStats = lastStatsRef.current;

    const getPositiveDifference = (current = 0, previous = 0) => {
      const diff = +current - +previous;
      return diff > 0 ? diff : 0;
    };

    const activityDifference = {
      mouseClick: getPositiveDifference(
        stats?.clickCount,
        lastStats.clickCount
      ),
      scroll: getPositiveDifference(stats?.scrollCount, lastStats.scrollCount),
      keystroke: getPositiveDifference(stats?.keyCount, lastStats.keyCount),
      keyPressed: stats?.accumulatedText?.slice(
        lastStats?.accumulatedText?.length
      ),
      // appWebsiteDetails: stats?.appWebsiteDetails?.slice(
      //   0,
      //   stats?.appWebsiteDetails?.length - lastStats?.appWebsiteDetails?.length
      // ),
    };

    try {
      const currentProjectActivityId =
        projectTaskActivityId || localStorage.getItem('projectTaskActivityId');

      const startTime = intervalStartTimeRef.current;

      intervalStartTimeRef.current = Date.now();

      const endActivityDetail = await dispatch(
        activityActions(
          authToken,
          'interval',
          {
            ownerId,
            projectTaskActivityId: currentProjectActivityId,
            appWebsites: stats?.appWebsites || [],
            timezone: getSystemTimezone(),
            ...activityDifference,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString(),
          },
          true
        )
      );

      if (endActivityDetail?.success) {
        setProjectTaskActivityDetailId(null);
        localStorage.removeItem('projectTaskActivityDetailId');
        lastStatsRef.current = initialLastStats;
        intervalStartTimeRef.current = null;
      } else {
        setApiError({
          message: endActivityDetail?.error?.data?.error,
          code: endActivityDetail?.error?.status,
        });
        setIsLoading(false);
        return;
      }

      const endMainActivity = await dispatch(
        activityActions(authToken, 'end', {
          ownerId,
          trackerVersion: TRACKER_VERSION,
          ipAddress,
          projectTaskActivityId: currentProjectActivityId,
        })
      );

      if (endMainActivity?.success) {
        let initialStats = {
          clickCount: 0,
          keyCount: 0,
          scrollCount: 0,
        };
        if (
          typeof window !== undefined &&
          localStorage.getItem('todaysStatsCountForUser')
        ) {
          initialStats = JSON.parse(
            localStorage.getItem('todaysStatsCountForUser')
          );
        }

        const statsCount = {
          clickCount: initialStats?.clickCount + (stats?.clickCount || 0),
          keyCount: initialStats?.keyCount + (stats?.keyCount || 0),
          scrollCount: initialStats?.scrollCount + (stats?.scrollCount || 0),
        };

        localStorage.setItem(
          'todaysStatsCountForUser',
          JSON.stringify(statsCount)
        );

        localStorage.setItem('statsUpdateNeeded', true);

        setProjectId('');
        setProjectTaskId('');
        setProjectTaskActivityId(null);
        setDescription('');
        setActiveSession(null);

        localStorage.removeItem('activeSession');
        localStorage.removeItem('projectTaskId');
        localStorage.removeItem('projectTaskActivityId');
        localStorage.removeItem('screenshotType');

        window.electronAPI.sendScreenshotType?.(DEFAULT_SCREENSHOT_TYPE);

        stopLogging();

        const userData = {
          ownerId: null,
        };
        window.electronAPI.sendActivityData(userData);
      } else {
        setApiError({
          message: endMainActivity?.error?.data?.error,
          code: endMainActivity?.error?.status,
        });
        return;
      }
    } catch (error) {
      setApiError({
        message: error?.error?.data?.error,
        code: error?.error?.status,
      });
      return;
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit(e);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && authToken !== null) {
      const storedIsLogging = JSON.parse(localStorage.getItem('isLogging'));
      const storedOwnerId = localStorage.getItem('ownerId');
      const storedProjectTaskActivityId = localStorage.getItem(
        'projectTaskActivityId'
      );
      const storedProjectTaskActivityDetailId = localStorage.getItem(
        'projectTaskActivityDetailId'
      );

      if (storedIsLogging) {
        if (storedOwnerId && storedProjectTaskActivityId) {
          const fetchData = async () => {
            if (isOnline) {
              setIsLoading(true);
            }

            if (storedProjectTaskActivityDetailId) {
              setProjectTaskActivityDetailId(storedProjectTaskActivityDetailId);
            }

            const updatedStats = statsRef.current;
            lastStatsRef.current = {
              clickCount: +updatedStats?.clickCount,
              scrollCount: +updatedStats?.scrollCount,
              keyCount: +updatedStats?.keyCount,
              accumulatedText: updatedStats?.accumulatedText,
              // appWebsiteDetails: updatedStats?.appWebsiteDetails,
            };

            const startUserData = {
              ownerId: storedOwnerId,
              timezone: getSystemTimezone(),
            };

            try {
              await activityDataHandler(startUserData);
            } catch (error) {
              console.error('Error in start activity handler:', error);
            }
          };

          fetchData();
        }
      }
    }

    return () => {
      if (activityIntervalRef.current) {
        clearInterval(activityIntervalRef.current);
        activityIntervalRef.current = null;
      }
    };
  }, [authToken, isOnline, isSleepMode]);

  function manualRestartTrigger() {
    setIsLoading(false);
    if (activityIntervalRef.current) {
      clearInterval(activityIntervalRef.current);
      activityIntervalRef.current = null;
    }

    setProjectTaskActivityDetailId(null);
    setProjectTaskActivityId(null);
    setActiveSession(null);
    setProjectTaskId('');
    setProjectId('');
    setDescription('');

    localStorage.removeItem('projectTaskActivityDetailId');
    localStorage.removeItem('projectTaskActivityId');
    localStorage.removeItem('activeSession');
    localStorage.removeItem('projectTaskId');
    localStorage.removeItem('screenshotType');
    localStorage.removeItem('ownerId');

    window.electronAPI.sendScreenshotType?.(DEFAULT_SCREENSHOT_TYPE);

    stopLogging();
    const userData = {
      ownerId: null,
    };
    window.electronAPI.sendActivityData(userData);
    setOwnerId(null);
  }

  useEffect(() => {
    if (endedActivityRestart && isOnline) {
      if (typeof window !== 'undefined' && authToken !== null) {
        const storedIsLogging = JSON.parse(localStorage.getItem('isLogging'));
        const storedOwnerId = localStorage.getItem('ownerId');
        const storedProjectTaskId = localStorage.getItem('projectTaskId');
        const storedDescription =
          localStorage.getItem('activeSession')?.description;
        lastStatsRef.current = initialLastStats;

        if (storedIsLogging) {
          if (storedOwnerId) {
            const fetchData = async () => {
              setClearStats(true);
              setIsLoading(true);

              try {
                const geoLocation = await window.electronAPI.getGeoLocation();
                const speed = initialSpeed || (await fetchSpeed());

                const payload = {
                  ownerId: storedOwnerId,
                  ...(storedProjectTaskId
                    ? { projectTaskId: storedProjectTaskId }
                    : {}),
                  description: storedDescription,
                  timezone: getSystemTimezone(),
                  ...geoLocation,
                  trackerVersion: TRACKER_VERSION,
                  speed,
                };

                dispatch(activityActions(authToken, 'start', payload)).then(
                  async (status) => {
                    if (status?.success) {
                      setProjectTaskActivityId(status?.id);
                      localStorage.setItem('projectTaskActivityId', status?.id);

                      const userData = {
                        ownerId,
                      };
                      window.electronAPI.sendActivityData(userData);
                      setClearStats(true);
                      startLogging();
                      projectDetailActions();
                    } else {
                      manualRestartTrigger();
                    }
                  }
                );
              } catch (error) {
                console.error('Error in start activity handler:', error);
                manualRestartTrigger();
              } finally {
                setEndedActivityRestart(false);
              }
            };

            fetchData();
          }
        }
      }
    } else if (!endedActivityRestart) {
      const storedIsLogging = JSON.parse(localStorage.getItem('isLogging'));
      if (storedIsLogging) {
        intervalStartTimeRef.current = Date.now();
        if (!isOnline) {
          setHasInitialisedLastStats(true);
        }
      }
    }
  }, [endedActivityRestart, authToken, isOnline]);

  useEffect(() => {
    if (
      !endedActivityRestart &&
      !isOnline &&
      stats &&
      authToken !== null &&
      typeof stats === 'object' &&
      hasInitialisedLastStats
    ) {
      const storedIsLogging = JSON.parse(localStorage.getItem('isLogging'));
      if (storedIsLogging) {
        lastStatsRef.current = {
          clickCount: +stats?.clickCount,
          scrollCount: +stats?.scrollCount,
          keyCount: +stats?.keyCount,
          accumulatedText: stats?.accumulatedText,
        };
        setHasInitialisedLastStats(false);
      }
    }
  }, [endedActivityRestart, authToken, isOnline, stats]);

  return {
    projectId,
    setProjectId,
    projectTaskId,
    setProjectTaskId,
    description,
    setDescription,
    handleFormSubmit,
    handleKeyDown,
    stopLoggingHandler,
  };
};

export default useTaskLogic;
