import { NavLink } from "react-router-dom";

export default function Toolbar() {
    return (
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
            </nav>
        </header>
    );
}