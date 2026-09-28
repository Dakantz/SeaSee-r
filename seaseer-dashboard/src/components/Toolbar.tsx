import { useState } from "react";
import { NavLink } from "react-router-dom";
import VideoUploader from "./VideoUploader/VideoUploader";

export default function Toolbar() {
    const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

    return (
        <>
            <header
                style={{
                    height: "60px",
                    background: "#0f172a",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingLeft: "20px",
                    paddingRight: "20px",
                    fontWeight: "bold",
                    zIndex: 100
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "16px", color: "#38bdf8", letterSpacing: "0.5px" }}>
                        SeaSeer Dashboard
                    </span>
                    <button
                        type="button"
                        onClick={() => setIsVideoModalOpen(true)}
                        style={{
                            background: "linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(14, 165, 233, 0.2) 100%)",
                            border: "1px solid rgba(56, 189, 248, 0.4)",
                            color: "#38bdf8",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            transition: "all 0.2s ease"
                        }}
                    >
                        <span>📹</span> Upload Video
                    </button>
                </div>

                <nav style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <NavLink
                        to="/"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        Workspace
                    </NavLink>

                    <NavLink
                        to="/pointcloud-overview"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        PointCloud Overview
                    </NavLink>

                    <NavLink
                        to="/lod-algorithm-analyzer"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        LOD Analyzer
                    </NavLink>

                    <NavLink
                        to="/pointcloud-editor"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        PointCloud Editor
                    </NavLink>

                    <NavLink
                        to="/logs"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        Logs & Telemetry
                    </NavLink>

                    <NavLink
                        to="/test-rover"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        Test Rover
                    </NavLink>

                    <NavLink
                        to="/video-upload-test"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        Video Uploader
                    </NavLink>

                    <NavLink
                        to="/health"
                        style={({ isActive }) => ({
                            color: isActive ? "#38bdf8" : "#94a3b8",
                            textDecoration: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isActive ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            border: isActive ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent"
                        })}
                    >
                        Health
                    </NavLink>
                </nav>
            </header>

            {isVideoModalOpen && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(15, 23, 42, 0.8)",
                        backdropFilter: "blur(8px)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000,
                        padding: "20px"
                    }}
                    onClick={() => setIsVideoModalOpen(false)}
                >
                    <div
                        style={{
                            background: "#0f172a",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            borderRadius: "16px",
                            padding: "24px",
                            maxWidth: "100%",
                            width: "100%",
                            maxHeight: "90vh",
                            overflowY: "auto",
                            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                            position: "relative"
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "20px",
                                borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                                paddingBottom: "12px"
                            }}
                        >
                            <h2 style={{ margin: 0, fontSize: "18px", color: "#f8fafc", fontWeight: 600 }}>
                                Video & Metadata Uploader
                            </h2>
                            <button
                                type="button"
                                onClick={() => setIsVideoModalOpen(false)}
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "#94a3b8",
                                    fontSize: "18px",
                                    cursor: "pointer",
                                    padding: "4px 8px"
                                }}
                            >
                                ✕
                            </button>
                        </div>
                        <VideoUploader />
                    </div>
                </div>
            )}
        </>
    );
}