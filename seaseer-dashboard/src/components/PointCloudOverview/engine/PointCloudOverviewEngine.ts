import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CameraViewTarget, EngineCallbacks, EngineConfig } from "./types";
import { patchGeoThreeHeight } from "./patches/patchGeoThreeHeight";
import { LightingSystem, TARGET_X, TARGET_Y } from "./systems/LightingSystem";
import { TerrainSystem } from "./systems/TerrainSystem";
import { MarkerSystem } from "./systems/MarkerSystem";
import { TrajectorySystem } from "./systems/TrajectorySystem";
import { TransformGizmoSystem } from "./systems/TransformGizmoSystem";
import { BenchmarkSystem } from "./systems/BenchmarkSystem";

export class PointCloudOverviewEngine {
    private container: HTMLElement;
    private callbacks: EngineCallbacks;

    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;

    private lightingSystem: LightingSystem;
    private terrainSystem: TerrainSystem;
    private markerSystem: MarkerSystem;
    private trajectorySystem: TrajectorySystem;
    private transformGizmoSystem: TransformGizmoSystem;
    private benchmarkSystem: BenchmarkSystem;

    private animationFrameId: number | null = null;
    private clock: THREE.Clock;
    private resizeObserver: ResizeObserver | null = null;

    constructor(container: HTMLElement, callbacks: EngineCallbacks = {}, initialConfig: Partial<EngineConfig> = {}) {
        this.container = container;
        this.callbacks = callbacks;

        // Apply Geo-Three patch
        patchGeoThreeHeight();

        // Initialize Scene
        this.scene = new THREE.Scene();
        this.scene.name = "PointCloudOverviewScene";
        this.scene.background = new THREE.Color(0x050811);

        // Initialize Camera
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        this.camera.position.set(TARGET_X, TARGET_Y - 50, 100);
        this.camera.up.set(0, 0, 1);

        // Initialize WebGLRenderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        container.appendChild(this.renderer.domElement);

        // Initialize OrbitControls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(TARGET_X, TARGET_Y, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.update();

        // Initialize Clock
        this.clock = new THREE.Clock();

        // Initialize Systems
        this.lightingSystem = new LightingSystem(this.scene, initialConfig);
        this.terrainSystem = new TerrainSystem(this.scene, initialConfig);
        this.markerSystem = new MarkerSystem(this.scene, this.camera, this.renderer.domElement, this.callbacks, initialConfig);
        this.trajectorySystem = new TrajectorySystem(this.scene, this.camera, this.renderer.domElement, this.callbacks, initialConfig);
        this.transformGizmoSystem = new TransformGizmoSystem(this.scene, this.camera, this.renderer.domElement, this.callbacks, initialConfig);
        this.benchmarkSystem = new BenchmarkSystem(this.camera, this.callbacks);

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
        this.trajectorySystem.handleResize(width, height);
    }

    public updateConfig(newConfig: Partial<EngineConfig>): void {
        if (newConfig.cameraViewTarget) {
            this.applyCameraViewTarget(newConfig.cameraViewTarget);
        }

        this.lightingSystem.updateConfig(newConfig);
        this.terrainSystem.updateConfig(newConfig);
        this.markerSystem.updateConfig(newConfig);
        this.trajectorySystem.updateConfig(newConfig);
        this.transformGizmoSystem.updateConfig(newConfig);
        this.benchmarkSystem.updateConfig(newConfig);
    }

    public applyCameraViewTarget(target: CameraViewTarget): void {
        if (target.position) {
            this.camera.position.set(...target.position);
        }
        if (target.quaternion && target.quaternion.length === 4) {
            this.camera.quaternion.set(
                target.quaternion[0],
                target.quaternion[1],
                target.quaternion[2],
                target.quaternion[3]
            );
        }
        if (target.fov !== undefined && target.fov > 0) {
            this.camera.fov = target.fov;
            this.camera.updateProjectionMatrix();
        }
        if (target.target) {
            this.controls.target.set(...target.target);
            this.controls.update();
        }
    }

    public focusCameraTarget(center: [number, number, number]): void {
        const [cx, cy, cz] = center;
        this.controls.target.set(cx, cy, cz);
        this.camera.position.set(cx, cy - 50, cz + 30);
        this.camera.lookAt(cx, cy, cz);
        this.controls.update();
    }

    public startBenchmark(): void {
        this.benchmarkSystem.startBenchmark();
    }

    private tick(): void {
        const delta = this.clock.getDelta();

        this.controls.update();
        this.terrainSystem.update(this.camera, this.renderer);
        this.benchmarkSystem.update(delta);

        this.renderer.render(this.scene, this.camera);

        this.animationFrameId = requestAnimationFrame(this.tick);
    }

    public destroy(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // Destroy systems
        this.lightingSystem.destroy(this.scene);
        this.terrainSystem.destroy();
        this.markerSystem.destroy();
        this.trajectorySystem.destroy();
        this.transformGizmoSystem.destroy();
        this.benchmarkSystem.destroy();

        // Dispose controls
        this.controls.dispose();

        // Traverse scene and dispose resources
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
