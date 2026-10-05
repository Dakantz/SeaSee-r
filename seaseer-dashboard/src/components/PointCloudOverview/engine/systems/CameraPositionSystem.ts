import * as THREE from "three";
import { getApiBaseUrl } from "../../../../utils/apiConfig";
import type { EngineCallbacks, EngineConfig } from "../types";
import type { CustomQuery, QuerySummaryData } from "../../../PointCloudPanel/CustomQueryManager";
import { isConnectedPointCloudSelected, isPointCloudCameraVisible } from "../../../PointCloudPanel/CustomQueryManager";
import { getPointCloudTransform } from "../../../PointCloudPanel/utils/pointCloudTransform";
import { useTrajectoryLogSync, type TrajectorySyncPoint } from "../../../Logs/hooks/useTrajectoryLogSync";
import { useTimelineStore } from "../../../../store/timelineStore";
import type { PointCloudMetadataResponse } from "../../../../client";

/**
 * Camera Frame structure returned from backend endpoint:
 * GET /pointclouds/{identifier}/camera-routes
 */
export interface CameraFrameResponse {
    id: string;
    camera_header_id: string;
    timestamp: number;
    position?: [number, number, number] | number[] | null;
    direction?: [number, number, number] | number[] | null;
    rotation?: [number, number, number, number] | number[] | null;
    relative_time?: number | null;
    filename?: string | null;
}

interface PointCloudCameraVisual {
    pcId: string;
    group: THREE.Group;
    trajectoryLine?: THREE.Line;
    instancedMarkers?: THREE.InstancedMesh;
    directionLines?: THREE.LineSegments;
    frames: CameraFrameResponse[];
    matrixArr?: number[];
    center: [number, number, number];
}

/**
 * CameraPositionSystem
 * 
 * Visualizes 3D camera trajectory routes, spatial photo positions, and viewing directions
 * in the Three.js overview scene. Accurately applies point cloud transformation matrices
 * (spatial alignment, translations, rotations, scale) to camera positions.
 */
export class CameraPositionSystem {
    private scene: THREE.Scene;
    private callbacks: EngineCallbacks;
    private rootGroup: THREE.Group;
    private domElement?: HTMLElement;
    private camera?: THREE.Camera;

    private queries: CustomQuery[] = [];
    private summaryMap: Record<string, QuerySummaryData> = {};
    private catalog: PointCloudMetadataResponse[] = [];

    // Cache of fetched camera routes data per pointcloud ID
    private routesCache: Map<string, CameraFrameResponse[]> = new Map();
    private loadingSet: Set<string> = new Set();

    // Active 3D visual objects per pointcloud ID
    private visuals: Map<string, PointCloudCameraVisual> = new Map();

    // Raycasting & Interaction State
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2(-999, -999);
    private hoveredItem: { pcId: string; frame: CameraFrameResponse; index: number } | null = null;
    private tooltipElement: HTMLDivElement | null = null;
    private boundPointerMove: ((e: PointerEvent) => void) | null = null;
    private boundPointerLeave: (() => void) | null = null;
    private boundPointerDown: ((e: PointerEvent) => void) | null = null;

    constructor(
        scene: THREE.Scene,
        callbacks: EngineCallbacks = {},
        config: Partial<EngineConfig> = {},
        domElement?: HTMLElement,
        camera?: THREE.Camera
    ) {
        this.scene = scene;
        this.callbacks = callbacks;
        this.domElement = domElement;
        this.camera = camera;

        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "CameraPositionSystemRoot";
        this.scene.add(this.rootGroup);

        this.initInteraction();
        this.updateConfig(config);
    }

    private initInteraction(): void {
        if (!this.domElement) return;

        // Create interactive hover tooltip element
        this.tooltipElement = document.createElement("div");
        this.tooltipElement.className = "camera-position-tooltip";
        this.tooltipElement.style.position = "absolute";
        this.tooltipElement.style.pointerEvents = "none";
        this.tooltipElement.style.zIndex = "1000";
        this.tooltipElement.style.padding = "6px 10px";
        this.tooltipElement.style.background = "rgba(15, 23, 42, 0.92)";
        this.tooltipElement.style.border = "1px solid #38bdf8";
        this.tooltipElement.style.borderRadius = "6px";
        this.tooltipElement.style.color = "#f8fafc";
        this.tooltipElement.style.fontSize = "11px";
        this.tooltipElement.style.fontFamily = "monospace";
        this.tooltipElement.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)";
        this.tooltipElement.style.display = "none";
        this.tooltipElement.style.whiteSpace = "nowrap";

        const container = this.domElement.parentElement || document.body;
        container.appendChild(this.tooltipElement);

        this.boundPointerMove = (e: PointerEvent) => {
            if (!this.domElement) return;
            const rect = this.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            if (this.tooltipElement && this.hoveredItem) {
                this.tooltipElement.style.left = `${e.clientX - rect.left + 15}px`;
                this.tooltipElement.style.top = `${e.clientY - rect.top - 20}px`;
            }
        };

        this.boundPointerLeave = () => {
            this.mouse.set(-999, -999);
            this.clearHover();
        };

        this.boundPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return; // Only primary mouse click

            let hitItem = this.hoveredItem;
            if (!hitItem && this.camera && this.visuals.size > 0 && this.domElement) {
                const rect = this.domElement.getBoundingClientRect();
                const clickMouse = new THREE.Vector2(
                    ((e.clientX - rect.left) / rect.width) * 2 - 1,
                    -((e.clientY - rect.top) / rect.height) * 2 + 1
                );
                this.raycaster.setFromCamera(clickMouse, this.camera);
                let closestHit: { pcId: string; frame: CameraFrameResponse; index: number; distance: number } | null = null;
                for (const [pcId, visual] of this.visuals.entries()) {
                    if (!visual.instancedMarkers) continue;
                    const intersects = this.raycaster.intersectObject(visual.instancedMarkers, false);
                    if (intersects.length > 0) {
                        const hit = intersects[0];
                        if (hit.instanceId !== undefined && hit.instanceId < visual.frames.length) {
                            if (!closestHit || hit.distance < closestHit.distance) {
                                closestHit = {
                                    pcId,
                                    frame: visual.frames[hit.instanceId],
                                    index: hit.instanceId,
                                    distance: hit.distance,
                                };
                            }
                        }
                    }
                }
                if (closestHit) {
                    hitItem = { pcId: closestHit.pcId, frame: closestHit.frame, index: closestHit.index };
                }
            }

            if (hitItem) {
                const { pcId, frame, index } = hitItem;
                const pos = frame.position;
                let frameNumber: number | undefined;
                if (frame.filename) {
                    const m = frame.filename.match(/\d+/);
                    if (m) {
                        const parsed = parseInt(m[0], 10);
                        if (!isNaN(parsed)) frameNumber = parsed;
                    }
                }

                const syncPoint: TrajectorySyncPoint = {
                    id: frame.id,
                    index,
                    timestamp: frame.timestamp,
                    frameNumber,
                    relativeTime: frame.relative_time ?? undefined,
                    filename: frame.filename,
                    x: pos ? pos[0] : undefined,
                    y: pos ? pos[1] : undefined,
                    z: pos ? pos[2] : undefined,
                    direction: frame.direction ? (frame.direction as [number, number, number]) : undefined,
                    rotation: frame.rotation ? (frame.rotation as [number, number, number, number]) : undefined,
                    cameraHeaderId: frame.camera_header_id,
                    pointCloudId: pcId,
                };

                // Immediately pause all video playback across stores and DOM
                useTrajectoryLogSync.getState().pauseVideo();
                useTimelineStore.getState().pause();
                const videoElements = document.querySelectorAll("video");
                videoElements.forEach((v) => {
                    try {
                        v.pause();
                    } catch {
                        // ignore
                    }
                });

                useTrajectoryLogSync.getState().selectPoint(syncPoint, "3d");
                useTrajectoryLogSync.getState().focusTrajectory(pcId, true);
                this.callbacks.onSelectPointcloud?.(pcId);
            }
        };

        this.domElement.addEventListener("pointermove", this.boundPointerMove);
        this.domElement.addEventListener("pointerleave", this.boundPointerLeave);
        this.domElement.addEventListener("pointerdown", this.boundPointerDown);
    }

    private clearHover(): void {
        this.hoveredItem = null;
        if (this.tooltipElement) {
            this.tooltipElement.style.display = "none";
        }
        if (this.domElement) {
            this.domElement.style.cursor = "default";
        }
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        let dirty = false;

        if (config.queries !== undefined) {
            this.queries = config.queries;
            dirty = true;
        }
        if (config.summaryMap !== undefined) {
            this.summaryMap = config.summaryMap;
            dirty = true;
        }
        if (config.catalog !== undefined) {
            this.catalog = config.catalog;
            dirty = true;
        }

        if (dirty) {
            this.syncCameraRoutes();
        }
    }

    /**
     * Resolves all active pointcloud IDs that should have camera positions displayed,
     * fetches their camera routes if not yet loaded, and synchronizes 3D visuals.
     */
    private syncCameraRoutes(): void {
        const targetPcIds = new Set<string>();

        if (this.queries && this.queries.length > 0) {
            for (const query of this.queries) {
                if (!query.id) continue;

                const summary = this.summaryMap ? this.summaryMap[query.id] : undefined;
                const connectedPcs = summary?.connected_pointclouds || [];

                if (connectedPcs.length > 0) {
                    for (const pc of connectedPcs) {
                        if (!pc.id) continue;
                        const pcId = String(pc.id);
                        if (isPointCloudCameraVisible(query, pcId)) {
                            targetPcIds.add(pcId);
                        }
                    }
                } else {
                    // Check direct pointcloud_id filter
                    const pcRule = query.filters?.find(
                        (f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
                    )?.value;
                    const pcId = pcRule ? String(pcRule) : (query.id.length >= 32 ? query.id : null);
                    if (pcId && isPointCloudCameraVisible(query, pcId)) {
                        targetPcIds.add(pcId);
                    }
                }
            }
        }

        // 1. Remove visuals that are no longer active
        for (const [pcId, visual] of this.visuals.entries()) {
            if (!targetPcIds.has(pcId)) {
                this.disposeVisual(visual);
                this.visuals.delete(pcId);
            }
        }

        // 2. Add or update visuals for active pointclouds
        for (const pcId of targetPcIds) {
            if (this.visuals.has(pcId)) {
                // Update transform if metadata changed
                this.refreshVisualTransform(pcId);
            } else {
                // Fetch and create visual
                this.ensureCameraRoutesLoaded(pcId);
            }
        }
    }

    /**
     * Fetches camera route frames for the given pointcloud identifier
     * and triggers visual creation once loaded.
     */
    private async ensureCameraRoutesLoaded(pcId: string): Promise<void> {
        if (this.visuals.has(pcId)) return;

        // Use cache if available
        if (this.routesCache.has(pcId)) {
            const cachedFrames = this.routesCache.get(pcId)!;
            this.buildVisual(pcId, cachedFrames);
            return;
        }

        if (this.loadingSet.has(pcId)) return;
        this.loadingSet.add(pcId);

        try {
            const apiBaseUrl = getApiBaseUrl();
            const url = `${apiBaseUrl}/pointclouds/${pcId}/camera-routes`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[CameraPositionSystem] Failed to fetch camera routes for ${pcId}: ${response.status}`);
                return;
            }

            const data = await response.json();
            if (Array.isArray(data)) {
                this.routesCache.set(pcId, data);
                // Verify the pcId is still intended to be displayed
                if (this.isPointCloudCameraEnabled(pcId)) {
                    this.buildVisual(pcId, data);
                }
            }
        } catch (err) {
            console.error(`[CameraPositionSystem] Error loading camera routes for ${pcId}:`, err);
        } finally {
            this.loadingSet.delete(pcId);
        }
    }

    private isPointCloudCameraEnabled(pcId: string): boolean {
        if (!this.queries) return false;
        for (const q of this.queries) {
            const summary = this.summaryMap ? this.summaryMap[q.id] : undefined;
            const hasConnected = summary?.connected_pointclouds?.some((p) => p && String(p.id) === pcId);
            const hasFiltered = q.filters?.some((f) => f.field === "pointcloud_id" && String(f.value) === pcId);
            const isDirectId = q.id === pcId;

            if (hasConnected || hasFiltered || isDirectId) {
                if (isPointCloudCameraVisible(q, pcId)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Constructs Three.js visual objects (trajectory line, camera position markers, direction rays)
     * and sets up the pointcloud transformation matrix.
     */
    private buildVisual(pcId: string, frames: CameraFrameResponse[]): void {
        if (this.visuals.has(pcId)) {
            this.disposeVisual(this.visuals.get(pcId)!);
            this.visuals.delete(pcId);
        }

        const validFrames = frames.filter(
            (f) => f.position && Array.isArray(f.position) && f.position.length === 3 &&
                   !isNaN(f.position[0]) && !isNaN(f.position[1]) && !isNaN(f.position[2])
        );

        if (validFrames.length === 0) return;

        // Create container group for this pointcloud's camera positions
        const group = new THREE.Group();
        group.name = `CameraRouteGroup-${pcId}`;

        // Retrieve and apply point cloud spatial transformation
        const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog);
        if (matrixArr && matrixArr.length === 16) {
            group.matrixAutoUpdate = false;
            group.matrix.fromArray(matrixArr);
        } else {
            group.matrixAutoUpdate = true;
            group.position.set(center[0], center[1], center[2]);
        }
        group.matrixWorldNeedsUpdate = true;
        group.updateMatrixWorld(true);

        // 1. Trajectory Flight Path Line
        let trajectoryLine: THREE.Line | undefined;
        if (validFrames.length >= 2) {
            const linePoints = validFrames.map(
                (f) => new THREE.Vector3(f.position![0], f.position![1], f.position![2])
            );
            const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
            const lineMat = new THREE.LineBasicMaterial({
                color: 0x00f0ff, // Vibrant cyan
                linewidth: 2,
                transparent: true,
                opacity: 0.85,
                depthTest: true,
            });
            trajectoryLine = new THREE.Line(lineGeo, lineMat);
            trajectoryLine.name = `CameraTrajectoryLine-${pcId}`;
            group.add(trajectoryLine);
        }

        // 2. Camera Position Markers (High-performance InstancedMesh)
        const markerGeo = new THREE.SphereGeometry(0.035, 12, 10);
        const markerMat = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            emissive: 0x0284c7,
            emissiveIntensity: 0.5,
            roughness: 0.3,
            metalness: 0.2,
        });
        const instancedMarkers = new THREE.InstancedMesh(markerGeo, markerMat, validFrames.length);
        instancedMarkers.name = `CameraPositionMarkers-${pcId}`;
        instancedMarkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const dummy = new THREE.Object3D();
        const tempQuat = new THREE.Quaternion();

        for (let i = 0; i < validFrames.length; i++) {
            const f = validFrames[i];
            dummy.position.set(f.position![0], f.position![1], f.position![2]);

            if (f.rotation && Array.isArray(f.rotation) && f.rotation.length === 4) {
                tempQuat.set(f.rotation[0], f.rotation[1], f.rotation[2], f.rotation[3]);
                dummy.quaternion.copy(tempQuat);
            } else if (f.direction && Array.isArray(f.direction) && f.direction.length === 3) {
                const dir = new THREE.Vector3(f.direction[0], f.direction[1], f.direction[2]);
                if (dir.lengthSq() > 1e-6) {
                    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
                } else {
                    dummy.quaternion.identity();
                }
            } else {
                dummy.quaternion.identity();
            }

            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            instancedMarkers.setMatrixAt(i, dummy.matrix);
        }
        instancedMarkers.instanceMatrix.needsUpdate = true;
        group.add(instancedMarkers);

        // 3. Direction Rays
        let directionLines: THREE.LineSegments | undefined;
        const dirPositions: number[] = [];
        const dirLen = 0.18;

        for (let i = 0; i < validFrames.length; i++) {
            const f = validFrames[i];
            const dir = new THREE.Vector3();

            if (f.direction && Array.isArray(f.direction) && f.direction.length === 3) {
                dir.set(f.direction[0], f.direction[1], f.direction[2]);
            } else if (f.rotation && Array.isArray(f.rotation) && f.rotation.length === 4) {
                tempQuat.set(f.rotation[0], f.rotation[1], f.rotation[2], f.rotation[3]);
                dir.set(0, 0, 1).applyQuaternion(tempQuat);
            } else if (i < validFrames.length - 1) {
                const nextPos = validFrames[i + 1].position!;
                dir.set(nextPos[0] - f.position![0], nextPos[1] - f.position![1], nextPos[2] - f.position![2]);
            }

            if (dir.lengthSq() > 1e-6) {
                dir.normalize();
                const px = f.position![0];
                const py = f.position![1];
                const pz = f.position![2];
                dirPositions.push(px, py, pz, px + dir.x * dirLen, py + dir.y * dirLen, pz + dir.z * dirLen);
            }
        }

        if (dirPositions.length > 0) {
            const dirGeo = new THREE.BufferGeometry();
            dirGeo.setAttribute("position", new THREE.Float32BufferAttribute(dirPositions, 3));
            const dirMat = new THREE.LineBasicMaterial({
                color: 0xfbbf24, // Amber/gold
                transparent: true,
                opacity: 0.75,
                depthTest: true,
            });
            directionLines = new THREE.LineSegments(dirGeo, dirMat);
            directionLines.name = `CameraDirectionLines-${pcId}`;
            group.add(directionLines);
        }

        this.rootGroup.add(group);

        const visual: PointCloudCameraVisual = {
            pcId,
            group,
            trajectoryLine,
            instancedMarkers,
            directionLines,
            frames: validFrames,
            matrixArr,
            center,
        };

        this.visuals.set(pcId, visual);
    }

    private refreshVisualTransform(pcId: string): void {
        const visual = this.visuals.get(pcId);
        if (!visual) return;

        const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog);
        visual.matrixArr = matrixArr;
        visual.center = center;

        if (matrixArr && matrixArr.length === 16) {
            visual.group.matrixAutoUpdate = false;
            visual.group.matrix.fromArray(matrixArr);
        } else {
            visual.group.matrixAutoUpdate = true;
            visual.group.position.set(center[0], center[1], center[2]);
        }
        visual.group.matrixWorldNeedsUpdate = true;
        visual.group.updateMatrixWorld(true);
    }

    /**
     * Updates spatial transformation matrix for a target pointcloud or query ID.
     * Applies identical 4x4 matrix transformation to the camera positions group.
     */
    public updateTargetTransform(id: string, matrixArray: number[]): void {
        const targetKeys = new Set<string>();
        const query = this.queries?.find((q) => q.id === id);

        if (query) {
            const summary = this.summaryMap ? this.summaryMap[id] : undefined;
            if (summary?.connected_pointclouds) {
                for (const pc of summary.connected_pointclouds) {
                    if (pc?.id && isConnectedPointCloudSelected(query, String(pc.id))) {
                        targetKeys.add(String(pc.id));
                    }
                }
            }
            const pcFilter = query.filters?.find((f) => f.field === "pointcloud_id")?.value;
            if (pcFilter && isConnectedPointCloudSelected(query, String(pcFilter))) {
                targetKeys.add(String(pcFilter));
            }
        } else {
            targetKeys.add(id);
        }

        for (const key of targetKeys) {
            const visual = this.visuals.get(key);
            if (visual) {
                visual.matrixArr = matrixArray;
                visual.group.matrixAutoUpdate = false;
                visual.group.matrix.fromArray(matrixArray);
                visual.group.matrixWorldNeedsUpdate = true;
                visual.group.updateMatrixWorld(true);
            }
        }
    }

    /**
     * Per-frame animation / raycasting update.
     */
    public update(camera: THREE.Camera): void {
        this.camera = camera;
        if (!this.camera || !this.domElement || this.visuals.size === 0) return;

        // Perform raycasting for hover tooltip if mouse is within canvas
        if (this.mouse.x > -2 && this.mouse.x < 2 && this.mouse.y > -2 && this.mouse.y < 2) {
            this.raycaster.setFromCamera(this.mouse, this.camera);

            let closestHit: { pcId: string; frame: CameraFrameResponse; index: number; distance: number } | null = null;

            for (const [pcId, visual] of this.visuals.entries()) {
                if (!visual.instancedMarkers) continue;

                const intersects = this.raycaster.intersectObject(visual.instancedMarkers, false);
                if (intersects.length > 0) {
                    const hit = intersects[0];
                    if (hit.instanceId !== undefined && hit.instanceId < visual.frames.length) {
                        if (!closestHit || hit.distance < closestHit.distance) {
                            closestHit = {
                                pcId,
                                frame: visual.frames[hit.instanceId],
                                index: hit.instanceId,
                                distance: hit.distance,
                            };
                        }
                    }
                }
            }

            if (closestHit) {
                this.hoveredItem = { pcId: closestHit.pcId, frame: closestHit.frame, index: closestHit.index };
                if (this.domElement) {
                    this.domElement.style.cursor = "pointer";
                }
                if (this.tooltipElement) {
                    const f = closestHit.frame;
                    const name = f.filename || `Frame #${closestHit.index + 1}`;
                    const time = f.relative_time !== undefined && f.relative_time !== null
                        ? `⏱️ ${Number(f.relative_time).toFixed(2)}s`
                        : `📅 ${new Date(f.timestamp).toLocaleTimeString()}`;
                    const posStr = f.position
                        ? `(${f.position[0].toFixed(1)}, ${f.position[1].toFixed(1)}, ${f.position[2].toFixed(1)})`
                        : "";

                    this.tooltipElement.innerHTML = `
                        <div style="font-weight: 600; color: #38bdf8; margin-bottom: 2px;">📷 ${name}</div>
                        <div style="color: #cbd5e1; font-size: 10px;">${time}</div>
                        <div style="color: #94a3b8; font-size: 9px; margin-top: 2px;">XYZ: ${posStr}</div>
                    `;
                    this.tooltipElement.style.display = "block";
                }
            } else {
                this.clearHover();
            }
        }
    }

    private disposeVisual(visual: PointCloudCameraVisual): void {
        if (visual.trajectoryLine) {
            visual.trajectoryLine.geometry.dispose();
            (visual.trajectoryLine.material as THREE.Material).dispose();
            visual.group.remove(visual.trajectoryLine);
        }
        if (visual.instancedMarkers) {
            visual.instancedMarkers.geometry.dispose();
            (visual.instancedMarkers.material as THREE.Material).dispose();
            visual.group.remove(visual.instancedMarkers);
        }
        if (visual.directionLines) {
            visual.directionLines.geometry.dispose();
            (visual.directionLines.material as THREE.Material).dispose();
            visual.group.remove(visual.directionLines);
        }
        this.rootGroup.remove(visual.group);
    }

    public destroy(): void {
        this.clearHover();

        if (this.domElement && this.boundPointerMove) {
            this.domElement.removeEventListener("pointermove", this.boundPointerMove);
        }
        if (this.domElement && this.boundPointerLeave) {
            this.domElement.removeEventListener("pointerleave", this.boundPointerLeave);
        }
        if (this.domElement && this.boundPointerDown) {
            this.domElement.removeEventListener("pointerdown", this.boundPointerDown);
        }

        if (this.tooltipElement && this.tooltipElement.parentNode) {
            this.tooltipElement.parentNode.removeChild(this.tooltipElement);
            this.tooltipElement = null;
        }

        for (const visual of this.visuals.values()) {
            this.disposeVisual(visual);
        }
        this.visuals.clear();
        this.routesCache.clear();
        this.loadingSet.clear();

        this.scene.remove(this.rootGroup);
    }
}

export const CameraPositionsSystem = CameraPositionSystem;
