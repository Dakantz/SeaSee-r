import React, { useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { Html } from "@react-three/drei";

export interface PLYPointCloudProps {
    hardcodedIdentifier?: string;
    defaultPlyUrl?: string;
    initialMode?: "binary" | "plyFile" | "plyUrl";
}

const DEFAULT_HARDCODED_IDENTIFIER = "ec6fd8b9-8ef1-4c32-868a-075e99f46b0d";
const DEFAULT_PLY_URL = "/test_data/datasets/video_1/odm_filterpoints/point_cloud.ply";

export default function PLYPointCloud({
    hardcodedIdentifier = DEFAULT_HARDCODED_IDENTIFIER,
    defaultPlyUrl = DEFAULT_PLY_URL,
    initialMode = "binary",
}: PLYPointCloudProps) {
    const [mode, setMode] = useState<"binary" | "plyFile" | "plyUrl">(initialMode);
    const [identifier, setIdentifier] = useState<string>(hardcodedIdentifier);
    const [plyUrl, setPlyUrl] = useState<string>(defaultPlyUrl);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [pointCount, setPointCount] = useState<number | null>(null);
    const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

    const loadPlyUrl = useCallback((urlToLoad: string) => {
        if (!urlToLoad.trim()) return;
        setIsLoading(true);
        setError(null);

        const loader = new PLYLoader();
        loader.load(
            urlToLoad,
            (geom) => {
                geom.center();
                geom.computeBoundingSphere();
                const count = geom.attributes.position ? geom.attributes.position.count : 0;

                setGeometry((prev) => {
                    if (prev) prev.dispose();
                    return geom;
                });
                setPointCount(count);
                setIsLoading(false);
            },
            undefined,
            (err) => {
                console.error("PLY URL load error:", err);
                setError("Failed to load PLY from URL");
                setIsLoading(false);
            }
        );
    }, []);

    const loadBinaryPointCloud = useCallback(async (idToLoad: string) => {
        if (!idToLoad.trim()) return;
        setIsLoading(true);
        setError(null);

        const startTime = performance.now();
        console.log(`[Binary Stream] Loading started for ID: ${idToLoad}`);

        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
            const url = `${API_BASE_URL}/pointclouds/${encodeURIComponent(idToLoad.trim())}/stream-binary`;

            const fetchStartTime = performance.now();
            const res = await fetch(url);
            const fetchTime = performance.now() - fetchStartTime;

            if (!res.ok) {
                throw new Error(`Backend returned status ${res.status}: ${res.statusText}`);
            }
            console.log(`[Binary Stream] HTTP connection established: ${fetchTime.toFixed(2)} ms`);

            const bufferStartTime = performance.now();
            const buffer = await res.arrayBuffer();
            const bufferTime = performance.now() - bufferStartTime;
            const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
            console.log(`[Binary Stream] Buffer downloaded (${sizeMB} MB): ${bufferTime.toFixed(2)} ms`);

            const pointSizeInBytes = 18; // 3 x Float32 (12 bytes) + 3 x Uint16 (6 bytes)
            const count = Math.floor(buffer.byteLength / pointSizeInBytes);

            if (count === 0) {
                throw new Error("Received empty point cloud data buffer");
            }

            const parseStartTime = performance.now();
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const dataView = new DataView(buffer);

            let maxColorVal = 0;
            const samples = Math.min(count, 500);
            for (let i = 0; i < samples; i++) {
                const offset = i * 18;
                const r = dataView.getUint16(offset + 12, true);
                const g = dataView.getUint16(offset + 14, true);
                const b = dataView.getUint16(offset + 16, true);
                if (r > maxColorVal) maxColorVal = r;
                if (g > maxColorVal) maxColorVal = g;
                if (b > maxColorVal) maxColorVal = b;
            }
            const colorScale = maxColorVal > 255 ? 65535 : (maxColorVal > 0 ? 255 : 1);

            for (let i = 0; i < count; i++) {
                const offset = i * 18;
                positions[i * 3] = dataView.getFloat32(offset, true);
                positions[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
                positions[i * 3 + 2] = dataView.getFloat32(offset + 8, true);

                const r = dataView.getUint16(offset + 12, true);
                const g = dataView.getUint16(offset + 14, true);
                const b = dataView.getUint16(offset + 16, true);

                colors[i * 3] = r / colorScale;
                colors[i * 3 + 1] = g / colorScale;
                colors[i * 3 + 2] = b / colorScale;
            }
            const parseTime = performance.now() - parseStartTime;
            console.log(`[Binary Stream] Parsed ${count.toLocaleString()} points from binary buffer: ${parseTime.toFixed(2)} ms`);

            const geomStartTime = performance.now();
            const geom = new THREE.BufferGeometry();
            geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            geom.center();
            geom.computeBoundingSphere();
            const geomTime = performance.now() - geomStartTime;
            console.log(`[Binary Stream] Three.js BufferGeometry setup & bounds computation: ${geomTime.toFixed(2)} ms`);

            setGeometry((prev) => {
                if (prev) prev.dispose();
                return geom;
            });
            setPointCount(count);

            const totalTime = performance.now() - startTime;
            console.log(
                `[Binary Stream] TOTAL TIME: ${totalTime.toFixed(2)} ms | Download: ${bufferTime.toFixed(2)} ms | Parse: ${parseTime.toFixed(2)} ms | Three.js: ${geomTime.toFixed(2)} ms`
            );
        } catch (err: any) {
            const totalTime = performance.now() - startTime;
            console.error(`[Binary Stream] Error after ${totalTime.toFixed(2)} ms:`, err);
            setError(err.message || "Failed to load binary point cloud stream");
            if (idToLoad === DEFAULT_HARDCODED_IDENTIFIER) {
                console.warn("Falling back to default PLY URL...");
                loadPlyUrl(defaultPlyUrl);
            }
        } finally {
            setIsLoading(false);
        }
    }, [defaultPlyUrl, loadPlyUrl]);

    const loadPlyFile = useCallback(async (file: File) => {
        setIsLoading(true);
        setError(null);
        setSelectedFileName(file.name);

        try {
            const buffer = await file.arrayBuffer();
            const loader = new PLYLoader();
            const geom = loader.parse(buffer);

            geom.center();
            geom.computeBoundingSphere();

            const count = geom.attributes.position ? geom.attributes.position.count : 0;

            setGeometry((prev) => {
                if (prev) prev.dispose();
                return geom;
            });
            setPointCount(count);
        } catch (err: any) {
            console.error("PLY parse error:", err);
            setError(err.message || "Failed to parse PLY file");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (mode === "binary") {
            loadBinaryPointCloud(identifier);
        } else if (mode === "plyUrl") {
            loadPlyUrl(plyUrl);
        }
    }, [mode, identifier, plyUrl, loadBinaryPointCloud, loadPlyUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setMode("plyFile");
            loadPlyFile(e.target.files[0]);
        }
    };

    return (
        <group>
            <Html
                style={{
                    position: "absolute",
                    top: "12px",
                    left: "12px",
                    width: "280px",
                    pointerEvents: "auto",
                    userSelect: "none",
                }}
            >
                <div
                    style={{
                        background: "var(--color-bg-card)",
                        backdropFilter: "var(--backdrop-blur-lg)",
                        border: "1px solid var(--color-border-strong)",
                        borderRadius: "var(--radius-xl)",
                        padding: "var(--spacing-2xl)",
                        color: "var(--color-text-primary)",
                        fontFamily: "var(--font-sans)",
                        fontSize: "var(--font-size-sm)",
                        boxShadow: "var(--shadow-xl)",
                    }}
                >
                    <div
                        style={{
                            fontWeight: "var(--font-weight-semibold)",
                            fontSize: "var(--font-size-base)",
                            marginBottom: "var(--spacing-md)",
                            color: "var(--color-accent-text)",
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--spacing-xs)",
                        }}
                    >
                        <span>☁️</span> Point Cloud Source
                    </div>

                    {/* Mode Tabs */}
                    <div
                        style={{
                            display: "flex",
                            gap: "var(--spacing-2xs)",
                            marginBottom: "var(--spacing-lg)",
                            background: "var(--color-bg-subtle)",
                            padding: "var(--spacing-3xs)",
                            borderRadius: "var(--radius-md)",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setMode("binary")}
                            style={{
                                flex: 1,
                                padding: "var(--spacing-xs) var(--spacing-2xs)",
                                background: mode === "binary" ? "var(--color-accent)" : "transparent",
                                color: mode === "binary" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                                border: "none",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                fontSize: "var(--font-size-xs)",
                                fontWeight: "var(--font-weight-medium)",
                                transition: "var(--transition-normal)",
                            }}
                        >
                            Binary Stream
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("plyFile")}
                            style={{
                                flex: 1,
                                padding: "var(--spacing-xs) var(--spacing-2xs)",
                                background: mode === "plyFile" ? "var(--color-accent)" : "transparent",
                                color: mode === "plyFile" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                                border: "none",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                fontSize: "var(--font-size-xs)",
                                fontWeight: "var(--font-weight-medium)",
                                transition: "var(--transition-normal)",
                            }}
                        >
                            .PLY File
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("plyUrl")}
                            style={{
                                flex: 1,
                                padding: "var(--spacing-xs) var(--spacing-2xs)",
                                background: mode === "plyUrl" ? "var(--color-accent)" : "transparent",
                                color: mode === "plyUrl" ? "var(--color-text-contrast)" : "var(--color-text-muted)",
                                border: "none",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                fontSize: "var(--font-size-xs)",
                                fontWeight: "var(--font-weight-medium)",
                                transition: "var(--transition-normal)",
                            }}
                        >
                            PLY URL
                        </button>
                    </div>

                    {/* Mode Content */}
                    {mode === "binary" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
                            <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                                Backend Identifier:
                            </label>
                            <input
                                type="text"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                placeholder="Identifier UUID"
                                style={{
                                    background: "var(--color-bg-subtle)",
                                    border: "1px solid var(--color-border-strong)",
                                    color: "var(--color-text-secondary)",
                                    padding: "var(--spacing-xs) var(--spacing-sm)",
                                    borderRadius: "var(--radius-sm)",
                                    fontSize: "var(--font-size-xs)",
                                    fontFamily: "var(--font-mono)",
                                    width: "100%",
                                    boxSizing: "border-box",
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => loadBinaryPointCloud(identifier)}
                                disabled={isLoading}
                                style={{
                                    background: isLoading ? "var(--color-border-solid)" : "var(--color-accent)",
                                    color: "var(--color-text-contrast)",
                                    border: "none",
                                    padding: "var(--spacing-xs) var(--spacing-lg)",
                                    borderRadius: "var(--radius-sm)",
                                    cursor: isLoading ? "not-allowed" : "pointer",
                                    fontWeight: "var(--font-weight-medium)",
                                    fontSize: "var(--font-size-xs)",
                                }}
                            >
                                {isLoading ? "Streaming Binary..." : "Stream Binary"}
                            </button>
                        </div>
                    )}

                    {mode === "plyFile" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
                            <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                                Select .PLY File:
                            </label>
                            <input
                                type="file"
                                accept=".ply,.PLY"
                                onChange={handleFileChange}
                                style={{
                                    fontSize: "var(--font-size-xs)",
                                    color: "var(--color-text-body)",
                                }}
                            />
                            {selectedFileName && (
                                <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-accent-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    Selected: {selectedFileName}
                                </div>
                            )}
                        </div>
                    )}

                    {mode === "plyUrl" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
                            <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                                PLY File URL:
                            </label>
                            <input
                                type="text"
                                value={plyUrl}
                                onChange={(e) => setPlyUrl(e.target.value)}
                                style={{
                                    background: "var(--color-bg-subtle)",
                                    border: "1px solid var(--color-border-strong)",
                                    color: "var(--color-text-secondary)",
                                    padding: "var(--spacing-xs) var(--spacing-sm)",
                                    borderRadius: "var(--radius-sm)",
                                    fontSize: "var(--font-size-xs)",
                                    width: "100%",
                                    boxSizing: "border-box",
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => loadPlyUrl(plyUrl)}
                                disabled={isLoading}
                                style={{
                                    background: isLoading ? "var(--color-border-solid)" : "var(--color-accent)",
                                    color: "var(--color-text-contrast)",
                                    border: "none",
                                    padding: "var(--spacing-xs) var(--spacing-lg)",
                                    borderRadius: "var(--radius-sm)",
                                    cursor: isLoading ? "not-allowed" : "pointer",
                                    fontWeight: "var(--font-weight-medium)",
                                    fontSize: "var(--font-size-xs)",
                                }}
                            >
                                {isLoading ? "Loading PLY..." : "Load PLY URL"}
                            </button>
                        </div>
                    )}

                    {/* Status / Errors / Stats */}
                    <div
                        style={{
                            marginTop: "var(--spacing-md)",
                            paddingTop: "var(--spacing-sm)",
                            borderTop: "1px solid var(--color-border-subtle)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        {isLoading ? (
                            <span style={{ color: "var(--color-warning)", fontStyle: "italic" }}>Loading...</span>
                        ) : error ? (
                            <span style={{ color: "var(--color-danger-text)", fontSize: "var(--font-size-2xs)" }}>{error}</span>
                        ) : pointCount !== null ? (
                            <span style={{ color: "var(--color-success-text)", fontWeight: "var(--font-weight-medium)" }}>
                                {pointCount.toLocaleString()} pts loaded
                            </span>
                        ) : (
                            <span style={{ color: "var(--color-text-subtle)" }}>No points loaded</span>
                        )}
                    </div>
                </div>
            </Html>

            {geometry && (
                <points geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                    <pointsMaterial
                        vertexColors={!!geometry.attributes.color}
                        size={0.1}
                        sizeAttenuation
                    />
                </points>
            )}
        </group>
    );
}