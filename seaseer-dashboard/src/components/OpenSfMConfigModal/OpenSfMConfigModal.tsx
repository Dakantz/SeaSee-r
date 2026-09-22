import React, { useState, useEffect } from "react";
import "./OpenSfMConfigModal.css";

export interface OpenSfMConfig {
  processes: number;
  feature_process_size: number;
  mem_ceiling: number;
  depthmap_max_image_size: number;
  depthmap_cluster_max_size: number;
  depthmap_max_cluster_views: number;
  depthmap_fusion_svo_max_voxels: number;
  undistorted_image_max_size: number;
  undistorted_image_format: string;
  submodel_size: number;
}

export interface OpenSfMConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_CONFIG: OpenSfMConfig = {
  processes: 2,
  feature_process_size: 2048,
  mem_ceiling: 12288,
  depthmap_max_image_size: 2048,
  depthmap_cluster_max_size: 12,
  depthmap_max_cluster_views: 32,
  depthmap_fusion_svo_max_voxels: 50000000,
  undistorted_image_max_size: 2048,
  undistorted_image_format: "png",
  submodel_size: 60,
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

const getApiUrl = (endpoint: string) => {
  const base = API_BASE_URL.replace(/\/$/, "");
  return base ? `${base}/api/opensfm/${endpoint}` : `/api/opensfm/${endpoint}`;
};

export interface OpenSfMConfigPanelProps {
  onClose?: () => void;
  showCancel?: boolean;
}

export const OpenSfMConfigPanel: React.FC<OpenSfMConfigPanelProps> = ({ onClose, showCancel = false }) => {
  const [config, setConfig] = useState<OpenSfMConfig>(DEFAULT_CONFIG);
  const [rawYaml, setRawYaml] = useState<string>("");
  const [filePath, setFilePath] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"form" | "yaml">("form");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(getApiUrl("config"));
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Failed to load config (${res.status}): ${errText}`);
      }
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.raw_yaml) {
        setRawYaml(data.raw_yaml);
      }
      if (data.file_path) {
        setFilePath(data.file_path);
      }
    } catch (err: any) {
      console.error("Error fetching OpenSfM config:", err);
      setStatusMsg({ type: "error", text: err.message || "Failed to load OpenSfM config" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFieldChange = (field: keyof OpenSfMConfig, value: string) => {
    const numVal = parseInt(value, 10);
    setConfig((prev) => ({
      ...prev,
      [field]: isNaN(numVal) ? 0 : numVal,
    }));
  };

  const handleStringFieldChange = (field: keyof OpenSfMConfig, value: string) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const payload = activeTab === "yaml" ? { raw_yaml: rawYaml } : { config };
      const res = await fetch(getApiUrl("config"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(errJson.detail || `Save failed (${res.status})`);
      }

      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.raw_yaml) {
        setRawYaml(data.raw_yaml);
      }
      setStatusMsg({ type: "success", text: "OpenSfM configuration saved successfully!" });
    } catch (err: any) {
      console.error("Error saving OpenSfM config:", err);
      setStatusMsg({ type: "error", text: err.message || "Failed to save configuration" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Are you sure you want to reset OpenSfM configuration to default values?")) {
      return;
    }
    setIsResetting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(getApiUrl("config/reset"), {
        method: "POST",
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ detail: "Reset failed" }));
        throw new Error(errJson.detail || `Reset failed (${res.status})`);
      }
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.raw_yaml) {
        setRawYaml(data.raw_yaml);
      }
      setStatusMsg({ type: "info", text: "Configuration reset to default values." });
    } catch (err: any) {
      console.error("Error resetting OpenSfM config:", err);
      setStatusMsg({ type: "error", text: err.message || "Failed to reset configuration" });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="opensfm-config-panel">
      {/* Navigation Tabs */}
      <div className="opensfm-modal-tabs">
        <button
          className={`opensfm-tab-btn ${activeTab === "form" ? "active" : ""}`}
          onClick={() => setActiveTab("form")}
        >
          Form View
        </button>
        <button
          className={`opensfm-tab-btn ${activeTab === "yaml" ? "active" : ""}`}
          onClick={() => setActiveTab("yaml")}
        >
          Raw YAML View
        </button>
      </div>

      {/* Body Content */}
      <div className="opensfm-modal-body">
        {statusMsg && (
          <div className={`opensfm-status-banner ${statusMsg.type}`}>
            <span>{statusMsg.type === "success" ? "✓" : statusMsg.type === "error" ? "⚠️" : "ℹ️"}</span>
            <span>{statusMsg.text}</span>
          </div>
        )}

        {isLoading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>
            Loading OpenSfM configuration...
          </div>
        ) : activeTab === "form" ? (
          <div className="opensfm-grid-form">
            {/* Processes */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Parallel Processes</span>
                <span style={{ color: "var(--color-accent-text)" }}>processes</span>
              </div>
              <div className="opensfm-field-desc">Number of parallel worker processes to spawn</div>
              <input
                type="number"
                min="1"
                className="opensfm-field-input"
                value={config.processes}
                onChange={(e) => handleFieldChange("processes", e.target.value)}
              />
            </div>

            {/* Memory Ceiling */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Memory Ceiling (MB)</span>
                <span style={{ color: "var(--color-accent-text)" }}>mem_ceiling</span>
              </div>
              <div className="opensfm-field-desc">Maximum RAM cap for execution (e.g. 12288 = 12 GB)</div>
              <input
                type="number"
                min="1024"
                step="512"
                className="opensfm-field-input"
                value={config.mem_ceiling}
                onChange={(e) => handleFieldChange("mem_ceiling", e.target.value)}
              />
            </div>

            {/* Feature Process Size */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Feature Process Size</span>
                <span style={{ color: "var(--color-accent-text)" }}>feature_process_size</span>
              </div>
              <div className="opensfm-field-desc">Max image dimension (px) for feature detection</div>
              <input
                type="number"
                min="256"
                className="opensfm-field-input"
                value={config.feature_process_size}
                onChange={(e) => handleFieldChange("feature_process_size", e.target.value)}
              />
            </div>

            {/* Depthmap Max Image Size */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Depthmap Max Image Size</span>
                <span style={{ color: "var(--color-accent-text)" }}>depthmap_max_image_size</span>
              </div>
              <div className="opensfm-field-desc">Max resolution size for dense depthmap estimation</div>
              <input
                type="number"
                min="256"
                className="opensfm-field-input"
                value={config.depthmap_max_image_size}
                onChange={(e) => handleFieldChange("depthmap_max_image_size", e.target.value)}
              />
            </div>

            {/* Depthmap Cluster Max Size */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Depthmap Cluster Max Size</span>
                <span style={{ color: "var(--color-accent-text)" }}>depthmap_cluster_max_size</span>
              </div>
              <div className="opensfm-field-desc">Max images per sub-cluster in depth estimation</div>
              <input
                type="number"
                min="1"
                className="opensfm-field-input"
                value={config.depthmap_cluster_max_size}
                onChange={(e) => handleFieldChange("depthmap_cluster_max_size", e.target.value)}
              />
            </div>

            {/* Depthmap Max Cluster Views */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Depthmap Cluster Views</span>
                <span style={{ color: "var(--color-accent-text)" }}>depthmap_max_cluster_views</span>
              </div>
              <div className="opensfm-field-desc">Max neighbouring views to consider per cluster</div>
              <input
                type="number"
                min="1"
                className="opensfm-field-input"
                value={config.depthmap_max_cluster_views}
                onChange={(e) => handleFieldChange("depthmap_max_cluster_views", e.target.value)}
              />
            </div>

            {/* Fusion SVO Max Voxels */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Fusion SVO Max Voxels</span>
                <span style={{ color: "var(--color-accent-text)" }}>depthmap_fusion_svo_max_voxels</span>
              </div>
              <div className="opensfm-field-desc">Upper voxel limit for Sparse Voxel Octree fusion</div>
              <input
                type="number"
                min="100000"
                step="1000000"
                className="opensfm-field-input"
                value={config.depthmap_fusion_svo_max_voxels}
                onChange={(e) => handleFieldChange("depthmap_fusion_svo_max_voxels", e.target.value)}
              />
            </div>

            {/* Undistorted Image Max Size */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Undistorted Image Size</span>
                <span style={{ color: "var(--color-accent-text)" }}>undistorted_image_max_size</span>
              </div>
              <div className="opensfm-field-desc">Max size for lens undistorted image outputs</div>
              <input
                type="number"
                min="256"
                className="opensfm-field-input"
                value={config.undistorted_image_max_size}
                onChange={(e) => handleFieldChange("undistorted_image_max_size", e.target.value)}
              />
            </div>

            {/* Undistorted Image Format */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Undistorted Image Format</span>
                <span style={{ color: "var(--color-accent-text)" }}>undistorted_image_format</span>
              </div>
              <div className="opensfm-field-desc">Image format extension for undistorted images</div>
              <input
                type="text"
                className="opensfm-field-input"
                value={config.undistorted_image_format || "png"}
                onChange={(e) => handleStringFieldChange("undistorted_image_format", e.target.value)}
              />
            </div>

            {/* Submodel Size */}
            <div className="opensfm-field-card">
              <div className="opensfm-field-label">
                <span>Submodel Size</span>
                <span style={{ color: "var(--color-accent-text)" }}>submodel_size</span>
              </div>
              <div className="opensfm-field-desc">Target image count threshold for submodel partitioning</div>
              <input
                type="number"
                min="1"
                className="opensfm-field-input"
                value={config.submodel_size}
                onChange={(e) => handleFieldChange("submodel_size", e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="opensfm-yaml-container">
            <textarea
              className="opensfm-yaml-textarea"
              value={rawYaml}
              onChange={(e) => setRawYaml(e.target.value)}
              placeholder="# Enter OpenSfM YAML configuration..."
            />
          </div>
        )}

        {filePath && (
          <div className="opensfm-filepath-info">
            Config Target: {filePath}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="opensfm-modal-footer">
        <div className="opensfm-footer-left">
          <button
            className="opensfm-btn opensfm-btn-danger"
            onClick={handleReset}
            disabled={isResetting || isSaving || isLoading}
          >
            {isResetting ? "Resetting..." : "🔄 Reset to Defaults"}
          </button>
        </div>
        <div className="opensfm-footer-right">
          {showCancel && onClose && (
            <button className="opensfm-btn opensfm-btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
          )}
          <button
            className="opensfm-btn opensfm-btn-primary"
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            {isSaving ? "Saving..." : "⚙️ Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const OpenSfMConfigModal: React.FC<OpenSfMConfigModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="opensfm-modal-backdrop" onClick={onClose}>
      <div className="opensfm-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="opensfm-modal-header">
          <div className="opensfm-modal-header-left">
            <div>
              <h2 className="opensfm-modal-title">⚙️ OpenSfM Settings</h2>
              <div className="opensfm-modal-subtitle">
                Configure 3D reconstruction pipeline and memory parameters
              </div>
            </div>
          </div>
          <button className="opensfm-modal-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <OpenSfMConfigPanel onClose={onClose} showCancel={true} />
      </div>
    </div>
  );
};

export default OpenSfMConfigModal;
