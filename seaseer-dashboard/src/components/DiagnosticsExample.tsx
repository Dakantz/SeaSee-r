import { useEffect, useState } from "react";
// Assuming the client is generated in src/client via `npm run generate-client`
import { getDiagnostics } from "../client";
import type { SystemDiagnostics } from "../client";
export default function DiagnosticsExample() {
    const [data, setData] = useState<SystemDiagnostics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [, setIsLoading] = useState<boolean>(true); // Explicit loading state
    useEffect(() => {
        const abortController = new AbortController();
        const fetchData = async () => {
            try {
                // Pass the abort signal if your generated client supports it
                const res = await getDiagnostics();
                if (res.data) {
                    setData(res.data); // Removed unnecessary type assertion `as SystemDiagnostics`
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
        };
        fetchData();

        // Cleanup function to cancel the fetch if the component unmounts
        return () => abortController.abort();
    }, []);

    return (
        <div style={{
            padding: "var(--spacing-xl)", 
            border: "1px solid var(--color-border-solid)", 
            margin: "var(--spacing-xl)", 
            borderRadius: "var(--radius-lg)", 
            backgroundColor: "var(--color-bg-panel-alt)", 
            color: "var(--color-text-secondary)",
            maxWidth: "400px"
        }}>
            <h3 style={{ marginTop: 0 }}>System Diagnostics</h3>
            {error && <p style={{ color: "var(--color-danger-text)" }}>Error: {error}</p>}
            {!data && !error && <p>Loading diagnostics...</p>}
            
            {data && (
                <div style={{ fontSize: "var(--font-size-md)" }}>
                    <p><strong>CPU Usage:</strong> {data.cpu_usage}%</p>
                    <p><strong>Memory Usage:</strong> {data.memory_usage}%</p>
                    <p><strong>Active Connections:</strong> {data.active_connections ?? 'N/A'}</p>
                    <div style={{ marginTop: "var(--spacing-sm)" }}>
                        <strong>Services Status:</strong>
                        <ul style={{ margin: "var(--spacing-sm) 0", paddingLeft: "1.5rem" }}>
                            {Object.entries(data.services_status).map(([service, status]) => (
                                <li key={service}>
                                    {service}: <span style={{ color: status === "online" ? "var(--color-success-text)" : "var(--color-danger-text)" }}>{status}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", marginTop: "var(--spacing-xl)", fontStyle: "italic" }}>
                * Type-safe request powered by hey-api. Ensure you run <code>npm run generate-client</code> to sync types.
            </p>
        </div>
    );
}
