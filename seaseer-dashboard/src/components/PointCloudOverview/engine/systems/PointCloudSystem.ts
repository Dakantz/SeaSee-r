import * as THREE from "three";
import type { EngineCallbacks, EngineConfig } from "../types";
import { loadProgressivePointCloud } from "../../../PointCloudPanel/utils/pointCloudLoader";
import { getPointCloudTransform } from "../../../PointCloudPanel/utils/pointCloudTransform";

interface LoadedPointCloud {
    group: THREE.Group;
    pointsMesh: THREE.Points;
    abortController: AbortController;
    pcId: string;
}

export class PointCloudSystem {
    private scene: THREE.Scene;
    private callbacks: EngineCallbacks;
    private rootGroup: THREE.Group;

    private loadedPointClouds: Map<string, LoadedPointCloud> = new Map();
    private queries: any[] = [];
    private summaryMap: Record<string, any> = {};
    private catalog: any[] = [];

    constructor(scene: THREE.Scene, callbacks: EngineCallbacks = {}, config: Partial<EngineConfig> = {}) {
        this.scene = scene;
        this.callbacks = callbacks;

        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "PointCloudSystemGroup";
        this.scene.add(this.rootGroup);

        this.updateConfig(config);
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
            this.syncPointClouds();
        }
    }

    private syncPointClouds(): void {
        const targets: Array<{ key: string; pcId: string; filters?: any[] }> = [];
        const seenKeys = new Set<string>();

        if (this.queries && this.queries.length > 0) {
            for (const query of this.queries) {
                const qId = query.id;
                if (!qId) continue;

                const summary = this.summaryMap ? this.summaryMap[qId] : undefined;
                if (summary?.connected_pointclouds && summary.connected_pointclouds.length > 0) {
                    for (const pc of summary.connected_pointclouds) {
                        if (!pc.id) continue;
                        const pcId = String(pc.id);
                        const key = pcId;

                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);

                            const baseFilters = query.filters
                                ? query.filters.filter(
                                    (f: any) => !["min_x", "max_x", "min_y", "max_y", "min_z", "max_z"].includes(f.field)
                                )
                                : [];
                            const hasPcFilter = baseFilters.some(
                                (f: any) => f.field === "pointcloud_id" && String(f.value) === pcId
                            );
                            const cleanFilters = hasPcFilter
                                ? baseFilters
                                : [
                                    ...baseFilters,
                                    { id: `filter-pc-${pcId}`, field: "pointcloud_id", operator: "eq", value: pcId },
                                ];

                            targets.push({ key, pcId, filters: cleanFilters });
                        }
                    }
                } else if (query.filters && query.filters.length > 0) {
                    const pcFilter = query.filters.find(
                        (f: any) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
                    );
                    if (pcFilter && pcFilter.value) {
                        const pcId = String(pcFilter.value);
                        const key = pcId;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            const cleanFilters = query.filters.filter(
                                (f: any) => !["min_x", "max_x", "min_y", "max_y", "min_z", "max_z"].includes(f.field)
                            );
                            targets.push({ key, pcId, filters: cleanFilters });
                        }
                    }
                }
            }
        }

        const targetKeySet = new Set(targets.map((t) => t.key));
        for (const [key] of this.loadedPointClouds.entries()) {
            if (!targetKeySet.has(key)) {
                this.removePointCloud(key);
            }
        }

        for (const target of targets) {
            if (!this.loadedPointClouds.has(target.key)) {
                this.loadPointCloud(target);
            } else {
                this.updatePointCloudTransform(target.key, target.pcId);
            }
        }
    }

    private loadPointCloud(target: { key: string; pcId: string; filters?: any[] }): void {
        const group = new THREE.Group();
        group.name = `PointCloudGroup_${target.key}`;

        const material = new THREE.PointsMaterial({
            size: 2.0,
            vertexColors: true,
            sizeAttenuation: false,
        });

        const pointsMesh = new THREE.Points(new THREE.BufferGeometry(), material);
        group.add(pointsMesh);
        this.rootGroup.add(group);

        this.updateGroupTransform(group, target.pcId);

        const abortController = new AbortController();

        this.loadedPointClouds.set(target.key, {
            group,
            pointsMesh,
            abortController,
            pcId: target.pcId,
        });

        loadProgressivePointCloud({
            id: target.pcId,
            startLod: 10,
            endLod: 0,
            filters: target.filters,
            signal: abortController.signal,
            onLodLoaded: (_lod: number, geometry: THREE.BufferGeometry) => {
                if (!this.loadedPointClouds.has(target.key)) {
                    geometry.dispose();
                    return;
                }
                const oldGeom = pointsMesh.geometry;
                pointsMesh.geometry = geometry;
                if (oldGeom && oldGeom !== geometry) {
                    oldGeom.dispose();
                }
                this.notifyPointCount();
            },
            onError: (lod: number, err: unknown) => {
                console.warn(`[PointCloudSystem] Failed to load LOD ${lod} for ${target.key}:`, err);
            },
        });
    }

    private updatePointCloudTransform(key: string, pcId: string): void {
        const loaded = this.loadedPointClouds.get(key);
        if (loaded) {
            this.updateGroupTransform(loaded.group, pcId);
        }
    }

    private updateGroupTransform(group: THREE.Group, pcId: string): void {
        const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog);
        if (matrixArr && matrixArr.length === 16) {
            const matWorld = new THREE.Matrix4().fromArray(matrixArr);
            group.matrixAutoUpdate = false;
            group.matrix.copy(matWorld);
        } else if (center) {
            group.matrixAutoUpdate = true;
            group.position.set(center[0], center[1], center[2]);
        }
    }

    private notifyPointCount(): void {
        let totalCount = 0;
        for (const loaded of this.loadedPointClouds.values()) {
            const posAttr = loaded.pointsMesh.geometry?.getAttribute("position");
            if (posAttr) {
                totalCount += posAttr.count;
            }
        }
        this.callbacks.onPointCountChange?.(totalCount);
    }

    private removePointCloud(key: string): void {
        const loaded = this.loadedPointClouds.get(key);
        if (loaded) {
            loaded.abortController.abort();
            if (loaded.pointsMesh.geometry) {
                loaded.pointsMesh.geometry.dispose();
            }
            if (loaded.pointsMesh.material) {
                (loaded.pointsMesh.material as THREE.Material).dispose();
            }
            this.rootGroup.remove(loaded.group);
            this.loadedPointClouds.delete(key);
            this.notifyPointCount();
        }
    }

    public destroy(): void {
        for (const key of Array.from(this.loadedPointClouds.keys())) {
            this.removePointCloud(key);
        }
        this.scene.remove(this.rootGroup);
    }
}
