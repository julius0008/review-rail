type ObserverLogoProps = {
  compact?: boolean;
  className?: string;
};

export function ObserverLogo({
  compact = false,
  className = "",
}: ObserverLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className={compact ? "h-10 w-10" : "h-12 w-12"}
      >
        <defs>
          <linearGradient id="observer-orbit" x1="10" y1="8" x2="54" y2="56">
            <stop offset="0%" stopColor="#8ED6FF" />
            <stop offset="55%" stopColor="#66A3FF" />
            <stop offset="100%" stopColor="#7EE2C8" />
          </linearGradient>
          <linearGradient id="observer-iris" x1="24" y1="18" x2="42" y2="46">
            <stop offset="0%" stopColor="#EEF5FF" />
            <stop offset="100%" stopColor="#8ED6FF" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="18" fill="#0C1422" />
        <path
          d="M10 32c5.4-10.2 13.4-15.3 22-15.3S48.6 21.8 54 32c-5.4 10.2-13.4 15.3-22 15.3S15.4 42.2 10 32Z"
          fill="rgba(102,163,255,0.08)"
          stroke="url(#observer-orbit)"
          strokeWidth="2.4"
        />
        <circle cx="32" cy="32" r="10.5" fill="url(#observer-iris)" />
        <circle cx="32" cy="32" r="4.6" fill="#0C1422" />
        <circle cx="36.4" cy="27.6" r="2.6" fill="#FFFFFF" fillOpacity="0.92" />
        <path
          d="M47.5 15.5 52 11"
          stroke="#7EE2C8"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {!compact && (
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[0.18em] text-slate-100 uppercase">
            Observer
          </div>
          <div className="text-xs text-slate-400">
            Pull request oversight
          </div>
        </div>
      )}
    </div>
  );
}
