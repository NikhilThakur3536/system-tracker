export default function Loader({ isLoading, children }) {
  return (
    <div className="relative">
      {children}
      {isLoading && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center"
          style={{ zIndex: 1000 }}
        >
          <p className="text-white text-5xl font-semibold animate-pulse">
            Loading...
          </p>
        </div>
      )}
    </div>
  );
}
