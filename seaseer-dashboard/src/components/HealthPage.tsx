import { useEffect, useState, useCallback } from "react";
import { 
    FiCpu, 
    FiServer, 
    FiRefreshCw, 
    FiCheckCircle, 
    FiAlertCircle, 
    FiBox, 
    FiLayers, 
    FiClock, 
    FiActivity
} from "react-icons/fi";
import { getDiagnostics } from "../client";
import type { SystemDiagnostics, WorkerInfo } from "../client";

function formatDuration(seconds?: number | null): string {
    if (!seconds || seconds <= 0) return "0s";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function formatHeartbeat(isoString?: string | null): string {
    if (!isoString) return "Never";
    try {
        const date = new Date(isoString);
        return date.toLocaleTimeString() + " (" + date.toLocaleDateString() + ")";
    } catch {
        return isoString;
    }
}

function getWorkerRole(worker: WorkerInfo): { title: string; subtitle: string; isSpecial: boolean } {
    const queues = worker.queues || [];
    if (queues.includes("opensfm_tasks")) {
        return {
            title: "OpenSfM Dedicated Worker",
            subtitle: "seasee-r-opensfm (GPU Photogrammetry & Dense Reconstruction)",
            isSpecial: true
        };
    }
    return {
        title: "General Task Worker",
        subtitle: `seasee-r-worker (${queues.join(", ")})`,
        isSpecial: false
    };
}

export default function HealthPage() {
    const [data, setData] = useState<SystemDiagnostics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await getDiagnostics();
            if (res.data) {
                setData(res.data);
                setError(null);
                setLastUpdated(new Date());
            } else if (res.error) {
                setError("Failed to fetch diagnostics.");
            }
        } catch (err: any) {
            if (err.name !== "AbortError") {
                setError(err.message || "An error occurred");
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // 10s auto-refresh
        return () => clearInterval(interval);
    }, [fetchData]);

    const allServicesHealthy = data?.services_status 
        ? Object.values(data.services_status).every(s => s === "online")
        : false;

    const workers = data?.workers || [];

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "var(--spacing-3xl) var(--spacing-xl)",
            minHeight: "calc(100vh - 60px)",
            backgroundColor: "var(--color-bg-app, #090d16)",
            color: "var(--color-text-primary, #f8fafc)",
            fontFamily: "var(--font-sans)",
            overflowY: "auto",
            boxSizing: "border-box"
        }}>
            <div style={{
                textAlign: "center",
                marginBottom: "24px",
                maxWidth: "700px"
            }}>
                <h1 style={{ 
                    margin: "0 0 10px", 
                    fontSize: "26px", 
                    fontWeight: 700, 
                    color: "var(--color-text-primary, #f8fafc)",
                    letterSpacing: "-0.5px"
                }}>
                    System Health & Diagnostics
                </h1>
                <p style={{ 
                    margin: 0, 
                    color: "var(--color-text-muted, #94a3b8)", 
                    fontSize: "14px",
                    lineHeight: "1.6" 
                }}>
                    Real-time telemetry, service health monitoring, and background worker container status for SeaSee-r & OpenSfM.
                </p>
            </div>

            <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "24px",
                width: "100%",
                maxWidth: "960px",
                padding: "0 16px",
                boxSizing: "border-box"
            }}>
                {/* Top Status Header */}
                <div style={{
                    background: "rgba(15, 23, 42, 0.75)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "14px",
                    padding: "18px 24px",
                    backdropFilter: "blur(12px)",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div style={{
                            width: "44px",
                            height: "44px",
                            borderRadius: "10px",
                            background: allServicesHealthy 
                                ? "linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(16, 185, 129, 0.2) 100%)" 
                                : "linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(249, 115, 22, 0.2) 100%)",
                            border: allServicesHealthy ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid rgba(239, 68, 68, 0.4)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "22px",
                            color: allServicesHealthy ? "#4ade80" : "#f87171"
                        }}>
                            {allServicesHealthy ? <FiCheckCircle /> : <FiAlertCircle />}
                        </div>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <h2 style={{ margin: 0, fontSize: "18px", color: "#f8fafc", fontWeight: 600 }}>
                                    System Status
                                </h2>
                                <span style={{
                                    padding: "2px 8px",
                                    borderRadius: "12px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                    background: allServicesHealthy ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                    color: allServicesHealthy ? "#4ade80" : "#f87171",
                                    border: allServicesHealthy ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)"
                                }}>
                                    {allServicesHealthy ? "All Systems Operational" : "Degraded Services"}
                                </span>
                            </div>
                            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                                {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()} (Auto-refreshes every 10s)` : "Checking health..."}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={fetchData}
                        disabled={isLoading}
                        style={{
                            background: "rgba(56, 189, 248, 0.15)",
                            border: "1px solid rgba(56, 189, 248, 0.3)",
                            color: "#38bdf8",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: isLoading ? "not-allowed" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            transition: "all 0.2s ease"
                        }}
                    >
                        <FiRefreshCw style={{
                            animation: isLoading ? "spin 1s linear infinite" : "none"
                        }} />
                        <span>{isLoading ? "Refreshing..." : "Refresh Now"}</span>
                    </button>
                </div>

                {error && (
                    <div style={{
                        padding: "14px 18px",
                        background: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: "10px",
                        color: "#fca5a5",
                        fontSize: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px"
                    }}>
                        <FiAlertCircle style={{ flexShrink: 0, fontSize: "18px" }} />
                        <span>{error}</span>
                    </div>
                )}

                {/* Host Metrics Grid */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "16px"
                }}>
                    <div style={{
                        background: "rgba(15, 23, 42, 0.65)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "12px",
                        padding: "18px",
                        backdropFilter: "blur(8px)"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ fontSize: "13px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                                <FiCpu style={{ color: "#38bdf8" }} /> CPU Usage
                            </span>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>
                                {data?.cpu_usage != null ? `${data.cpu_usage.toFixed(1)}%` : "—"}
                            </span>
                        </div>
                        <div style={{ width: "100%", height: "6px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{
                                width: `${Math.min(100, Math.max(0, data?.cpu_usage ?? 0))}%`,
                                height: "100%",
                                background: "linear-gradient(90deg, #38bdf8, #818cf8)",
                                borderRadius: "3px",
                                transition: "width 0.3s ease"
                            }} />
                        </div>
                    </div>

                    <div style={{
                        background: "rgba(15, 23, 42, 0.65)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "12px",
                        padding: "18px",
                        backdropFilter: "blur(8px)"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ fontSize: "13px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                                <FiServer style={{ color: "#818cf8" }} /> Memory Usage
                            </span>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>
                                {data?.memory_usage != null ? `${data.memory_usage.toFixed(1)}%` : "—"}
                            </span>
                        </div>
                        <div style={{ width: "100%", height: "6px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{
                                width: `${Math.min(100, Math.max(0, data?.memory_usage ?? 0))}%`,
                                height: "100%",
                                background: "linear-gradient(90deg, #818cf8, #c084fc)",
                                borderRadius: "3px",
                                transition: "width 0.3s ease"
                            }} />
                        </div>
                    </div>

                    <div style={{
                        background: "rgba(15, 23, 42, 0.65)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "12px",
                        padding: "18px",
                        backdropFilter: "blur(8px)"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ fontSize: "13px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                                <FiActivity style={{ color: "#34d399" }} /> Registered Workers
                            </span>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>
                                {workers.length} active
                            </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                            RQ task workers registered in Redis
                        </div>
                    </div>
                </div>

                {/* Core Services Status Grid */}
                <div style={{
                    background: "rgba(15, 23, 42, 0.65)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "14px",
                    padding: "20px",
                    backdropFilter: "blur(8px)"
                }}>
                    <h3 style={{ margin: "0 0 16px", fontSize: "15px", color: "#f1f5f9", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                        <FiLayers style={{ color: "#38bdf8" }} /> Microservices Health
                    </h3>
                    
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                        gap: "12px"
                    }}>
                        {data?.services_status && Object.entries(data.services_status).map(([service, status]) => {
                            const isOnline = status === "online";
                            return (
                                <div 
                                    key={service}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: "12px 14px",
                                        borderRadius: "10px",
                                        background: "rgba(255, 255, 255, 0.03)",
                                        border: isOnline ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid rgba(239, 68, 68, 0.2)"
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                        <div style={{
                                            width: "8px",
                                            height: "8px",
                                            borderRadius: "50%",
                                            backgroundColor: isOnline ? "#22c55e" : "#ef4444",
                                            boxShadow: isOnline ? "0 0 8px #22c55e" : "0 0 8px #ef4444"
                                        }} />
                                        <span style={{ fontSize: "13px", fontWeight: 500, color: "#e2e8f0" }}>
                                            {service === "pgPointcloud" ? "pgPointcloud Extension" :
                                             service === "opensfm" ? "OpenSfM Worker" :
                                             service === "worker" ? "Task Worker" :
                                             service === "tusd" ? "TUSD Resumable" :
                                             service.charAt(0).toUpperCase() + service.slice(1)}
                                        </span>
                                    </div>
                                    <span style={{
                                        fontSize: "11px",
                                        fontWeight: 600,
                                        textTransform: "uppercase",
                                        color: isOnline ? "#4ade80" : "#f87171",
                                        background: isOnline ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)",
                                        padding: "3px 8px",
                                        borderRadius: "6px"
                                    }}>
                                        {status}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* All Existing Background Workers Section */}
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px"
                }}>
                    <h3 style={{ margin: "4px 0 0", fontSize: "16px", color: "#f1f5f9", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                        <FiBox style={{ color: "#38bdf8" }} /> Background Workers ({workers.length})
                    </h3>

                    {workers.length === 0 && (
                        <div style={{
                            padding: "20px",
                            textAlign: "center",
                            background: "rgba(15, 23, 42, 0.5)",
                            borderRadius: "12px",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                            color: "#94a3b8",
                            fontSize: "14px"
                        }}>
                            No active background workers registered in Redis.
                        </div>
                    )}

                    {workers.map((worker) => {
                        const { title, subtitle, isSpecial } = getWorkerRole(worker);
                        return (
                            <div 
                                key={worker.name}
                                style={{
                                    background: isSpecial 
                                        ? "linear-gradient(145deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.6) 100%)"
                                        : "rgba(15, 23, 42, 0.65)",
                                    border: isSpecial 
                                        ? "1px solid rgba(56, 189, 248, 0.25)" 
                                        : "1px solid rgba(255, 255, 255, 0.08)",
                                    borderRadius: "14px",
                                    padding: "20px",
                                    boxShadow: isSpecial ? "0 10px 25px -5px rgba(0, 0, 0, 0.3)" : "none",
                                    backdropFilter: "blur(10px)"
                                }}
                            >
                                <div style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "12px",
                                    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                                    paddingBottom: "14px",
                                    marginBottom: "16px"
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                        <div style={{
                                            width: "38px",
                                            height: "38px",
                                            borderRadius: "10px",
                                            background: isSpecial
                                                ? "linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(14, 165, 233, 0.2) 100%)"
                                                : "linear-gradient(135deg, rgba(129, 140, 248, 0.2) 0%, rgba(99, 102, 241, 0.2) 100%)",
                                            border: isSpecial ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid rgba(129, 140, 248, 0.4)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: isSpecial ? "#38bdf8" : "#818cf8",
                                            fontSize: "20px"
                                        }}>
                                            <FiBox />
                                        </div>
                                        <div>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                <h4 style={{ margin: 0, fontSize: "15px", color: "#f8fafc", fontWeight: 600 }}>
                                                    {title}
                                                </h4>
                                                <span style={{
                                                    fontSize: "11px",
                                                    color: "#94a3b8",
                                                    background: "rgba(255, 255, 255, 0.06)",
                                                    padding: "2px 8px",
                                                    borderRadius: "4px",
                                                    fontFamily: "var(--font-mono, monospace)"
                                                }}>
                                                    ID: {worker.container_id || worker.name.slice(0, 12)}
                                                </span>
                                            </div>
                                            <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                                                {subtitle}
                                            </p>
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <span style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "4px 10px",
                                            borderRadius: "20px",
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            background: worker.status === "online" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                            color: worker.status === "online" ? "#4ade80" : "#f87171",
                                            border: worker.status === "online" ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)"
                                        }}>
                                            <span style={{
                                                width: "7px",
                                                height: "7px",
                                                borderRadius: "50%",
                                                backgroundColor: worker.status === "online" ? "#22c55e" : "#ef4444"
                                            }} />
                                            {worker.status === "online" ? "Online" : "Offline"}
                                        </span>

                                        {worker.state && (
                                            <span style={{
                                                padding: "4px 10px",
                                                borderRadius: "20px",
                                                fontSize: "12px",
                                                fontWeight: 500,
                                                background: worker.state === "busy" ? "rgba(234, 179, 8, 0.15)" : "rgba(56, 189, 248, 0.15)",
                                                color: worker.state === "busy" ? "#facc15" : "#38bdf8",
                                                border: worker.state === "busy" ? "1px solid rgba(234, 179, 8, 0.3)" : "1px solid rgba(56, 189, 248, 0.3)"
                                            }}>
                                                State: {worker.state}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Worker Grid Stats */}
                                <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                                    gap: "12px"
                                }}>
                                    <div style={{
                                        background: "rgba(0, 0, 0, 0.25)",
                                        padding: "12px 14px",
                                        borderRadius: "10px",
                                        border: "1px solid rgba(255, 255, 255, 0.05)"
                                    }}>
                                        <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            Assigned Queues
                                        </div>
                                        <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                            {(worker.queues || []).map((q) => (
                                                <span key={q} style={{
                                                    fontSize: "11px",
                                                    padding: "2px 6px",
                                                    borderRadius: "4px",
                                                    background: "rgba(56, 189, 248, 0.1)",
                                                    color: "#38bdf8",
                                                    fontFamily: "var(--font-mono, monospace)"
                                                }}>
                                                    {q}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div style={{
                                        background: "rgba(0, 0, 0, 0.25)",
                                        padding: "12px 14px",
                                        borderRadius: "10px",
                                        border: "1px solid rgba(255, 255, 255, 0.05)"
                                    }}>
                                        <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            Queued Jobs
                                        </div>
                                        <div style={{
                                            marginTop: "6px",
                                            fontSize: "14px",
                                            color: (worker.queued_jobs_count ?? 0) > 0 ? "#facc15" : "#94a3b8",
                                            fontWeight: 600
                                        }}>
                                            {worker.queued_jobs_count ?? 0}
                                        </div>
                                    </div>


                                    <div style={{
                                        background: "rgba(0, 0, 0, 0.25)",
                                        padding: "12px 14px",
                                        borderRadius: "10px",
                                        border: "1px solid rgba(255, 255, 255, 0.05)"
                                    }}>
                                        <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            Total Working Time
                                        </div>
                                        <div style={{
                                            marginTop: "6px",
                                            fontSize: "13px",
                                            color: "#e2e8f0",
                                            fontWeight: 500,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px"
                                        }}>
                                            <FiClock style={{ color: "#38bdf8" }} />
                                            {formatDuration(worker.total_working_time)}
                                        </div>
                                    </div>

                                    <div style={{
                                        background: "rgba(0, 0, 0, 0.25)",
                                        padding: "12px 14px",
                                        borderRadius: "10px",
                                        border: "1px solid rgba(255, 255, 255, 0.05)"
                                    }}>
                                        <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            Last Heartbeat
                                        </div>
                                        <div style={{
                                            marginTop: "6px",
                                            fontSize: "12px",
                                            color: "#e2e8f0"
                                        }}>
                                            {formatHeartbeat(worker.last_heartbeat)}
                                        </div>
                                    </div>

                                    {worker.ip_address && (
                                        <div style={{
                                            background: "rgba(0, 0, 0, 0.25)",
                                            padding: "12px 14px",
                                            borderRadius: "10px",
                                            border: "1px solid rgba(255, 255, 255, 0.05)"
                                        }}>
                                            <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                                Container Network Address
                                            </div>
                                            <div style={{
                                                marginTop: "6px",
                                                fontSize: "12px",
                                                color: "#e2e8f0",
                                                fontFamily: "var(--font-mono, monospace)"
                                            }}>
                                                {worker.ip_address}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {worker.python_version && (
                                    <div style={{
                                        marginTop: "12px",
                                        padding: "6px 10px",
                                        background: "rgba(0, 0, 0, 0.2)",
                                        borderRadius: "6px",
                                        fontSize: "11px",
                                        color: "#64748b",
                                        fontFamily: "var(--font-mono, monospace)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap"
                                    }}>
                                        Runtime: {worker.python_version}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
