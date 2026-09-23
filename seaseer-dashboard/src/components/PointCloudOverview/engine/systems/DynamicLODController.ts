import * as THREE from "three";
import type { EngineCallbacks } from "../types";
import { fetchBinaryGeometry } from "../../../PointCloudPanel/utils/pointCloudLoader";
import type { FilterRule } from "../../../PointCloudPanel/utils/filterUtils";

export interface Bounds3D {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
}

export interface DynamicLODConfig {
    maxLOD: number;
    /** Split distance multiplier for octree subdivision (default: 1.0) */
    distanceFactor: number;
    /** Multiplier for switching between Whole Domain and Octree (default: 1.0) */
    switchDistanceFactor: number;
    maxConcurrentFetches: number;
    movementThresholdSq: number;
    showOutlines?: boolean;
}

export function getLodColor(lod: number): string {
    const colors: Record<number, string> = {
        0: "#ff0055", // Red/Pink (LOD 0 - highest detail)
        1: "#ffaa00", // Orange (LOD 1)
        2: "#ffff00", // Yellow (LOD 2)
        3: "#00ff66", // Bright Green (LOD 3)
        4: "#00ffff", // Cyan (LOD 4)
        5: "#0088ff", // Blue (LOD 5)
        6: "#aa00ff", // Purple (LOD 6)
        7: "#ff00aa", // Magenta (LOD 7)
        8: "#888888", // Gray (LOD 8)
        9: "#ffffff", // White (LOD 9)
        10: "#445566", // Slate (LOD 10 - Global)
    };
    return colors[lod] || "#ffffff";
}

export interface PointCloudTarget {
    key: string;
    pcId: string;
    filters?: FilterRule[];
    bounds: Bounds3D;
    matrixArr?: number[];
    center: [number, number, number];
}

interface OctreeNode {
    id: string;
    depth: number;
    lod: number;
    bounds: Bounds3D;
    center: THREE.Vector3;
    size: number;
    worldBox: THREE.Box3;
    children: OctreeNode[];
    parent: OctreeNode | null;
    isLeaf: boolean;
}

interface LoadedChunk {
    key: string;
    lod: number;
    bounds: Bounds3D;
    geometry?: THREE.BufferGeometry;
    mesh?: THREE.Points;
    outlineMesh?: THREE.LineSegments;
    status: "loading" | "loaded" | "empty";
    abortController?: AbortController;
}

interface FetchTask {
    key: string;
    pcId: string;
    lod: number;
    bounds: Bounds3D;
    filters: FilterRule[];
    distSq: number;
    isWholeDomain: boolean;
    targetKey: string;
}

/**
 * Manages 3D Hybrid Octree / Whole Domain Level of Detail for an individual pointcloud target.
 */
class TargetLODManager {
    public target: PointCloudTarget;
    public group: THREE.Group;
    private config: DynamicLODConfig;
    private showOutlines: boolean = false;

    private domainBounds: Bounds3D;
    private domainCenter: THREE.Vector3;
    private domainMetric: number;
    private switchingThreshold: number;

    private insideMaxDepth: number;
    private outsideLevelsCount: number;

    private isCurrentlyInside: boolean | null = null;
    private wholeDomainChunk: LoadedChunk | null = null;
    private octreeRoot: OctreeNode;

    private loadedChunks: Map<string, LoadedChunk> = new Map();
    private worldTransformMatrix: THREE.Matrix4 = new THREE.Matrix4();
    private invWorldTransformMatrix: THREE.Matrix4 = new THREE.Matrix4();

    constructor(
        target: PointCloudTarget,
        parentGroup: THREE.Group,
        config: DynamicLODConfig,
        showOutlines: boolean = false
    ) {
        this.target = target;
        this.config = config;
        this.showOutlines = showOutlines;

        this.group = new THREE.Group();
        this.group.name = `PointCloudGroup_${target.key}`;
        parentGroup.add(this.group);

        this.updateTransform(target);

        this.domainBounds = { ...target.bounds };
        const dx = this.domainBounds.maxX - this.domainBounds.minX;
        const dy = this.domainBounds.maxY - this.domainBounds.minY;
        const dz = this.domainBounds.maxZ - this.domainBounds.minZ;

        this.domainCenter = new THREE.Vector3(
            this.domainBounds.minX + dx / 2,
            this.domainBounds.minY + dy / 2,
            this.domainBounds.minZ + dz / 2
        );
        this.domainMetric = Math.max(1.0, Math.sqrt(dx * dx + dy * dy + dz * dz));
        this.switchingThreshold = this.domainMetric * this.config.switchDistanceFactor;

        // Partition LODs: inside gets [0..insideMaxDepth], outside gets [(insideMaxDepth+1)..maxLOD]
        this.insideMaxDepth = Math.min(5, Math.floor(this.config.maxLOD / 2) + 1);
        this.outsideLevelsCount = Math.max(1, this.config.maxLOD - this.insideMaxDepth + 1);

        this.octreeRoot = this.createOctreeNode(0, this.domainBounds, null);
    }

    public updateTransform(target: PointCloudTarget): void {
        this.target = target;
        if (target.matrixArr && target.matrixArr.length === 16) {
            this.worldTransformMatrix.fromArray(target.matrixArr);
            this.invWorldTransformMatrix.copy(this.worldTransformMatrix).invert();
            this.group.matrixAutoUpdate = false;
            this.group.matrix.copy(this.worldTransformMatrix);
        } else {
            this.group.matrixAutoUpdate = true;
            this.group.position.set(target.center[0], target.center[1], target.center[2]);
            this.worldTransformMatrix.makeTranslation(target.center[0], target.center[1], target.center[2]);
            this.invWorldTransformMatrix.copy(this.worldTransformMatrix).invert();
        }
        this.group.matrixWorldNeedsUpdate = true;
        this.group.updateMatrixWorld(true);

        if (this.octreeRoot) {
            this.updateOctreeWorldBoxes(this.octreeRoot);
        }
    }

    public updateTransformMatrix(matrixArr: number[]): void {
        this.target.matrixArr = matrixArr;
        this.worldTransformMatrix.fromArray(matrixArr);
        this.invWorldTransformMatrix.copy(this.worldTransformMatrix).invert();
        this.group.matrixAutoUpdate = false;
        this.group.matrix.copy(this.worldTransformMatrix);
        this.group.matrixWorldNeedsUpdate = true;
        this.group.updateMatrixWorld(true);

        if (this.octreeRoot) {
            this.updateOctreeWorldBoxes(this.octreeRoot);
        }
    }

    private updateOctreeWorldBoxes(node: OctreeNode): void {
        const localBox = new THREE.Box3(
            new THREE.Vector3(node.bounds.minX, node.bounds.minY, node.bounds.minZ),
            new THREE.Vector3(node.bounds.maxX, node.bounds.maxY, node.bounds.maxZ)
        );
        node.worldBox.copy(localBox).applyMatrix4(this.worldTransformMatrix);
        for (const child of node.children) {
            this.updateOctreeWorldBoxes(child);
        }
    }

    private createOctreeNode(depth: number, bounds: Bounds3D, parent: OctreeNode | null): OctreeNode {
        const dx = bounds.maxX - bounds.minX;
        const dy = bounds.maxY - bounds.minY;
        const dz = bounds.maxZ - bounds.minZ;
        const center = new THREE.Vector3(
            bounds.minX + dx / 2,
            bounds.minY + dy / 2,
            bounds.minZ + dz / 2
        );
        const size = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const lod = Math.max(0, this.insideMaxDepth - depth);

        // Compute AABB in world coordinates for frustum culling
        const localBox = new THREE.Box3(
            new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ),
            new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ)
        );
        const worldBox = localBox.clone().applyMatrix4(this.worldTransformMatrix);

        return {
            id: `${this.target.key}_d${depth}_lod${lod}_${center.x.toFixed(1)}_${center.y.toFixed(1)}_${center.z.toFixed(1)}`,
            depth,
            lod,
            bounds: { ...bounds },
            center,
            size,
            worldBox,
            children: [],
            parent,
            isLeaf: true,
        };
    }

    private splitOctreeNode(node: OctreeNode): void {
        const { minX, maxX, minY, maxY, minZ, maxZ } = node.bounds;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const midZ = (minZ + maxZ) / 2;
        const nextDepth = node.depth + 1;

        node.children = [
            // Bottom 4 octants (Z: minZ -> midZ)
            this.createOctreeNode(nextDepth, { minX, maxX: midX, minY, maxY: midY, minZ, maxZ: midZ }, node),
            this.createOctreeNode(nextDepth, { minX: midX, maxX, minY, maxY: midY, minZ, maxZ: midZ }, node),
            this.createOctreeNode(nextDepth, { minX, maxX: midX, minY: midY, maxY, minZ, maxZ: midZ }, node),
            this.createOctreeNode(nextDepth, { minX: midX, maxX, minY: midY, maxY, minZ, maxZ: midZ }, node),
            // Top 4 octants (Z: midZ -> maxZ)
            this.createOctreeNode(nextDepth, { minX, maxX: midX, minY, maxY: midY, minZ: midZ, maxZ }, node),
            this.createOctreeNode(nextDepth, { minX: midX, maxX, minY, maxY: midY, minZ: midZ, maxZ }, node),
            this.createOctreeNode(nextDepth, { minX, maxX: midX, minY: midY, maxY, minZ: midZ, maxZ }, node),
            this.createOctreeNode(nextDepth, { minX: midX, maxX, minY: midY, maxY, minZ: midZ, maxZ }, node),
        ];
        node.isLeaf = false;
    }

    /**
     * Evaluates LOD requirements for this target based on camera position and frustum.
     * Populates newActiveKeys and collects tasks to queue.
     */
    public evaluate(
        camera: THREE.Camera,
        frustum: THREE.Frustum,
        newActiveKeys: Set<string>,
        tasksToQueue: FetchTask[]
    ): void {
        // Transform camera position into local pointcloud coordinate space
        const localCamPos = camera.position.clone().applyMatrix4(this.invWorldTransformMatrix);
        const distToCenter = localCamPos.distanceTo(this.domainCenter);

        // Hysteresis threshold to prevent thrashing at the boundary
        const hysteresis = 0.05;
        let isInside = this.isCurrentlyInside ?? false;

        if (distToCenter <= this.switchingThreshold * (1.0 - hysteresis)) {
            isInside = true;
        } else if (distToCenter > this.switchingThreshold * (1.0 + hysteresis)) {
            isInside = false;
        }
        this.isCurrentlyInside = isInside;

        if (isInside) {
            // ==========================================
            // INSIDE REGIME: 3D OCTREE SPATIAL REFINEMENT
            // ==========================================
            if (this.wholeDomainChunk) {
                this.disposeChunk(this.wholeDomainChunk);
                this.wholeDomainChunk = null;
            }

            const activeLeaves: OctreeNode[] = [];
            const nodesToPrune: OctreeNode[] = [];

            this.evaluateOctreeNode(this.octreeRoot, localCamPos, frustum, activeLeaves, nodesToPrune);

            // Prune unneeded subtrees
            for (const prunedNode of nodesToPrune) {
                this.evictOctreeSubtree(prunedNode);
            }

            // Sync active leaf chunks
            for (const leaf of activeLeaves) {
                const chunkKey = leaf.id;
                newActiveKeys.add(chunkKey);

                const existing = this.loadedChunks.get(chunkKey);
                if (!existing) {
                    const distSq = localCamPos.distanceToSquared(leaf.center);
                    const baseFilters = this.target.filters || [];
                    const spatialFilters: FilterRule[] = [
                        ...baseFilters,
                        { id: `min_x_${leaf.id}`, field: "min_x", operator: "gte", value: leaf.bounds.minX },
                        { id: `max_x_${leaf.id}`, field: "max_x", operator: "lte", value: leaf.bounds.maxX },
                        { id: `min_y_${leaf.id}`, field: "min_y", operator: "gte", value: leaf.bounds.minY },
                        { id: `max_y_${leaf.id}`, field: "max_y", operator: "lte", value: leaf.bounds.maxY },
                        { id: `min_z_${leaf.id}`, field: "min_z", operator: "gte", value: leaf.bounds.minZ },
                        { id: `max_z_${leaf.id}`, field: "max_z", operator: "lte", value: leaf.bounds.maxZ },
                    ];

                    tasksToQueue.push({
                        key: chunkKey,
                        pcId: this.target.pcId,
                        lod: leaf.lod,
                        bounds: { ...leaf.bounds },
                        filters: spatialFilters,
                        distSq,
                        isWholeDomain: false,
                        targetKey: this.target.key,
                    });
                }
            }
        } else {
            // ==========================================
            // OUTSIDE REGIME: WHOLE DOMAIN MACRO CHUNK
            // ==========================================
            if (!this.octreeRoot.isLeaf || this.loadedChunks.size > 0) {
                this.evictOctreeSubtree(this.octreeRoot);
                this.octreeRoot = this.createOctreeNode(0, this.domainBounds, null);
            }

            // Determine outside coarse LOD from distance
            const targetLod = this.calculateOutsideLod(distToCenter);
            const wholeDomainKey = `${this.target.key}_whole_domain_lod${targetLod}`;
            newActiveKeys.add(wholeDomainKey);

            if (!this.wholeDomainChunk || this.wholeDomainChunk.lod !== targetLod) {
                if (this.wholeDomainChunk) {
                    this.disposeChunk(this.wholeDomainChunk);
                    this.wholeDomainChunk = null;
                }

                const existing = this.loadedChunks.get(wholeDomainKey);
                if (!existing) {
                    tasksToQueue.push({
                        key: wholeDomainKey,
                        pcId: this.target.pcId,
                        lod: targetLod,
                        bounds: { ...this.domainBounds },
                        filters: this.target.filters || [],
                        distSq: distToCenter * distToCenter,
                        isWholeDomain: true,
                        targetKey: this.target.key,
                    });
                }
            }
        }
    }

    private evaluateOctreeNode(
        node: OctreeNode,
        localCamPos: THREE.Vector3,
        frustum: THREE.Frustum,
        activeLeaves: OctreeNode[],
        nodesToPrune: OctreeNode[]
    ): void {
        // 3D View Frustum Culling
        if (!frustum.intersectsBox(node.worldBox)) {
            if (!node.isLeaf) {
                for (const child of node.children) {
                    nodesToPrune.push(child);
                }
                node.children = [];
                node.isLeaf = true;
            }
            return;
        }

        const dist = localCamPos.distanceTo(node.center);
        const splitThreshold = node.size * this.config.distanceFactor;
        const shouldSplit = node.depth < this.insideMaxDepth && dist < splitThreshold;

        if (shouldSplit) {
            // If this node previously held a loaded mesh, dispose it so children render
            const existing = this.loadedChunks.get(node.id);
            if (existing) {
                this.disposeChunk(existing);
                this.loadedChunks.delete(node.id);
            }

            if (node.isLeaf) {
                this.splitOctreeNode(node);
            }

            for (const child of node.children) {
                this.evaluateOctreeNode(child, localCamPos, frustum, activeLeaves, nodesToPrune);
            }
        } else {
            // Collapse any existing children into this leaf
            if (!node.isLeaf) {
                for (const child of node.children) {
                    nodesToPrune.push(child);
                }
                node.children = [];
                node.isLeaf = true;
            }
            activeLeaves.push(node);
        }
    }

    private calculateOutsideLod(distToCenter: number): number {
        const switchMetric = this.switchingThreshold;
        for (let k = 0; k < this.outsideLevelsCount - 1; k++) {
            const threshold = switchMetric * Math.pow(2, k + 1);
            if (distToCenter <= threshold) {
                return this.insideMaxDepth + k;
            }
        }
        return this.config.maxLOD;
    }

    public registerLoadingChunk(
        key: string,
        lod: number,
        bounds: Bounds3D,
        abortController: AbortController
    ): void {
        const chunk: LoadedChunk = {
            key,
            lod,
            bounds: { ...bounds },
            status: "loading",
            abortController,
        };
        this.loadedChunks.set(key, chunk);
        if (key.includes("whole_domain")) {
            this.wholeDomainChunk = chunk;
        }
    }

    public onChunkLoaded(key: string, geometry: THREE.BufferGeometry): void {
        const chunk = this.loadedChunks.get(key);
        if (!chunk) {
            geometry.dispose();
            return;
        }

        const material = new THREE.PointsMaterial({
            size: 2.0,
            vertexColors: true,
            sizeAttenuation: false,
        });

        const pointsMesh = new THREE.Points(geometry, material);
        chunk.geometry = geometry;
        chunk.mesh = pointsMesh;
        chunk.status = "loaded";
        chunk.abortController = undefined;

        this.group.add(pointsMesh);

        if (this.showOutlines) {
            this.createChunkOutline(chunk);
        }

        if (key.includes("whole_domain")) {
            this.wholeDomainChunk = chunk;
        }
    }

    private createChunkOutline(chunk: LoadedChunk): void {
        if (chunk.outlineMesh) return;
        const bounds = chunk.bounds;
        if (!bounds) return;

        const width = Math.max(0.001, bounds.maxX - bounds.minX);
        const height = Math.max(0.001, bounds.maxY - bounds.minY);
        const depth = Math.max(0.001, bounds.maxZ - bounds.minZ);

        const boxGeom = new THREE.BoxGeometry(width, height, depth);
        const edgesGeom = new THREE.EdgesGeometry(boxGeom);
        boxGeom.dispose();

        const color = getLodColor(chunk.lod);
        const lineMat = new THREE.LineBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.8,
            depthTest: true,
            depthWrite: false,
        });

        const outlineMesh = new THREE.LineSegments(edgesGeom, lineMat);
        outlineMesh.name = `ChunkOutline_${chunk.key}`;
        outlineMesh.position.set(
            (bounds.minX + bounds.maxX) / 2,
            (bounds.minY + bounds.maxY) / 2,
            (bounds.minZ + bounds.maxZ) / 2
        );

        chunk.outlineMesh = outlineMesh;
        this.group.add(outlineMesh);
    }

    public setShowOutlines(show: boolean): void {
        this.showOutlines = show;
        for (const chunk of this.loadedChunks.values()) {
            if (chunk.status === "loaded") {
                if (show) {
                    if (!chunk.outlineMesh) {
                        this.createChunkOutline(chunk);
                    } else {
                        chunk.outlineMesh.visible = true;
                    }
                } else {
                    if (chunk.outlineMesh) {
                        this.group.remove(chunk.outlineMesh);
                        chunk.outlineMesh.geometry.dispose();
                        if (Array.isArray(chunk.outlineMesh.material)) {
                            chunk.outlineMesh.material.forEach((m) => m.dispose());
                        } else {
                            chunk.outlineMesh.material.dispose();
                        }
                        chunk.outlineMesh = undefined;
                    }
                }
            }
        }
    }

    public onChunkEmpty(key: string): void {
        const chunk = this.loadedChunks.get(key);
        if (chunk) {
            chunk.status = "empty";
            chunk.abortController = undefined;
        }
    }

    public evictStaleChunks(activeKeys: Set<string>): void {
        for (const [key, chunk] of this.loadedChunks.entries()) {
            if (!activeKeys.has(key)) {
                this.disposeChunk(chunk);
                this.loadedChunks.delete(key);
                if (this.wholeDomainChunk?.key === key) {
                    this.wholeDomainChunk = null;
                }
            }
        }
    }

    private evictOctreeSubtree(node: OctreeNode): void {
        const chunk = this.loadedChunks.get(node.id);
        if (chunk) {
            this.disposeChunk(chunk);
            this.loadedChunks.delete(node.id);
        }
        for (const child of node.children) {
            this.evictOctreeSubtree(child);
        }
        node.children = [];
        node.isLeaf = true;
    }

    public getPointCount(): number {
        let count = 0;
        for (const chunk of this.loadedChunks.values()) {
            if (chunk.status === "loaded" && chunk.geometry) {
                const pos = chunk.geometry.getAttribute("position");
                if (pos) count += pos.count;
            }
        }
        return count;
    }

    private disposeChunk(chunk: LoadedChunk): void {
        if (chunk.abortController) {
            chunk.abortController.abort();
            chunk.abortController = undefined;
        }
        if (chunk.mesh) {
            this.group.remove(chunk.mesh);
            if (chunk.mesh.material) {
                if (Array.isArray(chunk.mesh.material)) {
                    chunk.mesh.material.forEach((m) => m.dispose());
                } else {
                    chunk.mesh.material.dispose();
                }
            }
            chunk.mesh = undefined;
        }
        if (chunk.outlineMesh) {
            this.group.remove(chunk.outlineMesh);
            chunk.outlineMesh.geometry.dispose();
            if (Array.isArray(chunk.outlineMesh.material)) {
                chunk.outlineMesh.material.forEach((m) => m.dispose());
            } else {
                chunk.outlineMesh.material.dispose();
            }
            chunk.outlineMesh = undefined;
        }
        if (chunk.geometry) {
            chunk.geometry.dispose();
            chunk.geometry = undefined;
        }
    }

    public destroy(): void {
        for (const chunk of this.loadedChunks.values()) {
            this.disposeChunk(chunk);
        }
        this.loadedChunks.clear();
        this.wholeDomainChunk = null;
        if (this.group.parent) {
            this.group.parent.remove(this.group);
        }
    }
}

/**
 * Orchestrates Hybrid Octree / Whole Domain 3D Level of Detail across multiple point cloud targets.
 */
export class DynamicLODController {
    private rootGroup: THREE.Group;
    private callbacks: EngineCallbacks;
    private config: DynamicLODConfig;

    private targetManagers: Map<string, TargetLODManager> = new Map();
    private activeKeys: Set<string> = new Set();
    private pendingQueue: FetchTask[] = [];
    private activeFetches: number = 0;
    private showOutlines: boolean = false;

    private lastCamPos: THREE.Vector3 = new THREE.Vector3(NaN, NaN, NaN);
    private frustum: THREE.Frustum = new THREE.Frustum();
    private projScreenMatrix: THREE.Matrix4 = new THREE.Matrix4();

    constructor(
        rootGroup: THREE.Group,
        callbacks: EngineCallbacks = {},
        config: Partial<DynamicLODConfig> = {}
    ) {
        this.rootGroup = rootGroup;
        this.callbacks = callbacks;
        this.config = {
            maxLOD: 10,
            distanceFactor: 1.0,
            switchDistanceFactor: 1.0,
            maxConcurrentFetches: 6,
            movementThresholdSq: 0.05,
            ...config,
        };
        this.showOutlines = !!this.config.showOutlines;
    }

    public syncTargets(targets: PointCloudTarget[]): void {
        const targetKeys = new Set(targets.map((t) => t.key));

        // Remove targets that no longer exist
        for (const [key, manager] of this.targetManagers.entries()) {
            if (!targetKeys.has(key)) {
                manager.destroy();
                this.targetManagers.delete(key);
            }
        }

        // Add or update targets
        for (const target of targets) {
            const existing = this.targetManagers.get(target.key);
            if (existing) {
                existing.updateTransform(target);
            } else {
                const manager = new TargetLODManager(target, this.rootGroup, this.config, this.showOutlines);
                this.targetManagers.set(target.key, manager);
            }
        }

        // Force update on next frame
        this.lastCamPos.set(NaN, NaN, NaN);
    }

    public update(camera: THREE.Camera): void {
        if (this.targetManagers.size === 0) return;

        // Skip evaluation if camera hasn't moved significantly
        if (
            !Number.isNaN(this.lastCamPos.x) &&
            camera.position.distanceToSquared(this.lastCamPos) < this.config.movementThresholdSq
        ) {
            return;
        }

        this.lastCamPos.copy(camera.position);

        // Update Camera View Frustum
        this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

        const newActiveKeys = new Set<string>();
        const newTasks: FetchTask[] = [];

        // Evaluate all target managers
        for (const manager of this.targetManagers.values()) {
            manager.evaluate(camera, this.frustum, newActiveKeys, newTasks);
        }

        this.activeKeys = newActiveKeys;

        // Evict chunks that are no longer active
        for (const manager of this.targetManagers.values()) {
            manager.evictStaleChunks(newActiveKeys);
        }

        // Filter pending queue to remove dead tasks
        this.pendingQueue = this.pendingQueue.filter((task) => newActiveKeys.has(task.key));

        // Enqueue new tasks (avoid duplicate queued keys)
        const queuedKeys = new Set(this.pendingQueue.map((t) => t.key));
        for (const task of newTasks) {
            if (!queuedKeys.has(task.key)) {
                this.pendingQueue.push(task);
                queuedKeys.add(task.key);
            }
        }

        // Priority sort: closest tasks to camera load first
        this.pendingQueue.sort((a, b) => a.distSq - b.distSq);

        this.processQueue();
    }

    private processQueue(): void {
        while (
            this.activeFetches < this.config.maxConcurrentFetches &&
            this.pendingQueue.length > 0
        ) {
            const task = this.pendingQueue.shift();
            if (!task) break;

            if (!this.activeKeys.has(task.key)) {
                continue;
            }

            const manager = this.targetManagers.get(task.targetKey);
            if (!manager) continue;

            const abortController = new AbortController();
            manager.registerLoadingChunk(task.key, task.lod, task.bounds, abortController);
            this.activeFetches++;

            fetchBinaryGeometry(task.pcId, task.lod, abortController.signal, task.filters)
                .then((geometry) => {
                    if (abortController.signal.aborted) {
                        geometry.dispose();
                        return;
                    }

                    const currentManager = this.targetManagers.get(task.targetKey);
                    if (currentManager && this.activeKeys.has(task.key)) {
                        currentManager.onChunkLoaded(task.key, geometry);
                        this.notifyPointCount();
                    } else {
                        geometry.dispose();
                    }
                })
                .catch((err) => {
                    if (abortController.signal.aborted) return;
                    console.warn(`[DynamicLODController] Failed to fetch chunk ${task.key} at LOD ${task.lod}:`, err);
                    const currentManager = this.targetManagers.get(task.targetKey);
                    if (currentManager) {
                        currentManager.onChunkEmpty(task.key);
                    }
                })
                .finally(() => {
                    this.activeFetches--;
                    this.processQueue();
                });
        }
    }

    public setShowOutlines(show: boolean): void {
        this.showOutlines = show;
        for (const manager of this.targetManagers.values()) {
            manager.setShowOutlines(show);
        }
    }

    public updateTargetTransform(key: string, matrixArray: number[]): void {
        const manager = this.targetManagers.get(key);
        if (manager) {
            manager.updateTransformMatrix(matrixArray);
            this.lastCamPos.set(NaN, NaN, NaN);
        }
    }

    public getTotalPointCount(): number {
        let total = 0;
        for (const manager of this.targetManagers.values()) {
            total += manager.getPointCount();
        }
        return total;
    }

    private notifyPointCount(): void {
        const total = this.getTotalPointCount();
        this.callbacks.onPointCountChange?.(total);
    }

    public destroy(): void {
        for (const manager of this.targetManagers.values()) {
            manager.destroy();
        }
        this.targetManagers.clear();
        this.activeKeys.clear();
        this.pendingQueue = [];
    }
}
