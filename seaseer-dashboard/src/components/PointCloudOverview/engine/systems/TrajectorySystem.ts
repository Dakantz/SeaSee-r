import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { EngineCallbacks, EngineConfig } from "../types";
import { TelemetryPositionReader, type PositionSample } from "../../../TelemetoryPanel/TelemetryPositionReader";
import { getPointCloudTransform } from "../../../PointCloudPanel/utils/pointCloudTransform";

interface RouteItem {
    key: string;
    pcId: string;
    url: string;
    allowedHeaderIds: Set<string>;
    position: [number, number, number];
}

interface LoadedRoute {
    group: THREE.Group;
    lineObj?: Line2;
    pointsMesh?: THREE.Points;
    samples: PositionSample[];
    pcId: string;
}

export class TrajectorySystem {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private domElement: HTMLElement;
    private callbacks: EngineCallbacks;

    private rootGroup: THREE.Group;
    private loadedRoutes: Map<string, LoadedRoute> = new Map();
    private raycaster: THREE.Raycaster;
    private pointer: THREE.Vector2;

    private showCameraTrajectories: boolean = false;
    private queries: any[] = [];
    private summaryMap: Record<string, any> = {};
    private catalog: any[] = [];
    private headerMap: Map<string, { id: string; focal?: number | null; width?: number | null; height?: number | null }> = new Map();

    private boundOnClick: (e: MouseEvent) => void;
    private currentResolution: THREE.Vector2 = new THREE.Vector2(window.innerWidth, window.innerHeight);

    constructor(
        scene: THREE.Scene,
        camera: THREE.Camera,
        domElement: HTMLElement,
        callbacks: EngineCallbacks = {},
        config: Partial<EngineConfig> = {}
    ) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.callbacks = callbacks;

        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "TrajectorySystemGroup";
        this.scene.add(this.rootGroup);

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.boundOnClick = this.onClick.bind(this);
        this.domElement.addEventListener("click", this.boundOnClick);

        this.updateConfig(config);
    }

    public setCamera(camera: THREE.Camera): void {
        this.camera = camera;
    }

    public handleResize(width: number, height: number): void {
        this.currentResolution.set(width, height);
        this.loadedRoutes.forEach((route) => {
            if (route.lineObj && route.lineObj.material) {
                route.lineObj.material.resolution.set(width, height);
            }
        });
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        let shouldRebuild = false;

        if (config.showCameraTrajectories !== undefined) {
            if (this.showCameraTrajectories !== config.showCameraTrajectories) {
                this.showCameraTrajectories = config.showCameraTrajectories;
                shouldRebuild = true;
            }
        }
        if (config.queries !== undefined) {
            this.queries = config.queries;
            shouldRebuild = true;
        }
        if (config.summaryMap !== undefined) {
            this.summaryMap = config.summaryMap;
            this.buildHeaderMap();
            shouldRebuild = true;
        }
        if (config.catalog !== undefined) {
            this.catalog = config.catalog;
        }

        if (shouldRebuild) {
            this.rebuildRoutes();
        }
    }

    private buildHeaderMap(): void {
        this.headerMap.clear();
        if (!this.summaryMap) return;
        Object.values(this.summaryMap).forEach((summary) => {
            if (summary?.connected_camera_headers) {
                summary.connected_camera_headers.forEach((h: any) => {
                    if (h && h.id) {
                        this.headerMap.set(h.id, h);
                    }
                });
            }
        });
    }

    private async rebuildRoutes(): Promise<void> {
        this.clearRoutes();

        if (!this.showCameraTrajectories || this.queries.length === 0) {
            return;
        }

        const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
        const routesToRender: RouteItem[] = [];
        const seenRouteKeys = new Set<string>();

        for (const query of this.queries) {
            const qId = query.id;
            if (!qId) continue;
            const summary = this.summaryMap?.[qId];
            const connectedHeaders = summary?.connected_camera_headers;

            if (!connectedHeaders || connectedHeaders.length === 0) {
                const pcIdRule = query?.filters?.find(
                    (f: any) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
                )?.value;
                const pcId = pcIdRule ? String(pcIdRule) : (qId.includes("-") && qId.length >= 32 ? qId : null);

                if (pcId) {
                    const rKey = `${qId}-${pcId}`;
                    if (!seenRouteKeys.has(rKey)) {
                        seenRouteKeys.add(rKey);
                        routesToRender.push({
                            key: rKey,
                            pcId,
                            url: `${apiBaseUrl}/pointclouds/${pcId}/camera-routes`,
                            allowedHeaderIds: new Set<string>(),
                            position: [0, 0, 0],
                        });
                    }
                }
                continue;
            }

            const headersByPc = new Map<string, Set<string>>();
            for (const header of connectedHeaders) {
                if (header.pointcloud_id && header.id) {
                    if (!headersByPc.has(header.pointcloud_id)) {
                        headersByPc.set(header.pointcloud_id, new Set());
                    }
                    headersByPc.get(header.pointcloud_id)!.add(header.id);
                }
            }

            headersByPc.forEach((headerIds, pcId) => {
                const rKey = `${qId}-${pcId}`;
                if (!seenRouteKeys.has(rKey)) {
                    seenRouteKeys.add(rKey);
                    routesToRender.push({
                        key: rKey,
                        pcId,
                        url: `${apiBaseUrl}/pointclouds/${pcId}/camera-routes`,
                        allowedHeaderIds: headerIds,
                        position: [0, 0, 0],
                    });
                }
            });
        }

        for (const route of routesToRender) {
            await this.loadAndBuildRoute(route);
        }
    }

    private async loadAndBuildRoute(route: RouteItem): Promise<void> {
        try {
            const reader = new TelemetryPositionReader(route.url);
            const rawSamples = await reader.getPositionData();
            const samples = route.allowedHeaderIds.size > 0
                ? rawSamples.filter((s: PositionSample) => s.cameraHeaderId && route.allowedHeaderIds.has(s.cameraHeaderId))
                : rawSamples;

            if (samples.length === 0) return;

            const routeGroup = new THREE.Group();
            routeGroup.name = `Route_${route.key}`;

            // Apply pointcloud world transform onto the route group
            const { matrixArr } = getPointCloudTransform(route.pcId, this.summaryMap, this.catalog);
            if (matrixArr && matrixArr.length === 16) {
                const matWorld = new THREE.Matrix4().fromArray(matrixArr);
                routeGroup.applyMatrix4(matWorld);
            }

            const positions: number[] = [];
            samples.forEach((s: PositionSample) => {
                positions.push(s.x, s.y, s.z);
            });

            // Line geometry
            const lineGeometry = new LineGeometry();
            lineGeometry.setPositions(positions);

            const lineMaterial = new LineMaterial({
                color: 0x00ffcc,
                linewidth: 3,
                resolution: this.currentResolution,
            });

            const lineObj = new Line2(lineGeometry, lineMaterial);
            lineObj.computeLineDistances();
            routeGroup.add(lineObj);

            // Points geometry for raycasting / point clicking
            const ptsGeometry = new THREE.BufferGeometry();
            ptsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            const ptsMaterial = new THREE.PointsMaterial({
                color: 0x00ffcc,
                size: 3.0,
                sizeAttenuation: false,
            });
            const pointsMesh = new THREE.Points(ptsGeometry, ptsMaterial);
            routeGroup.add(pointsMesh);

            this.rootGroup.add(routeGroup);
            this.loadedRoutes.set(route.key, {
                group: routeGroup,
                lineObj,
                pointsMesh,
                samples,
                pcId: route.pcId,
            });
        } catch (err) {
            console.error(`Failed to load camera route for ${route.key}:`, err);
        }
    }

    private onClick(event: MouseEvent): void {
        if (!this.showCameraTrajectories || this.loadedRoutes.size === 0) return;

        const rect = this.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        // Increase threshold for points raycasting
        this.raycaster.params.Points = { threshold: 10.0 };

        for (const [_, route] of this.loadedRoutes) {
            if (!route.pointsMesh) continue;
            const intersects = this.raycaster.intersectObject(route.pointsMesh);

            if (intersects.length > 0 && intersects[0].index !== undefined) {
                const index = intersects[0].index;
                const sample = route.samples[index];
                if (sample) {
                    this.handlePointClick(sample, [0, 0, 0], route.pcId);
                    break;
                }
            }
        }
    }

    private handlePointClick(sample: PositionSample, routePosition: [number, number, number], pcId: string): void {
        this.callbacks.onSetIsCameraUpFixed?.(false);

        const routeOffset = new THREE.Vector3(...routePosition);
        const localPos = new THREE.Vector3(sample.x, sample.y, sample.z);
        const worldPos = localPos.clone().add(routeOffset);

        let worldQuat: THREE.Quaternion;
        if (sample.rotation && Array.isArray(sample.rotation) && sample.rotation.length === 4) {
            worldQuat = new THREE.Quaternion(
                sample.rotation[0],
                sample.rotation[1],
                sample.rotation[2],
                sample.rotation[3]
            );
        } else if (sample.direction && Array.isArray(sample.direction) && sample.direction.length === 3) {
            const worldDir = new THREE.Vector3(sample.direction[0], sample.direction[1], sample.direction[2]).normalize();
            const tempCam = new THREE.PerspectiveCamera();
            tempCam.up.set(0, 0, 1);
            tempCam.position.copy(worldPos);
            tempCam.lookAt(worldPos.clone().add(worldDir));
            worldQuat = tempCam.quaternion.clone();
        } else {
            worldQuat = new THREE.Quaternion();
        }

        const { matrixArr } = getPointCloudTransform(pcId, this.summaryMap, this.catalog);
        if (matrixArr && matrixArr.length === 16) {
            const matWorld = new THREE.Matrix4().fromArray(matrixArr);
            worldPos.applyMatrix4(matWorld);

            const transformPos = new THREE.Vector3();
            const transformQuat = new THREE.Quaternion();
            const transformScale = new THREE.Vector3();
            matWorld.decompose(transformPos, transformQuat, transformScale);

            worldQuat.premultiply(transformQuat);
        }

        let fovDeg: number | undefined = undefined;
        if (sample.cameraHeaderId && this.headerMap.has(sample.cameraHeaderId)) {
            const header = this.headerMap.get(sample.cameraHeaderId);
            if (header && typeof header.focal === "number" && header.width && header.height) {
                const maxDim = Math.max(header.width, header.height);
                const focalPixels = header.focal * maxDim;
                if (focalPixels > 0) {
                    const fovRad = 2 * Math.atan((header.height / 2) / focalPixels);
                    fovDeg = fovRad * (180 / Math.PI);
                }
            }
        }

        this.callbacks.onCameraViewChange?.({
            position: [worldPos.x, worldPos.y, worldPos.z],
            quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
            fov: fovDeg,
        });
    }

    private clearRoutes(): void {
        this.loadedRoutes.forEach((route) => {
            if (route.lineObj) {
                route.lineObj.geometry.dispose();
                route.lineObj.material.dispose();
            }
            if (route.pointsMesh) {
                route.pointsMesh.geometry.dispose();
                (route.pointsMesh.material as THREE.Material).dispose();
            }
            this.rootGroup.remove(route.group);
        });
        this.loadedRoutes.clear();
    }

    public destroy(): void {
        this.domElement.removeEventListener("click", this.boundOnClick);
        this.clearRoutes();
        this.scene.remove(this.rootGroup);
    }
}
