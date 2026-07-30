import DiagnosticsExample from "./DiagnosticsExample";

export default function ExampleDiagnostics() {
    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "var(--spacing-5xl) var(--spacing-xl)",
            minHeight: "calc(100vh - 60px)",
            backgroundColor: "var(--color-bg-app)",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)"
        }}>
            <h1 style={{ marginBottom: "var(--spacing-xl)", color: "var(--color-text-primary)" }}>Diagnostics Example Page</h1>
            <p style={{ maxWidth: "600px", textAlign: "center", marginBottom: "var(--spacing-5xl)", color: "var(--color-text-muted)", lineHeight: "var(--line-height-relaxed)" }}>
                This is a dedicated example webpage showcasing the <code>DiagnosticsExample</code> component. 
                It connects to the local backend using the <strong>@hey-api</strong> generated client to fetch and display system diagnostics in real-time.
            </p>
            
            <div style={{ boxShadow: "var(--shadow-xl)", borderRadius: "var(--radius-lg)" }}>
                <DiagnosticsExample />
            </div>
        </div>
    );
}
