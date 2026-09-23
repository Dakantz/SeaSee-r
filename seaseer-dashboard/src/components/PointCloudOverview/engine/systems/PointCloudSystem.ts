import * as THREE from "three";
import type { EngineCallbacks, EngineConfig } from "../types";
import type { CustomQuery, QuerySummaryData } from "../../../PointCloudPanel/CustomQueryManager";
import type { PointCloudMetadataResponse } from "../../../../client";
import type { FilterRule } from "../../../PointCloudPanel/utils/filterUtils";
import { getPointCloudTransform } from "../../../PointCloudPanel/utils/pointCloudTransform";
import {
    DynamicLODController,
    type Bounds3D,
    type PointCloudTarget,
} from "./DynamicLODController";

export class PointCloudSystem {
    private scene: THREE.Scene;
    private callbacks: EngineCallbacks;
    private rootGroup: THREE.Group;
    private dynamicLodController: DynamicLODController;

    private queries: CustomQuery[] = [];
    private summaryMap: Record<string, QuerySummaryData> = {};
    private catalog: PointCloudMetadataResponse[] = [];

    constructor(scene: THREE.Scene, callbacks: EngineCallbacks = {}, config: Partial<EngineConfig> = {}) {
        this.scene = scene;
        this.callbacks = callbacks;

        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "PointCloudSystemGroup";
        this.scene.add(this.rootGroup);

        this.dynamicLodController = new DynamicLODController(
            this.rootGroup,
            this.callbacks,
            {
                distanceFactor: 1.0,
                switchDistanceFactor: 1.0,
            }
        );

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

    private getTargetBounds(pcId: string): Bounds3D {
        // 1. Check summaryMap connected_pointclouds
        if (this.summaryMap) {
            for (const summary of Object.values(this.summaryMap)) {
                if (summary?.connected_pointclouds) {
                    const match = summary.connected_pointclouds.find(
                        (p) => p && String(p.id) === pcId
                    );
                    if (
                        match &&
                        match.min_x != null &&
                        match.max_x != null &&
                        match.min_y != null &&
                        match.max_y != null &&
                        match.min_z != null &&
                        match.max_z != null
                    ) {
                        return {
                            minX: Number(match.min_x),
                            maxX: Number(match.max_x),
                            minY: Number(match.min_y),
                            maxY: Number(match.max_y),
                            minZ: Number(match.min_z),
                            maxZ: Number(match.max_z),
                        };
                    }
                }
                if (
                    summary?.bounding_box &&
                    summary.bounding_box.min_x != null &&
                    summary.bounding_box.max_x != null &&
                    summary.bounding_box.min_y != null &&
                    summary.bounding_box.max_y != null &&
                    summary.bounding_box.min_z != null &&
                    summary.bounding_box.max_z != null
                ) {
                    const bbox = summary.bounding_box;
                    return {
                        minX: Number(bbox.min_x),
                        maxX: Number(bbox.max_x),
                        minY: Number(bbox.min_y),
                        maxY: Number(bbox.max_y),
                        minZ: Number(bbox.min_z),
                        maxZ: Number(bbox.max_z),
                    };
                }
            }
        }

        // 2. Check catalog
        if (this.catalog) {
            const match = this.catalog.find((c) => c && String(c.id) === pcId);
            if (
                match &&
                match.min_x != null &&
                match.max_x != null &&
                match.min_y != null &&
                match.max_y != null &&
                match.min_z != null &&
                match.max_z != null
            ) {
                return {
                    minX: Number(match.min_x),
                    maxX: Number(match.max_x),
                    minY: Number(match.min_y),
                    maxY: Number(match.max_y),
                    minZ: Number(match.min_z),
                    maxZ: Number(match.max_z),
                };
            }
        }

        // 3. Sensible default fallback bounds if not yet loaded in metadata
        return {
            minX: -50,
            maxX: 50,
            minY: -50,
            maxY: 50,
            minZ: -20,
            maxZ: 20,
        };
    }

    private syncPointClouds(): void {
        const targets: PointCloudTarget[] = [];
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
                                    (f) => !["min_x", "max_x", "min_y", "max_y", "min_z", "max_z"].includes(f.field)
                                )
                                : [];
                            const hasPcFilter = baseFilters.some(
                                (f) => f.field === "pointcloud_id" && String(f.value) === pcId
                            );
                            const cleanFilters: FilterRule[] = hasPcFilter
                                ? baseFilters
                                : [
                                    ...baseFilters,
                                    { id: `filter-pc-${pcId}`, field: "pointcloud_id", operator: "eq", value: pcId },
                                ];

                            const bounds = this.getTargetBounds(pcId);
                            const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog);

                            targets.push({
                                key,
                                pcId,
                                filters: cleanFilters,
                                bounds,
                                matrixArr,
                                center,
                            });
                        }
                    }
                } else if (query.filters && query.filters.length > 0) {
                    const pcFilter = query.filters.find(
                        (f) => f.field === "pointcloud_id" && (f.operator === "eq" || !f.operator)
                    );
                    if (pcFilter && pcFilter.value) {
                        const pcId = String(pcFilter.value);
                        const key = pcId;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            const cleanFilters: FilterRule[] = query.filters.filter(
                                (f) => !["min_x", "max_x", "min_y", "max_y", "min_z", "max_z"].includes(f.field)
                            );
                            const bounds = this.getTargetBounds(pcId);
                            const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog);

                            targets.push({
                                key,
                                pcId,
                                filters: cleanFilters,
                                bounds,
                                matrixArr,
                                center,
                            });
                        }
                    }
                }
            }
        }

        this.dynamicLodController.syncTargets(targets);
    }

    public update(camera: THREE.Camera): void {
        this.dynamicLodController.update(camera);
    }

    public getTotalPointCount(): number {
        return this.dynamicLodController.getTotalPointCount();
    }

    public destroy(): void {
        this.dynamicLodController.destroy();
        this.scene.remove(this.rootGroup);
    }
}
