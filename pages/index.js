import { useEffect, useState } from 'react';
import ActivityTracker from '../components/ActivityTracker/ActivityTracker';
import { useSelector, useDispatch } from 'react-redux';
import { getAuthDetails } from '../redux/auth/authActions';
import SyncLoader from '../components/ActivityTracker/SyncLoader';
import SleepMode from '../components/ActivityTracker/SleepMode';
import Forbidden403 from '../components/ActivityTracker/Forbidden403';
import { sendRestartSessionRequest } from '../redux/activity/activityActions';
import ApiErrorLogger from '../components/ApiErrorLogger';
import ApiSuccessLogger from '../components/SuccessToast';
import BlockerAlert from '../components/BlockerAlert';

const ActivityLogger = () => {
  const [domainId, setDomainId] = useState(null);

  const [isLoginFound, setIsLoginFound] = useState(false);

  const isOnline = useSelector(
    (state) => state.employee.internetConnectionStatus
  );
  const dispatch = useDispatch();

  const [isSyncing, setIsSyncing] = useState(false);
  const [isSleepMode, setIsSleepMode] = useState(false);
  const [blockerAlert, setBlockerAlert] = useState(null);

  useEffect(() => {
    dispatch(getAuthDetails());
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('deviceId')) {
      window.electronAPI?.onDeviceId((deviceId) => {
        if (!deviceId) return;

        localStorage.setItem('deviceId', deviceId);
      });

      window.electronAPI?.getDeviceId();
    }
  }, []);

  useEffect(() => {
    const handleSyncingStatus = (status) => {
      setIsSyncing(status);
    };

    const handleSleepModeStatus = (status) => {
      setIsSleepMode(status);
    };

    if (typeof window !== 'undefined' && window?.electronAPI) {
      window.electronAPI.onSyncing?.(handleSyncingStatus);
      window.electronAPI.onSleepMode?.(handleSleepModeStatus);
    }

    return () => {
      if (typeof window !== 'undefined' && window?.electronAPI) {
        window.electronAPI.removeSyncingListener?.();
        window.electronAPI.removeSleepModeListeners?.();
      }
    };
  }, []);

  useEffect(() => {
    const handleBlockerAlert = (alert) => setBlockerAlert(alert);

    if (typeof window !== 'undefined' && window?.electronAPI) {
      window.electronAPI.onBlockerAlert?.(handleBlockerAlert);
    }

    return () => {
      if (typeof window !== 'undefined' && window?.electronAPI) {
        window.electronAPI.removeBlockerAlertListener?.();
      }
    };
  }, []);

  const [apiError, setApiError] = useState(null);
  const [sessionStoppageSuccess, setSessionStoppageSuccess] = useState(null);

  async function onRestartRequest() {
    const isLoggedIn = localStorage.getItem('employeeAuthToken');
    const employeeDetails = JSON.parse(localStorage.getItem('employeeDetails'));
    const email = employeeDetails?.email;

    if (isLoggedIn && email) {
      const status = await dispatch(
        sendRestartSessionRequest({
          domainId,
          email,
        })
      );
      if (status?.success) {
        setIsLoginFound(false);
        setSessionStoppageSuccess(true);
      } else {
        const error = status?.error;
        const errorStatus = error?.status;
        const errorMessage = error?.data?.error;

        setApiError({
          message: errorMessage,
          code: errorStatus,
        });
      }
    }
  }

  return (
    <SyncLoader isSyncing={isSyncing}>
      <BlockerAlert alert={blockerAlert} />

      {apiError ? (
        <ApiErrorLogger error={apiError} onClose={() => setApiError(null)} />
      ) : null}

      {sessionStoppageSuccess ? (
        <ApiSuccessLogger
          title="Session Stopped!"
          message="Session stopped on another device. You can continue with the new session on this device."
          onClose={() => setSessionStoppageSuccess(false)}
        />
      ) : null}

      {isLoginFound ? (
        <Forbidden403 onRestartRequest={onRestartRequest} />
      ) : isSleepMode ? (
        <SleepMode />
      ) : (
        <ActivityTracker
          isOnline={isOnline}
          key={isSleepMode}
          isSleepMode={isSleepMode}
          setIsLoginFound={setIsLoginFound}
          domainId={domainId}
          setDomainId={setDomainId}
        />
      )}
    </SyncLoader>
  );
};

export default ActivityLogger;
