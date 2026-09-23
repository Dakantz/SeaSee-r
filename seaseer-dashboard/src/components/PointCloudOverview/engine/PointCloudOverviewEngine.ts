import * as THREE from "three";
import type { CameraViewTarget, EngineCallbacks, EngineConfig, PerfTestMetric, PerfTestSummary } from "./types";
import { patchGeoThreeHeight } from "./patches/patchGeoThreeHeight";
import { PointCloudSystem } from "./systems/PointCloudSystem";
import { TerrainSystem } from "./systems/TerrainSystem";
import { TransformGizmoSystem } from "./systems/TransformGizmoSystem";
import { CameraMovementSystem } from "./systems/CameraMovementSystem";

export const TARGET_X = 0;
export const TARGET_Y = 0;

export const PERF_TEST_START_POS = new THREE.Vector3(10, -100, 10);
export const PERF_TEST_END_POS = new THREE.Vector3(10, 100, -10);
export const PERF_TEST_LOOK_TARGET = new THREE.Vector3(0, 0, 0);
export const PERF_TEST_DURATION_SEC = 30;

export class PointCloudOverviewEngine {
    private container: HTMLElement;
    private callbacks: EngineCallbacks;

    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private cameraMovementSystem: CameraMovementSystem;

    private ambientLight: THREE.AmbientLight;
    private dirLight: THREE.DirectionalLight;

    private pointCloudSystem: PointCloudSystem;
    private terrainSystem: TerrainSystem;
    private transformGizmoSystem: TransformGizmoSystem;

    private animationFrameId: number | null = null;
    private clock: THREE.Clock;
    private resizeObserver: ResizeObserver | null = null;

    // Performance Test State
    private isPerfRunning: boolean = false;
    private perfTotalElapsedSec: number = 0;
    private perfTotalFrames: number = 0;
    private perfFramesInSec: number = 0;
    private perfSecTimer: number = 0;
    private perfSecondCount: number = 0;
    private perfMetrics: PerfTestMetric[] = [];
    private lastCameraTargetTimestamp: number | null = null;

    constructor(container: HTMLElement, callbacks: EngineCallbacks = {}, initialConfig: Partial<EngineConfig> = {}) {
        this.container = container;
        this.callbacks = callbacks;

        // Apply Geo-Three patch
        patchGeoThreeHeight();

        // Initialize Scene
        this.scene = new THREE.Scene();
        this.scene.name = "PointCloudOverviewScene";
        this.scene.background = new THREE.Color(0x050811);

        // Initialize Scene Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.dirLight.position.set(-5000, 5000, 8000);
        this.scene.add(this.dirLight);

        // Initialize Camera
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        this.camera.position.set(TARGET_X, TARGET_Y - 50, 100);
        this.camera.up.set(0, 0, 1);
        this.camera.lookAt(TARGET_X, TARGET_Y, 0);

        // Initialize WebGLRenderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        container.appendChild(this.renderer.domElement);

        // Initialize CameraMovementSystem (WASDQE + In-Place Rotation + Pan/Zoom)
        this.cameraMovementSystem = new CameraMovementSystem(this.camera, this.renderer.domElement);
        if (initialConfig.isCameraUpFixed !== undefined) {
            this.cameraMovementSystem.isFixedUp = initialConfig.isCameraUpFixed;
        }
        if (initialConfig.cameraViewTarget) {
            this.applyCameraViewTarget(initialConfig.cameraViewTarget);
        }
        if (initialConfig.cameraTarget) {
            const { x, y, z, offset, timestamp } = initialConfig.cameraTarget;
            this.lastCameraTargetTimestamp = timestamp ?? Date.now();
            if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
                this.focusCameraTarget([x, y, z], offset);
            }
        }

        // Initialize Clock
        this.clock = new THREE.Clock();

        // Initialize Core Systems
        this.pointCloudSystem = new PointCloudSystem(this.scene, this.callbacks, initialConfig);
        this.terrainSystem = new TerrainSystem(this.scene, initialConfig);

        const gizmoCallbacks: EngineCallbacks = {
            ...this.callbacks,
            onSetIsGizmoDragging: (dragging: boolean) => {
                this.cameraMovementSystem.setIsGizmoDragging(dragging);
                this.callbacks.onSetIsGizmoDragging?.(dragging);
            },
            onToggleCameraUpFixed: () => {
                this.cameraMovementSystem.isFixedUp = !this.cameraMovementSystem.isFixedUp;
                this.callbacks.onToggleCameraUpFixed?.();
                this.callbacks.onSetIsCameraUpFixed?.(this.cameraMovementSystem.isFixedUp);
            },
            onSetIsCameraUpFixed: (fixed: boolean) => {
                this.cameraMovementSystem.isFixedUp = fixed;
                this.callbacks.onSetIsCameraUpFixed?.(fixed);
            },
            onPreviewPointcloudTransform: (id: string, matrixArray: number[]) => {
                this.pointCloudSystem.updateTargetTransform(id, matrixArray);
                this.callbacks.onPreviewPointcloudTransform?.(id, matrixArray);
            },
            onUpdatePointcloudTransform: (id: string, matrixArray: number[]) => {
                this.pointCloudSystem.updateTargetTransform(id, matrixArray);
                this.callbacks.onUpdatePointcloudTransform?.(id, matrixArray);
            },
        };
        this.transformGizmoSystem = new TransformGizmoSystem(this.scene, this.camera, this.renderer, gizmoCallbacks, initialConfig);

        // Bind Resize Observer
        this.initResizeObserver();

        // Start Loop
        this.tick = this.tick.bind(this);
        this.animationFrameId = requestAnimationFrame(this.tick);
    }

    private initResizeObserver(): void {
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                const height = entry.contentRect.height;
                if (width > 0 && height > 0) {
                    this.handleResize(width, height);
                }
            }
        });
        this.resizeObserver.observe(this.container);
    }

    public handleResize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    public updateConfig(newConfig: Partial<EngineConfig>): void {
        if (newConfig.cameraViewTarget) {
            this.applyCameraViewTarget(newConfig.cameraViewTarget);
        }
        if (newConfig.cameraTarget) {
            const { x, y, z, offset, timestamp } = newConfig.cameraTarget;
            if (timestamp === undefined || timestamp !== this.lastCameraTargetTimestamp) {
                this.lastCameraTargetTimestamp = timestamp ?? Date.now();
                if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
                    this.focusCameraTarget([x, y, z], offset);
                }
            }
        } else if (newConfig.cameraTarget === null) {
            this.lastCameraTargetTimestamp = null;
        }
        if (newConfig.isCameraUpFixed !== undefined) {
            this.cameraMovementSystem.isFixedUp = newConfig.isCameraUpFixed;
        }

        this.pointCloudSystem.updateConfig(newConfig);
        this.terrainSystem.updateConfig(newConfig);
        this.transformGizmoSystem.updateConfig(newConfig);
    }

    public applyCameraViewTarget(target: CameraViewTarget): void {
        this.cameraMovementSystem.setCameraViewTarget(target);
    }

    public focusCameraTarget(center: [number, number, number], offset?: [number, number, number] | number): void {
        this.cameraMovementSystem.focusOnTarget(new THREE.Vector3(...center), offset);
    }

    public setIsGizmoDragging(dragging: boolean): void {
        this.cameraMovementSystem.setIsGizmoDragging(dragging);
    }

    public setIsCameraUpFixed(fixed: boolean): void {
        this.cameraMovementSystem.isFixedUp = fixed;
    }

    public setShowOutlines(show: boolean): void {
        this.pointCloudSystem.setShowOutlines(show);
    }

    public startPerformanceTest(): void {
        this.perfTotalElapsedSec = 0;
        this.perfTotalFrames = 0;
        this.perfFramesInSec = 0;
        this.perfSecTimer = 0;
        this.perfSecondCount = 0;
        this.perfMetrics = [];

        this.cameraMovementSystem.setEnabled(false);

        this.camera.position.copy(PERF_TEST_START_POS);
        this.camera.up.set(0, 0, 1);
        this.camera.lookAt(PERF_TEST_LOOK_TARGET);

        this.isPerfRunning = true;

        console.log("=================================================");
        console.log("[PointCloudOverviewEngine Performance Test Started]");
        console.log("Start Camera Position:", PERF_TEST_START_POS);
        console.log("End Camera Position:", PERF_TEST_END_POS);
        console.log("Look At Target:", PERF_TEST_LOOK_TARGET);
        console.log(`Duration: ${PERF_TEST_DURATION_SEC} seconds`);
        console.log("=================================================");
    }

    public stopPerformanceTest(cancelled: boolean = true): void {
        if (!this.isPerfRunning) return;
        this.isPerfRunning = false;
        this.cameraMovementSystem.setEnabled(true);

        if (cancelled) {
            console.log("[PointCloudOverviewEngine Performance Test Cancelled by User]");
            this.callbacks.onPerfTestCancel?.();
        }
    }

    public isPerformanceTestRunning(): boolean {
        return this.isPerfRunning;
    }

    private tick(): void {
        const delta = this.clock.getDelta();

        if (this.isPerfRunning) {
            this.perfTotalElapsedSec += delta;
            const progress = Math.min(1, this.perfTotalElapsedSec / PERF_TEST_DURATION_SEC);

            // Lerp camera position between start and end while rotating to continuously look at the center
            this.camera.position.lerpVectors(PERF_TEST_START_POS, PERF_TEST_END_POS, progress);
            this.camera.up.set(0, 0, 1);
            this.camera.lookAt(PERF_TEST_LOOK_TARGET);

            this.perfTotalFrames++;
            this.perfFramesInSec++;
            this.perfSecTimer += delta;

            if (this.perfSecTimer >= 1.0) {
                this.perfSecondCount += 1;
                const windowDuration = this.perfSecTimer;
                const count = this.perfFramesInSec;
                const calculatedFps = count > 0 && windowDuration > 0 ? Math.round((count / windowDuration) * 100) / 100 : 0;
                const calculatedFrameTimeMs = count > 0 ? Math.round((windowDuration / count) * 1000 * 100) / 100 : 0;
                const currentPoints = this.pointCloudSystem?.getTotalPointCount?.() ?? 0;

                const metric: PerfTestMetric = {
                    second: this.perfSecondCount,
                    fps: calculatedFps,
                    frameTimeMs: calculatedFrameTimeMs,
                    pointsCount: currentPoints,
                    position: {
                        x: Math.round(this.camera.position.x * 1000) / 1000,
                        y: Math.round(this.camera.position.y * 1000) / 1000,
                        z: Math.round(this.camera.position.z * 1000) / 1000,
                    },
                };

                this.perfMetrics.push(metric);
                this.callbacks.onPerfTestProgress?.(calculatedFps, calculatedFrameTimeMs, metric);

                console.log(
                    `[PointCloudOverviewEngine Performance Test] Second ${metric.second}s: ${metric.fps} FPS | ${metric.frameTimeMs} ms | ${metric.pointsCount.toLocaleString()} points | Pos: (${metric.position.x}, ${metric.position.y}, ${metric.position.z})`
                );

                this.perfFramesInSec = 0;
                this.perfSecTimer = 0;
            }

            if (progress >= 1.0) {
                if (this.perfFramesInSec > 0) {
                    this.perfSecondCount += 1;
                    const windowDuration = this.perfSecTimer;
                    const count = this.perfFramesInSec;
                    const calculatedFps = count > 0 && windowDuration > 0 ? Math.round((count / windowDuration) * 100) / 100 : 0;
                    const calculatedFrameTimeMs = count > 0 ? Math.round((windowDuration / count) * 1000 * 100) / 100 : 0;
                    const currentPoints = this.pointCloudSystem?.getTotalPointCount?.() ?? 0;

                    const metric: PerfTestMetric = {
                        second: this.perfSecondCount,
                        fps: calculatedFps,
                        frameTimeMs: calculatedFrameTimeMs,
                        pointsCount: currentPoints,
                        position: {
                            x: Math.round(this.camera.position.x * 1000) / 1000,
                            y: Math.round(this.camera.position.y * 1000) / 1000,
                            z: Math.round(this.camera.position.z * 1000) / 1000,
                        },
                    };

                    this.perfMetrics.push(metric);
                    this.callbacks.onPerfTestProgress?.(calculatedFps, calculatedFrameTimeMs, metric);

                    this.perfFramesInSec = 0;
                    this.perfSecTimer = 0;
                }

                this.camera.position.copy(PERF_TEST_END_POS);
                this.camera.up.set(0, 0, 1);
                this.camera.lookAt(PERF_TEST_LOOK_TARGET);

                const totalDurationSec = this.perfTotalElapsedSec;
                const totalFrames = this.perfTotalFrames;
                const averageFps = totalFrames > 0 && totalDurationSec > 0 ? Math.round((totalFrames / totalDurationSec) * 100) / 100 : 0;
                const averageFrameTimeMs = totalFrames > 0 ? Math.round((totalDurationSec / totalFrames) * 1000 * 100) / 100 : 0;

                const summary: PerfTestSummary = {
                    averageFps,
                    averageFrameTimeMs,
                    totalFrames,
                    totalDurationSec: Math.round(totalDurationSec * 100) / 100,
                    metrics: [...this.perfMetrics],
                };

                (window as any).__PLY_PERFORMANCE_TEST_RESULTS__ = summary;

                this.callbacks.onPerfTestComplete?.(summary);
                this.stopPerformanceTest(false);

                console.log("=================================================");
                console.log("[PointCloudOverviewEngine Performance Test Completed]");
                console.log(`Average FPS: ${summary.averageFps}`);
                console.log(`Average Frametime: ${summary.averageFrameTimeMs} ms`);
                console.log(`Total Frames: ${summary.totalFrames}`);
                console.log(`Total Duration: ${summary.totalDurationSec}s`);
                console.log("Per-second breakdown:", summary.metrics);
                console.log("=================================================");
            }
        }

        this.cameraMovementSystem.update(delta);
        this.pointCloudSystem.update(this.camera);
        this.terrainSystem.update(this.camera, this.renderer);
        this.renderer.render(this.scene, this.camera);
        this.transformGizmoSystem.render();
        this.animationFrameId = requestAnimationFrame(this.tick);
    }

    public destroy(): void {
        if (this.isPerfRunning) {
            this.stopPerformanceTest(true);
        }

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // Destroy core systems
        this.cameraMovementSystem.destroy();
        this.pointCloudSystem.destroy();
        this.terrainSystem.destroy();
        this.transformGizmoSystem.destroy();

        // Dispose lights
        this.scene.remove(this.ambientLight);
        this.scene.remove(this.dirLight);
        this.ambientLight.dispose();
        this.dirLight.dispose();

        // Traverse scene and dispose remaining resources
        this.scene.traverse((child: any) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((mat: any) => {
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                });
            }
        });

        // Dispose renderer & canvas
        this.renderer.dispose();
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }

        this.scene.clear();
    }
}
