import axios from 'axios';
import { API_BASE_URL } from '../../utils/constants';
import moment from 'moment';

export function activityActions(authToken, activityType, payload, isDetail) {
  return async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/employee/v3/project/project/task/activity${isDetail ? '/detail' : ''}/${activityType}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
        ...(activityType === 'start' || isDetail
          ? {
              id: response?.data?.data?.id,
            }
          : {}),
        ...(isDetail || activityType === 'end'
          ? {
              totalTime: 60,
              idleTime: response?.data?.data?.idleTime,
            }
          : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: error?.response || {
          status: 500,
          data: { error: 'Internal Server Error' },
        },
      };
    }
  };
}

export function getActivityEndStatus(authToken, payload) {
  return async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/employee/project/project/task/activity/get`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
        data: response?.data?.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error,
      };
    }
  };
}

export function removeActivityDetailTimeout(authToken, payload) {
  return async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/employee/project/project/task/activity/timeout/remove`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error,
      };
    }
  };
}

export function hardResetApp(authToken, payload) {
  return async () => {
    try {
      await axios.post(`${API_BASE_URL}/employee/project/hard-reset`, payload, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error,
      };
    }
  };
}

export function fetchTrackingTimeDetails(authToken, payload) {
  return async () => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/employee/v3/project/tracked-hours/minute-wise`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
        data: res?.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error,
      };
    }
  };
}

export function getInitialStatsForToday(authToken, payload) {
  return async () => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/employee/v3/project/stats/minute-wise`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
        data: res?.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error,
      };
    }
  };
}

export function sendInternetSpeedGeolocation(authToken, payload) {
  return async () => {
    try {
      const res = await axios.post(
        `${API_BASE_URL}/employee/v3/employee-internet-speed/add`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error,
      };
    }
  };
}
