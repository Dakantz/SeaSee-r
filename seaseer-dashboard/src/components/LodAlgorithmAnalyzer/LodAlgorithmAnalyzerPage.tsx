import { FiTarget, FiEye, FiZap, FiRefreshCw, FiGrid, FiActivity, FiCpu } from "react-icons/fi";
import { useLodAlgorithmAnalyzer } from "./useLodAlgorithmAnalyzer";
import { LOD_COLOR_HEX } from "./QuadtreeLodManager";
import "./LodAlgorithmAnalyzerPage.css";

export default function LodAlgorithmAnalyzerPage() {
  const {
    mountRef,
    fps,
    cameraPosText,
    focalPosText,
    mousePosText,
    focalDistance,
    zoomFactor,
    lodAlgorithm,
    setLodAlgorithm,
    maxLOD,
    setMaxLOD,
    distanceFactor,
    setDistanceFactor,
    focalSource,
    setFocalSource,
    simulateAsync,
    setSimulateAsync,
    asyncDelay,
    setAsyncDelay,
    wireframe,
    setWireframe,
    showStatusOverlays,
    setShowStatusOverlays,
    stats,
    handleRecenter,
    handleForceRebuild,
  } = useLodAlgorithmAnalyzer();

  return (
    <div className="lod-analyzer-container">
      {/* 2D Orthographic Viewport */}
      <div ref={mountRef} className="scene-viewport" />

      {/* Primary 2D Analytics HUD Panel */}
      <div className="hud-panel">
        <div className="hud-header">
          <div className="hud-title">
            <FiActivity className="hud-icon" /> 2D LOD Quadtree Analyzer
          </div>
          <div className="hud-header-actions">
            <span className="hud-badge">{fps} FPS</span>
            <button
              className="action-btn"
              title="Recenter 2D View"
              onClick={handleRecenter}
            >
              <FiTarget /> Recenter
            </button>
          </div>
        </div>

        {/* LOD Algorithm Selector */}
        <div className="algorithm-selector-card">
          <div className="hud-section-title" style={{ marginTop: 0 }}>
            <FiCpu /> Select LOD Algorithm
          </div>
          <div className="btn-toggle-group algorithm-toggle">
            <button
              className={`toggle-btn ${lodAlgorithm === "quadtree" ? "active" : ""}`}
              onClick={() => setLodAlgorithm("quadtree")}
            >
              1. Quadtree Split
            </button>
            <button
              className={`toggle-btn ${lodAlgorithm === "grid-cutout" ? "active" : ""}`}
              onClick={() => setLodAlgorithm("grid-cutout")}
            >
              2. Grid Cutout (Max 16)
            </button>
          </div>
          {lodAlgorithm === "grid-cutout" && (
            <div className="algorithm-info-banner">
              💡 <strong>Algorithm 2 (Grid Cutout):</strong> Base coarse grid (LOD {maxLOD}) stays loaded. Finer detail tiles (LOD 0) carve out matching sub-squares based on distance. At perfect alignment (0,0), loads <strong>at most 16 tiles</strong> (and fewer off-center).
            </div>
          )}
        </div>


        {/* Distance Metrics Card */}
        <div className="distance-card">
          <div className="distance-label">Focal 2D Distance to Center (0,0)</div>
          <div className="distance-value">
            {focalDistance.toFixed(2)} <span className="distance-unit">m</span>
          </div>
          <div className="metric-subrow">
            <span>Focal Position (X, Z):</span>
            <span className="subrow-val">{focalPosText}</span>
          </div>
          <div className="metric-subrow">
            <span>Mouse Position (X, Z):</span>
            <span className="subrow-val">{mousePosText}</span>
          </div>
          <div className="metric-subrow">
            <span>2D Pan Target (X, Z):</span>
            <span className="subrow-val">{cameraPosText}</span>
          </div>
          <div className="metric-subrow">
            <span>2D Zoom Level:</span>
            <span className="subrow-val">{zoomFactor}×</span>
          </div>
        </div>


        {/* Nodes Breakdown Per LOD Level */}
        <div className="hud-section-title">
          <FiGrid /> Nodes per LOD Level
        </div>
        <div className="lod-breakdown-list">
          {[0, 1, 2, 3, 4, 5].map((lvl) => {
            const count = stats.nodesPerLod[lvl] || 0;
            const color = LOD_COLOR_HEX[Math.min(lvl, LOD_COLOR_HEX.length - 1)];
            const maxCount = Math.max(...Object.values(stats.nodesPerLod), 1);
            const percentage = Math.round((count / maxCount) * 100);

            return (
              <div key={lvl} className="lod-level-row">
                <div className="lod-level-badge" style={{ backgroundColor: color }}>
                  LOD {lvl} {lvl === 0 ? "(Finest)" : lvl === maxLOD ? "(Coarsest)" : ""}
                </div>
                <div className="lod-progress-track">
                  <div
                    className="lod-progress-fill"
                    style={{ width: `${percentage}%`, backgroundColor: color }}
                  />
                </div>
                <div className="lod-level-count">{count}</div>
              </div>
            );
          })}
        </div>

        {/* Interactive Controls & Parameters */}
        <div className="hud-section-title">
          <FiZap /> Real-Time LOD Parameters
        </div>

        <div className="controls-group">
          {/* Max LOD Level Slider */}
          <div className="control-row">
            <div className="control-label">
              <span>Max LOD Level:</span>
              <span className="control-val">{maxLOD}</span>
            </div>
            <input
              type="range"
              min="1"
              max="6"
              step="1"
              value={maxLOD}
              onChange={(e) => setMaxLOD(parseInt(e.target.value))}
              className="range-input"
            />
          </div>

          {/* Distance Factor Threshold Slider */}
          <div className="control-row">
            <div className="control-label">
              <span>Split Distance Factor:</span>
              <span className="control-val">{distanceFactor.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="3.5"
              step="0.1"
              value={distanceFactor}
              onChange={(e) => setDistanceFactor(parseFloat(e.target.value))}
              className="range-input"
            />
          </div>

          {/* Focal Source Radio Buttons */}
          <div className="control-row vertical">
            <div className="control-label">
              <span>Focal Evaluation Target:</span>
            </div>
            <div className="btn-toggle-group">
              <button
                className={`toggle-btn ${focalSource === "camera" ? "active" : ""}`}
                onClick={() => setFocalSource("camera")}
              >
                2D Pan Center
              </button>
              <button
                className={`toggle-btn ${focalSource === "mouse" ? "active" : ""}`}
                onClick={() => setFocalSource("mouse")}
              >
                Mouse Cursor
              </button>
              <button
                className={`toggle-btn ${focalSource === "orbit" ? "active" : ""}`}
                onClick={() => setFocalSource("orbit")}
              >
                Auto Orbit
              </button>
            </div>
          </div>

          {/* Toggles */}
          <div className="toggles-grid">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={wireframe}
                onChange={(e) => setWireframe(e.target.checked)}
              />
              Wireframe Mode
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showStatusOverlays}
                onChange={(e) => setShowStatusOverlays(e.target.checked)}
              />
              Status Overlays
            </label>

            <label className="checkbox-label span-2">
              <input
                type="checkbox"
                checked={simulateAsync}
                onChange={(e) => setSimulateAsync(e.target.checked)}
              />
              Simulate Async Loading Delay ({asyncDelay}ms)
            </label>
          </div>

          {simulateAsync && (
            <div className="control-row">
              <div className="control-label">
                <span>Async Load Delay:</span>
                <span className="control-val">{asyncDelay} ms</span>
              </div>
              <input
                type="range"
                min="50"
                max="1000"
                step="50"
                value={asyncDelay}
                onChange={(e) => setAsyncDelay(parseInt(e.target.value))}
                className="range-input"
              />
            </div>
          )}

          <button
            className="action-btn primary full-width"
            onClick={handleForceRebuild}
          >
            <FiRefreshCw /> Force Rebuild Quadtree
          </button>
        </div>

        {/* Legend for Status Pipeline & LOD Colors */}
        <div className="hud-section-title">
          <FiEye /> Status Pipeline Legend
        </div>
        <div className="legend-grid">
          <div className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: "#00f0ff" }} />
            <span>NEEDS_LOAD (Pulsing Cyan)</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: "#ffffff" }} />
            <span>LOADED (Solid Level Color)</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: "#ffb703" }} />
            <span>NEEDS_REFRESH (Yellow Border)</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: "#ff0055" }} />
            <span>NEEDS_EVICT (Red Wireframe)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
