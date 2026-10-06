import * as THREE from "three";
import type { EngineCallbacks, EngineConfig } from "../types";
import type { CustomQuery, QuerySummaryData, ConnectedPointCloudMetadata } from "../../../PointCloudPanel/CustomQueryManager";
import { isConnectedPointCloudSelected } from "../../../PointCloudPanel/CustomQueryManager";
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
    private showOutlines: boolean = false;
    private disableDynamicLOD: boolean = false;
    private editingPointcloudId: string | null = null;

    constructor(scene: THREE.Scene, callbacks: EngineCallbacks = {}, config: Partial<EngineConfig> = {}) {
        this.scene = scene;
        this.callbacks = callbacks;
        this.showOutlines = !!config.showOutlines;
        this.disableDynamicLOD = !!config.disableDynamicLOD;
        if (config.editingPointcloudId !== undefined) {
            this.editingPointcloudId = config.editingPointcloudId;
        }

        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "PointCloudSystemGroup";
        this.scene.add(this.rootGroup);

        this.dynamicLodController = new DynamicLODController(
            this.rootGroup,
            this.callbacks,
            {
                distanceFactor: 1.0,
                switchDistanceFactor: 1.0,
                showOutlines: this.showOutlines,
                disableDynamicLOD: this.disableDynamicLOD,
            }
        );

        this.updateConfig(config);
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        let dirty = false;

        if (config.showOutlines !== undefined && config.showOutlines !== this.showOutlines) {
            this.showOutlines = config.showOutlines;
            this.dynamicLodController.setShowOutlines(this.showOutlines);
        }

        if (config.disableDynamicLOD !== undefined && config.disableDynamicLOD !== this.disableDynamicLOD) {
            this.disableDynamicLOD = config.disableDynamicLOD;
            this.dynamicLodController.setDisableDynamicLOD(this.disableDynamicLOD);
        }

        if (config.editingPointcloudId !== undefined && config.editingPointcloudId !== this.editingPointcloudId) {
            this.editingPointcloudId = config.editingPointcloudId;
            dirty = true;
        }

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

    private getTargetBounds(
        pcId: string,
        query?: CustomQuery,
        pcMeta?: ConnectedPointCloudMetadata
    ): Bounds3D {
        const hasValidBounds = (b: {
            min_x?: number | null;
            max_x?: number | null;
            min_y?: number | null;
            max_y?: number | null;
            min_z?: number | null;
            max_z?: number | null;
        } | null | undefined): boolean => {
            return (
                b != null &&
                b.min_x != null &&
                b.max_x != null &&
                b.min_y != null &&
                b.max_y != null &&
                b.min_z != null &&
                b.max_z != null
            );
        };

        const toBounds3D = (b: {
            min_x?: number | null;
            max_x?: number | null;
            min_y?: number | null;
            max_y?: number | null;
            min_z?: number | null;
            max_z?: number | null;
        }): Bounds3D => ({
            minX: Number(b.min_x),
            maxX: Number(b.max_x),
            minY: Number(b.min_y),
            maxY: Number(b.max_y),
            minZ: Number(b.min_z),
            maxZ: Number(b.max_z),
        });

        // 1. Direct metadata passed for this specific point cloud
        if (hasValidBounds(pcMeta)) {
            return toBounds3D(pcMeta!);
        }

        // 2. Check query's own summary for a connected pointcloud matching pcId
        const qSummary = query
            ? (this.summaryMap && query.id ? this.summaryMap[query.id] : undefined) || query.summary
            : undefined;

        if (qSummary?.connected_pointclouds) {
            const match = qSummary.connected_pointclouds.find(
                (p) => p && String(p.id) === pcId
            );
            if (hasValidBounds(match)) {
                return toBounds3D(match!);
            }
        }

        // 3. Check catalog for pcId metadata
        if (this.catalog) {
            const match = this.catalog.find((c) => c && String(c.id) === pcId);
            if (hasValidBounds(match)) {
                return toBounds3D(match!);
            }
        }

        // 4. Check all summaries across summaryMap for connected_pointclouds matching pcId
        if (this.summaryMap) {
            for (const summary of Object.values(this.summaryMap)) {
                if (summary?.connected_pointclouds) {
                    const match = summary.connected_pointclouds.find(
                        (p) => p && String(p.id) === pcId
                    );
                    if (hasValidBounds(match)) {
                        return toBounds3D(match!);
                    }
                }
            }
        }

        // 5. If this dataset belongs specifically to `query` (single-dataset query or pcFilter matches)
        // and that query has a bounding_box in its own summary, use that query's bounding box
        if (qSummary && hasValidBounds(qSummary.bounding_box)) {
            const isSinglePcQuery =
                (qSummary.connected_pointclouds && qSummary.connected_pointclouds.length === 1 && String(qSummary.connected_pointclouds[0].id) === pcId) ||
                query?.filters?.some((f) => f.field === "pointcloud_id" && String(f.value) === pcId) ||
                (!qSummary.connected_pointclouds || qSummary.connected_pointclouds.length === 0);

            if (isSinglePcQuery) {
                return toBounds3D(qSummary.bounding_box!);
            }
        }

        // 6. Look for any query in this.queries specifically targeting pcId and check its bounding_box
        if (this.queries) {
            for (const q of this.queries) {
                const s = (this.summaryMap && q.id ? this.summaryMap[q.id] : undefined) || q.summary;
                if (s && hasValidBounds(s.bounding_box)) {
                    const matchesPc =
                        q.filters?.some((f) => f.field === "pointcloud_id" && String(f.value) === pcId) ||
                        (s.connected_pointclouds && s.connected_pointclouds.length === 1 && String(s.connected_pointclouds[0].id) === pcId);
                    if (matchesPc) {
                        return toBounds3D(s.bounding_box!);
                    }
                }
            }
        }

        // 7. Sensible default fallback bounds if not yet loaded in metadata
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

                const summary = (this.summaryMap ? this.summaryMap[qId] : undefined) || query.summary;
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

                            const bounds = this.getTargetBounds(pcId, query, pc);
                            const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog, query);

                            targets.push({
                                key,
                                pcId,
                                query,
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
                            const bounds = this.getTargetBounds(pcId, query);
                            const { matrixArr, center } = getPointCloudTransform(pcId, this.summaryMap, this.catalog, query);

                            targets.push({
                                key,
                                pcId,
                                query,
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

        this.dynamicLodController.syncTargets(targets, this.queries);
    }

    public update(camera: THREE.Camera): void {
        this.dynamicLodController.update(camera);
    }

    public getTotalPointCount(): number {
        return this.dynamicLodController.getTotalPointCount();
    }

    public setShowOutlines(show: boolean): void {
        if (this.showOutlines !== show) {
            this.showOutlines = show;
            this.dynamicLodController.setShowOutlines(show);
        }
    }

    public setDisableDynamicLOD(disable: boolean): void {
        if (this.disableDynamicLOD !== disable) {
            this.disableDynamicLOD = disable;
            this.dynamicLodController.setDisableDynamicLOD(disable);
        }
    }

    public updateTargetTransform(id: string, matrixArray: number[]): void {
        const targetKeys = new Set<string>();

        const query = this.queries?.find((q) => q.id === id);

        // 1. If id is query ID, resolve ONLY selected connected pointclouds
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
            // Direct pointcloud ID: check if it belongs to any query where it is selected
            let isAllowed = true;
            if (this.queries && this.queries.length > 0) {
                for (const q of this.queries) {
                    const summary = this.summaryMap ? this.summaryMap[q.id] : undefined;
                    const isConnected = summary?.connected_pointclouds?.some((pc) => pc && String(pc.id) === id);
                    const isFiltered = q.filters?.some((f) => f.field === "pointcloud_id" && String(f.value) === id);
                    if (isConnected || isFiltered) {
                        if (!isConnectedPointCloudSelected(q, id)) {
                            isAllowed = false;
                            break;
                        }
                    }
                }
            }
            if (isAllowed) {
                targetKeys.add(id);
            }
        }

        // Update targets in dynamicLodController
        for (const key of targetKeys) {
            this.dynamicLodController.updateTargetTransform(key, matrixArray);
        }
    }

    public destroy(): void {
        this.dynamicLodController.destroy();
        this.scene.remove(this.rootGroup);
    }
}
