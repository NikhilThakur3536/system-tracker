import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { getInitialStatsForToday } from '../redux/activity/activityActions';
import { MousePointer, Move, Keyboard } from 'lucide-react';

const StatsCards = ({
  stats,
  authToken,
  ownerId,
  isOnline,
  activityInterval,
}) => {
  const dispatch = useDispatch();
  const initialStatsState = {
    clickCount: 0,
    keyCount: 0,
    scrollCount: 0,
  };
  const [initialStats, setInitialStats] = useState(initialStatsState);

  const statsCountDayWiseApiCall = () => {
    dispatch(getInitialStatsForToday(authToken, { ownerId }))
      .then((status) => {
        if (status?.success) {
          const resData = status?.data?.data;
          const statsCount = {
            clickCount: resData?.mouseClick,
            keyCount: resData?.keystroke,
            scrollCount: resData?.scroll,
          };
          setInitialStats(statsCount);
          localStorage.setItem(
            'todaysStatsCountForUser',
            JSON.stringify(statsCount)
          );
        } else {
          setInitialStats(initialStatsState);
        }
      })
      .catch(() => setInitialStats(initialStatsState));
  };

  useEffect(() => {
    if (authToken && ownerId) {
      if (isOnline) {
        let statsCountTimeout;

        statsCountTimeout = setTimeout(statsCountDayWiseApiCall, 0);
        statsCountTimeout = setTimeout(
          statsCountDayWiseApiCall,
          (activityInterval || 1) * 60 * 1000 + 1000
        );

        return () => {
          if (statsCountTimeout) clearTimeout(statsCountTimeout);
        };
      } else {
        if (typeof window !== undefined) {
          const statsCount = localStorage.getItem('todaysStatsCountForUser')
            ? JSON.parse(localStorage.getItem('todaysStatsCountForUser'))
            : null;
          setInitialStats(statsCount || initialStatsState);
        }
      }
    }
  }, [authToken, ownerId, isOnline]);

  return (
    <>
      <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-2">
          <MousePointer className="text-blue-600 text-xl sm:text-2xl" />
          <p className="text-2xl sm:text-3xl font-bold text-blue-800">
            {+initialStats.clickCount + stats.clickCount}
          </p>
        </div>
        <p className="text-sm text-blue-600 font-medium">Mouse Clicks</p>
      </div>
      <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-2">
          <Keyboard className="text-green-600 text-xl sm:text-2xl" />
          <p className="text-2xl sm:text-3xl font-bold text-green-800">
            {+initialStats.keyCount + stats.keyCount}
          </p>
        </div>
        <p className="text-sm text-green-600 font-medium">Keystrokes</p>
      </div>
      <div className="bg-gradient-to-br from-purple-100 to-pink-200 p-4 sm:p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-2">
          <Move className="text-purple-700 text-xl sm:text-2xl" />
          <p className="text-2xl sm:text-3xl font-bold text-pink-800">
            {+initialStats.scrollCount + stats.scrollCount}
          </p>
        </div>
        <p className="text-sm text-purple-700 font-medium">Scrolls</p>
      </div>
    </>
  );
};

export default StatsCards;
