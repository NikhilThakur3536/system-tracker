import { ShieldX } from 'lucide-react';

export default function Forbidden403({ onRestartRequest }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 via-orange-50 to-amber-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <ShieldX className="h-8 w-8 text-red-600" />
        </div>

        <h1 className="text-3xl font-bold text-red-700">
          Duplicate Session Alert!
        </h1>

        <div className="mx-auto my-4 h-1 w-12 rounded-full bg-red-500" />

        <p className="text-sm leading-relaxed text-gray-700">
          It seems you already have an{' '}
          <span className="font-semibold text-red-600">open session.</span>.
        </p>

        <p className="mt-4 border-l-4 border-yellow-400 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          If you believe this is a mistake, please{' '}
          <span
            className="font-semibold underline text-yellow-900 cursor-pointer"
            onClick={onRestartRequest}
          >
            click here to start a new session
          </span>
          .
        </p>
      </div>
    </div>
  );
}
