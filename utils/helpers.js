import axios from 'axios';
import { BASE_URL } from './constants';

export const getEmployeeToken = () => localStorage.getItem('employeeAuthToken');

export const getSystemTimezone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

export const getSpeed = async () => {
  const url = `${BASE_URL}/public/sample-files/image.jpg`;

  try {
    const startTime = Date.now();

    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch speed test file: ${response.status} ${response.statusText}`
      );
    }

    const blob = await response.blob();
    const endTime = Date.now();

    const duration = (endTime - startTime) / 1000;
    const fileSizeInBits = blob.size * 8;

    const speed = fileSizeInBits / duration;
    return speed;
  } catch (error) {
    console.error('Error fetching speed test file:', error.message || error);
    return 0;
  }
};
