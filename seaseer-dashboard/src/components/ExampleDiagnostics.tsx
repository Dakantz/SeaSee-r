import DiagnosticsExample from "./DiagnosticsExample";

export default function ExampleDiagnostics() {
    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "3rem 1rem",
            minHeight: "calc(100vh - 60px)", // Assuming Toolbar is 60px
            backgroundColor: "#121212",
            color: "white",
            fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
            <h1 style={{ marginBottom: "1rem", color: "#e0e0e0" }}>Diagnostics Example Page</h1>
            <p style={{ maxWidth: "600px", textAlign: "center", marginBottom: "3rem", color: "#aaa", lineHeight: "1.6" }}>
                This is a dedicated example webpage showcasing the <code>DiagnosticsExample</code> component. 
                It connects to the local backend using the <strong>@hey-api</strong> generated client to fetch and display system diagnostics in real-time.
            </p>
            
            <div style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.5)", borderRadius: "8px" }}>
                <DiagnosticsExample />
            </div>
        </div>
    );
}
