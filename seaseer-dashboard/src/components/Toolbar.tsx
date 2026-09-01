import { NavLink } from "react-router-dom";

export default function Toolbar() {
    return (
        <header
            style={{
                height: "60px",
                backgroundColor: "var(--color-bg-panel, #181818)",
                borderBottom: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.12))",
                color: "var(--color-text-primary, #ffffff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 20px",
                flexShrink: 0,
                zIndex: "var(--z-sticky, 100)"
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontWeight: 700, fontSize: "16px", letterSpacing: "0.5px" }}>
                    SeaSee-r
                </span>
            </div>

            <nav style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <NavLink
                    to="/"
                    end
                    style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 500,
                        textDecoration: "none",
                        color: isActive ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
                        backgroundColor: isActive ? "var(--color-primary, #3b82f6)" : "transparent",
                        transition: "all 0.15s ease"
                    })}
                >
                    <span>Workspace</span>
                </NavLink>

                <NavLink
                    to="/pointcloud-editor"
                    style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 500,
                        textDecoration: "none",
                        color: isActive ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
                        backgroundColor: isActive ? "var(--color-primary, #3b82f6)" : "transparent",
                        transition: "all 0.15s ease"
                    })}
                >
                    <span>Point Cloud Editor</span>
                </NavLink>

                <NavLink
                    to="/logs"
                    style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 500,
                        textDecoration: "none",
                        color: isActive ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
                        backgroundColor: isActive ? "var(--color-primary, #3b82f6)" : "transparent",
                        transition: "all 0.15s ease"
                    })}
                >
                    <span>Logs & Telemetry</span>
                </NavLink>

                <NavLink
                    to="/example-diagnostics"
                    style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 500,
                        textDecoration: "none",
                        color: isActive ? "#ffffff" : "var(--color-text-muted, #94a3b8)",
                        backgroundColor: isActive ? "var(--color-primary, #3b82f6)" : "transparent",
                        transition: "all 0.15s ease"
                    })}
                >
                    <span>Diagnostics</span>
                </NavLink>
            </nav>
        </header>
    );
}
