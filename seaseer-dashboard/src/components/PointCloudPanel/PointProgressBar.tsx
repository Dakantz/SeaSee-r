import React from "react";

export interface PointProgressBarProps {
  /** Current number of points loaded into 3D scene */
  loadedPoints: number;
  /** Total number of points in dataset at LOD0 (full resolution) */
  totalPoints?: number | null;
  /** Streaming in progress flag */
  isLoadingStream?: boolean;
  /** Stream completed flag (LOD0 loaded) */
  isLoadedStream?: boolean;
  /** Optional custom CSS class */
  className?: string;
  /** Compact representation for single-line / collapsed view */
  compact?: boolean;
}

/**
 * PointProgressBar Component
 * Displays a visual progress bar indicating the number of 3D points loaded.
 * Reaches 100% full capacity when LOD0 (full resolution base stream) is fully loaded.
 */
export const PointProgressBar: React.FC<PointProgressBarProps> = ({
  loadedPoints,
  totalPoints,
  isLoadingStream = false,
  isLoadedStream = false,
  className = "",
  compact = false,
}) => {
  const effectiveTotal = totalPoints && totalPoints > 0 ? totalPoints : null;

  // Enforce progress calculations prioritizing active streaming state
  let percent = 0;
  if (effectiveTotal && loadedPoints > 0) {
    percent = Math.min(100, Math.max(0, (loadedPoints / effectiveTotal) * 100));
  }
  else if (isLoadedStream) {
    percent = 100;
  }
  else {
    percent = 0;
  }

  // Fallback display loaded point count (if stream loaded, fallback to totalPoints if loadedPoints is 0)
  const displayLoaded =
    isLoadedStream && (!loadedPoints || loadedPoints === 0) && effectiveTotal
      ? effectiveTotal
      : loadedPoints;

  const formattedLoaded = displayLoaded.toLocaleString();
  const formattedTotal = effectiveTotal ? effectiveTotal.toLocaleString() : null;

  const isComplete = isLoadedStream && !isLoadingStream;

  if (compact) {
    return (
      <div
        className={`point-progress-bar point-progress-bar--compact ${className}`}
        title={`Loaded ${formattedLoaded}${formattedTotal ? ` / ${formattedTotal}` : ""} points (${percent.toFixed(0)}%)`}
      >
        <div className="point-progress-bar__track">
          <div
            className={`point-progress-bar__fill ${
              isComplete
                ? "point-progress-bar__fill--complete"
                : isLoadingStream
                ? "point-progress-bar__fill--streaming"
                : ""
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`point-progress-bar ${className}`}>
      <div className="point-progress-bar__info">
        <span className="point-progress-bar__label">Points Loaded:</span>
        <span className="point-progress-bar__count">
          <strong className="point-progress-bar__val">{formattedLoaded}</strong>
          {formattedTotal ? (
            <span className="point-progress-bar__total"> / {formattedTotal} pts</span>
          ) : (
            <span className="point-progress-bar__total"> pts</span>
          )}
        </span>
        <span
          className={`point-progress-bar__badge ${
            isComplete
              ? "point-progress-bar__badge--complete"
              : isLoadingStream
              ? "point-progress-bar__badge--streaming"
              : ""
          }`}
        >
          {isComplete
            ? "100% (LOD0 Loaded)"
            : isLoadingStream
            ? `Streaming... ${percent.toFixed(0)}%`
            : `${percent.toFixed(0)}%`}
        </span>
      </div>

      <div className="point-progress-bar__track">
        <div
          className={`point-progress-bar__fill ${
            isComplete
              ? "point-progress-bar__fill--complete"
              : isLoadingStream
              ? "point-progress-bar__fill--streaming"
              : ""
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

export default PointProgressBar;
