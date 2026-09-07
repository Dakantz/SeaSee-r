import * as THREE from "three";
import type { EngineCallbacks, EngineConfig, PerfTestMetric, PerfTestSummary } from "../types";

export const PERF_TEST_START_POS = new THREE.Vector3(10, -100, 10);
export const PERF_TEST_END_POS = new THREE.Vector3(10, 100, -10);
export const PERF_TEST_DURATION_SEC = 30;

export class BenchmarkSystem {
    private camera: THREE.Camera;
    private callbacks: EngineCallbacks;

    private isRunning: boolean = false;
    private isCompleted: boolean = false;
    private totalElapsedSec: number = 0;
    private totalFrames: number = 0;
    private framesInSec: number = 0;
    private secTimer: number = 0;
    private secondCount: number = 0;
    private metrics: PerfTestMetric[] = [];
    private pointCount: number = 0;

    constructor(camera: THREE.Camera, callbacks: EngineCallbacks = {}) {
        this.camera = camera;
        this.callbacks = callbacks;
    }

    public setCamera(camera: THREE.Camera): void {
        this.camera = camera;
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        if (config.pointCount !== undefined) {
            this.pointCount = config.pointCount ?? 0;
        }
    }

    public startBenchmark(): void {
        this.camera.position.copy(PERF_TEST_START_POS);
        this.camera.up.set(0, 0, 1);
        this.camera.lookAt(PERF_TEST_END_POS);

        this.totalElapsedSec = 0;
        this.totalFrames = 0;
        this.framesInSec = 0;
        this.secTimer = 0;
        this.secondCount = 0;
        this.metrics = [];
        this.isCompleted = false;
        this.isRunning = true;

        console.log("=================================================");
        console.log("[PointCloudOverview Performance Test Started]");
        console.log("Start Camera Position:", PERF_TEST_START_POS);
        console.log("End Camera Position:", PERF_TEST_END_POS);
        console.log(`Duration: ${PERF_TEST_DURATION_SEC} seconds`);
        console.log("=================================================");
    }

    public stopBenchmark(): void {
        if (this.isRunning) {
            this.isRunning = false;
            this.isCompleted = true;
            console.log("[PointCloudOverview Performance Test Cancelled]");
        }
    }

    public update(delta: number): void {
        if (!this.isRunning || this.isCompleted) return;

        this.totalElapsedSec += delta;
        const progress = Math.min(1, this.totalElapsedSec / PERF_TEST_DURATION_SEC);

        // Lerp camera position
        this.camera.position.lerpVectors(PERF_TEST_START_POS, PERF_TEST_END_POS, progress);
        this.camera.up.set(0, 0, 1);
        if (this.camera.position.distanceToSquared(PERF_TEST_END_POS) > 0.001) {
            this.camera.lookAt(PERF_TEST_END_POS);
        }

        this.totalFrames++;
        this.framesInSec++;
        this.secTimer += delta;

        if (this.secTimer >= 1.0) {
            this.recordMetric();
            this.framesInSec = 0;
            this.secTimer = 0;
        }

        if (progress >= 1.0) {
            if (this.framesInSec > 0) {
                this.recordMetric();
            }

            this.camera.position.copy(PERF_TEST_END_POS);

            const totalDurationSec = this.totalElapsedSec;
            const totalFrames = this.totalFrames;
            const averageFps = totalFrames > 0 && totalDurationSec > 0 ? Math.round((totalFrames / totalDurationSec) * 100) / 100 : 0;
            const averageFrameTimeMs = totalFrames > 0 ? Math.round((totalDurationSec / totalFrames) * 1000 * 100) / 100 : 0;

            const summary: PerfTestSummary = {
                averageFps,
                averageFrameTimeMs,
                totalFrames,
                totalDurationSec: Math.round(totalDurationSec * 100) / 100,
                metrics: [...this.metrics],
            };

            (window as any).__PLY_PERFORMANCE_TEST_RESULTS__ = summary;

            this.callbacks.onBenchmarkComplete?.(summary);
            this.isRunning = false;
            this.isCompleted = true;

            console.log("=================================================");
            console.log("[PointCloudOverview Performance Test Completed]");
            console.log(`Average FPS: ${summary.averageFps}`);
            console.log(`Average Frametime: ${summary.averageFrameTimeMs} ms`);
            console.log(`Total Frames: ${summary.totalFrames}`);
            console.log(`Total Duration: ${summary.totalDurationSec}s`);
            console.log("=================================================");
        }
    }

    private recordMetric(): void {
        this.secondCount++;
        const windowDuration = this.secTimer;
        const count = this.framesInSec;
        const calculatedFps = count > 0 && windowDuration > 0 ? Math.round((count / windowDuration) * 100) / 100 : 0;
        const calculatedFrameTimeMs = count > 0 ? Math.round((windowDuration / count) * 1000 * 100) / 100 : 0;

        const metric: PerfTestMetric = {
            second: this.secondCount,
            fps: calculatedFps,
            frameTimeMs: calculatedFrameTimeMs,
            pointsCount: this.pointCount,
            position: {
                x: Math.round(this.camera.position.x * 1000) / 1000,
                y: Math.round(this.camera.position.y * 1000) / 1000,
                z: Math.round(this.camera.position.z * 1000) / 1000,
            },
        };

        this.metrics.push(metric);

        console.log(
            `[Performance Test] Second ${metric.second}s: ${metric.fps} FPS | ${metric.frameTimeMs} ms | ${metric.pointsCount.toLocaleString()} points | Pos: (${metric.position.x}, ${metric.position.y}, ${metric.position.z})`
        );
    }

    public destroy(): void {
        this.stopBenchmark();
        this.metrics = [];
    }
}
