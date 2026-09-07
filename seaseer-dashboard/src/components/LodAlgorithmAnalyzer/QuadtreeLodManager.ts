import * as THREE from "three";

import { getStatusTexture } from "./StatusTextures";

export type TileStatus = "NEEDS_LOAD" | "LOADED" | "NEEDS_REFRESH" | "NEEDS_EVICT";

export interface TileBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface TileNode {
  id: string;
  depth: number;
  lod: number;
  position: THREE.Vector3;
  bounds: TileBounds;
  status: TileStatus;
  mesh: THREE.Mesh | null;
  borderLines: THREE.LineSegments | null;
  statusOverlay: THREE.Mesh | null;
  children: TileNode[];
  parent: TileNode | null;
  isLeaf: boolean;
  loadStartTime?: number;
}

export interface LodManagerConfig {
  bounds: TileBounds;
  maxLOD: number;
  /** Distance multiplier in world units */
  distanceFactor: number;
  /** Tile eviction distance factor multiplier (for Algorithm 3) */
  evictionDistanceFactor?: number;
  simulateAsyncLoad: boolean;
  asyncLoadDelayMs: number;
  wireframe: boolean;
  showStatusOverlays: boolean;
}

export interface ManagerStats {
  nodesPerLod: Record<number, number>;
}

export const LOD_COLORS: number[] = [
  0xef4444, // Level 0: Red (Finest detail)
  0xf97316, // Level 1: Orange
  0xeab308, // Level 2: Yellow
  0x22c55e, // Level 3: Green
  0x3b82f6, // Level 4: Blue
  0xa855f7, // Level 5: Purple
  0xec4899, // Level 6+: Pink (Coarsest)
];

export const LOD_COLOR_HEX: string[] = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

export class QuadtreeLodManager {
  private scene: THREE.Scene;
  private root: TileNode;
  private config: LodManagerConfig;
  private evictedCountTotal: number = 0;
  private nodeCounter: number = 0;
  private thresholdGroup: THREE.Group | null = null;

  // Shared geometry cache per tile size to reduce allocations
  private planeGeometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private edgesGeometryCache: Map<string, THREE.EdgesGeometry> = new Map();

  constructor(scene: THREE.Scene, config?: Partial<LodManagerConfig>) {
    this.scene = scene;

    this.config = {
      bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
      maxLOD: 4,
      distanceFactor: 1.6,
      simulateAsyncLoad: false,
      asyncLoadDelayMs: 300,
      wireframe: false,
      showStatusOverlays: true,
      ...config,
    };

    this.root = this.createNode(0, this.config.bounds, null);
  }

  /**
   * Rebuild visual 2D threshold boundary circles centered at the focal point.
   */
  private rebuildThresholdVisuals(): void {
    if (this.thresholdGroup) {
      this.scene.remove(this.thresholdGroup);
      this.thresholdGroup.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.thresholdGroup = null;
    }

    if (!this.config.showStatusOverlays) return;

    this.thresholdGroup = new THREE.Group();
    const { bounds, maxLOD, distanceFactor } = this.config;
    const baseWidth = bounds.maxX - bounds.minX;
    const baseHeight = bounds.maxZ - bounds.minZ;
    const baseTileSize = Math.max(baseWidth, baseHeight);
    const segments = 64;

    // Create concentric circle threshold boundary lines for each depth split threshold
    for (let depth = 0; depth < maxLOD; depth++) {
      const lod = Math.max(0, maxLOD - depth);
      const tileSize = baseTileSize / Math.pow(2, depth);
      const radius = tileSize * distanceFactor;
      if (radius <= 0) continue;

      const color = this.getLodColor(lod);
      const points: THREE.Vector3[] = [];

      for (let step = 0; step <= segments; step++) {
        const angle = (step / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        points.push(new THREE.Vector3(x, 0.05, z));
      }

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        scale: 1,
        dashSize: 3,
        gapSize: 2,
      });

      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 15;

      this.thresholdGroup.add(line);
    }

    this.scene.add(this.thresholdGroup);
  }

  /**
   * Helper to construct a Quadtree tile node
   * Depth 0 is root (coarsest), depth = maxLOD is deepest split (LOD 0, finest detail).
   */
  private createNode(depth: number, bounds: TileBounds, parent: TileNode | null): TileNode {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const centerX = bounds.minX + width / 2;
    const centerZ = bounds.minZ + height / 2;

    this.nodeCounter++;
    const lod = Math.max(0, this.config.maxLOD - depth);

    return {
      id: `tile_depth${depth}_lod${lod}_${centerX.toFixed(1)}_${centerZ.toFixed(1)}_${this.nodeCounter}`,
      depth,
      lod,
      position: new THREE.Vector3(centerX, 0, centerZ),
      bounds: { ...bounds },
      status: "NEEDS_LOAD",
      mesh: null,
      borderLines: null,
      statusOverlay: null,
      children: [],
      parent,
      isLeaf: true,
    };
  }

  /**
   * Get LOD color based on integer level (LOD 0 is finest, red)
   */
  public getLodColor(lod: number): number {
    return LOD_COLORS[Math.min(lod, LOD_COLORS.length - 1)];
  }

  /**
   * Calculate distance split threshold for a given tile dimension
   */
  private getSplitThreshold(bounds: TileBounds): number {
    const tileSize = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    return tileSize * this.config.distanceFactor;
  }

  /**
   * Main update function called each render frame
   */
  public update(focalPosition: THREE.Vector3, timeSeconds: number = performance.now() * 0.001): void {
    if (!this.thresholdGroup && this.config.showStatusOverlays) {
      this.rebuildThresholdVisuals();
    }

    if (this.thresholdGroup) {
      this.thresholdGroup.position.set(focalPosition.x, 0, focalPosition.z);
      this.thresholdGroup.visible = this.config.showStatusOverlays;
    }
    // 1. Evaluate quadtree recursively based on focal position in 2D plane
    const activeLeaves: TileNode[] = [];
    const nodesToEvict: TileNode[] = [];

    this.evaluateNode(this.root, focalPosition, activeLeaves, nodesToEvict);

    // 2. Process active leaf nodes through status pipeline
    const nowMs = performance.now();
    for (const node of activeLeaves) {
      if (node.status === "NEEDS_LOAD") {
        if (!this.config.simulateAsyncLoad) {
          if (!node.mesh) {
            this.instantiateTileMesh(node);
          }
          node.status = "LOADED";
          delete node.loadStartTime;
          this.updateTileMaterials(node);
        } else {
          if (!node.loadStartTime || !node.mesh) {
            node.loadStartTime = nowMs;
            if (!node.mesh) {
              this.instantiateTileMesh(node);
            }
          } else if (nowMs - node.loadStartTime >= this.config.asyncLoadDelayMs) {
            node.status = "LOADED";
            delete node.loadStartTime;
            this.updateTileMaterials(node);
          }
        }
      } else if (node.status === "NEEDS_REFRESH") {
        this.rebuildTileMesh(node);
        node.status = "LOADED";
        delete node.loadStartTime;
        this.updateTileMaterials(node);
      }

      this.animateNodeVisuals(node, timeSeconds);
    }

    // 3. Process evicted nodes cleanly
    for (const node of nodesToEvict) {
      this.evictNodeSubtree(node);
    }
  }

  /**
   * Recursively evaluate node splitting / collapsing based on 2D distance
   */
  private evaluateNode(
    node: TileNode,
    focalPos: THREE.Vector3,
    activeLeaves: TileNode[],
    nodesToEvict: TileNode[]
  ): void {
    const dx = focalPos.x - node.position.x;
    const dz = focalPos.z - node.position.z;
    const dist2D = Math.sqrt(dx * dx + dz * dz);

    const threshold = this.getSplitThreshold(node.bounds);
    const shouldSplit = node.depth < this.config.maxLOD && dist2D < threshold;

    if (shouldSplit) {
      if (node.mesh) {
        this.disposeNodeVisuals(node);
      }

      if (node.isLeaf) {
        this.splitNode(node);
      }

      node.status = "NEEDS_EVICT";
      delete node.loadStartTime;

      for (const child of node.children) {
        this.evaluateNode(child, focalPos, activeLeaves, nodesToEvict);
      }
    } else {
      if (!node.isLeaf) {
        for (const child of node.children) {
          nodesToEvict.push(child);
        }
        node.children = [];
        node.isLeaf = true;

        if (node.status !== "LOADED") {
          node.status = "NEEDS_LOAD";
          delete node.loadStartTime;
        }
      }

      if (node.status === "NEEDS_EVICT") {
        node.status = "NEEDS_LOAD";
        delete node.loadStartTime;
      }

      activeLeaves.push(node);
    }
  }

  /**
   * Split a Quadtree node into 4 sub-quadrants
   */
  private splitNode(node: TileNode): void {
    const { minX, minZ, maxX, maxZ } = node.bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const nextDepth = node.depth + 1;

    const nw = this.createNode(nextDepth, { minX, minZ, maxX: midX, maxZ: midZ }, node);
    const ne = this.createNode(nextDepth, { minX: midX, minZ, maxX, maxZ: midZ }, node);
    const sw = this.createNode(nextDepth, { minX, minZ: midZ, maxX: midX, maxZ }, node);
    const se = this.createNode(nextDepth, { minX: midX, minZ: midZ, maxX, maxZ }, node);

    node.status = "NEEDS_EVICT";
    delete node.loadStartTime;
    node.children = [nw, ne, sw, se];
    node.isLeaf = false;
  }

  /**
   * Get or create cached 2D plane geometry
   */
  private getPlaneGeometry(width: number, height: number): THREE.BufferGeometry {
    const key = `${width.toFixed(3)}x${height.toFixed(3)}`;
    if (!this.planeGeometryCache.has(key)) {
      const geo = new THREE.PlaneGeometry(width, height);
      geo.rotateX(-Math.PI / 2);
      this.planeGeometryCache.set(key, geo);
    }
    return this.planeGeometryCache.get(key)!;
  }

  /**
   * Get or create cached 2D edges geometry
   */
  private getEdgesGeometry(planeGeo: THREE.BufferGeometry, key: string): THREE.EdgesGeometry {
    if (!this.edgesGeometryCache.has(key)) {
      const edges = new THREE.EdgesGeometry(planeGeo);
      this.edgesGeometryCache.set(key, edges);
    }
    return this.edgesGeometryCache.get(key)!;
  }

  /**
   * Instantiate 2D THREE.Mesh and visual overlays for a tile node
   */
  private instantiateTileMesh(node: TileNode): void {
    if (node.mesh) return;

    const width = node.bounds.maxX - node.bounds.minX;
    const height = node.bounds.maxZ - node.bounds.minZ;
    const geoKey = `${width.toFixed(3)}x${height.toFixed(3)}`;

    const planeGeo = this.getPlaneGeometry(width, height);
    const edgesGeo = this.getEdgesGeometry(planeGeo, geoKey);

    const baseColor = this.getLodColor(node.lod);

    // 2D Flat Mesh Material
    const material = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: this.config.wireframe ? 0.15 : 0.25,
      wireframe: this.config.wireframe,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(planeGeo, material);
    mesh.position.copy(node.position);
    mesh.renderOrder = 10 - node.lod;

    // 2D Tile Outline Border
    const borderMat = new THREE.LineBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.85,
    });
    const borderLines = new THREE.LineSegments(edgesGeo, borderMat);
    borderLines.renderOrder = 10 - node.lod + 0.1;
    mesh.add(borderLines);

    // 2D Status Overlay
    const overlayMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      wireframe: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const statusOverlay = new THREE.Mesh(planeGeo, overlayMat);
    statusOverlay.renderOrder = 10 - node.lod + 0.2;
    statusOverlay.visible = this.config.showStatusOverlays;
    mesh.add(statusOverlay);

    node.mesh = mesh;
    node.borderLines = borderLines;
    node.statusOverlay = statusOverlay;

    this.scene.add(mesh);
    this.updateTileMaterials(node);
  }

  /**
   * Update tile materials based on current status and debug settings
   */
  private updateTileMaterials(node: TileNode): void {
    if (!node.mesh) return;

    const meshMat = node.mesh.material as THREE.MeshBasicMaterial;
    const borderMat = node.borderLines?.material as THREE.LineBasicMaterial;
    const overlayMat = node.statusOverlay?.material as THREE.MeshBasicMaterial;

    const baseColor = this.getLodColor(node.lod);
    meshMat.color.setHex(baseColor);
    meshMat.wireframe = this.config.wireframe;

    if (this.config.wireframe) {
      meshMat.opacity = 0.15;
    } else {
      meshMat.opacity = 0.25;
    }

    if (node.statusOverlay) {
      node.statusOverlay.visible = this.config.showStatusOverlays;
    }

    if (borderMat) {
      borderMat.color.setHex(baseColor);
      borderMat.opacity = 0.9;
    }

    if (overlayMat) {
      const width = node.bounds.maxX - node.bounds.minX;
      const height = node.bounds.maxZ - node.bounds.minZ;
      if (overlayMat.map) {
        overlayMat.map.dispose();
      }
      const texture = getStatusTexture(node.status, width, height);
      overlayMat.map = texture;
      overlayMat.color.setHex(0xffffff);
      overlayMat.wireframe = false;

      switch (node.status) {
        case "NEEDS_LOAD":
          overlayMat.opacity = 0.7;
          break;

        case "LOADED":
          overlayMat.opacity = 0.0;
          break;

        case "NEEDS_REFRESH":
          overlayMat.opacity = 0.75;
          break;

        case "NEEDS_EVICT":
          overlayMat.opacity = 0.85;
          meshMat.opacity = 0.15;
          break;
      }
    }
  }

  /**
   * Dynamic 2D visual animation per frame
   */
  private animateNodeVisuals(node: TileNode, timeSeconds: number): void {
    if (!node.mesh || !node.statusOverlay || !this.config.showStatusOverlays) return;

    if (node.status === "NEEDS_LOAD") {
      const pulse = Math.sin(timeSeconds * 8) * 0.25 + 0.45;
      const overlayMat = node.statusOverlay.material as THREE.MeshBasicMaterial;
      overlayMat.opacity = pulse;
    } else if (node.status === "NEEDS_REFRESH") {
      const pulse = Math.sin(timeSeconds * 6) * 0.2 + 0.4;
      const overlayMat = node.statusOverlay.material as THREE.MeshBasicMaterial;
      overlayMat.opacity = pulse;
    }
  }

  /**
   * Rebuild geometry & materials for a node needing refresh
   */
  private rebuildTileMesh(node: TileNode): void {
    this.disposeNodeVisuals(node);
    this.instantiateTileMesh(node);
  }

  /**
   * Cleanly dispose of a node's Three.js meshes, materials, and children
   */
  private disposeNodeVisuals(node: TileNode): void {
    if (!node.mesh) return;

    this.scene.remove(node.mesh);

    if (node.mesh.material) {
      if (Array.isArray(node.mesh.material)) {
        node.mesh.material.forEach((m) => m.dispose());
      } else {
        node.mesh.material.dispose();
      }
    }

    if (node.borderLines && node.borderLines.material) {
      (node.borderLines.material as THREE.Material).dispose();
    }

    if (node.statusOverlay && node.statusOverlay.material) {
      const mat = node.statusOverlay.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }

    node.mesh = null;
    node.borderLines = null;
    node.statusOverlay = null;
    delete node.loadStartTime;
  }

  /**
   * Evict an entire subtree of quadtree nodes cleanly
   */
  private evictNodeSubtree(node: TileNode): void {
    node.status = "NEEDS_EVICT";
    this.disposeNodeVisuals(node);
    this.evictedCountTotal++;

    for (const child of node.children) {
      this.evictNodeSubtree(child);
    }
    node.children = [];
    node.isLeaf = true;
  }

  /**
   * Force reset the entire Quadtree construct from scratch
   */
  public reset(): void {
    const disposeSubtree = (node: TileNode) => {
      this.disposeNodeVisuals(node);
      for (const child of node.children) {
        disposeSubtree(child);
      }
      node.children = [];
      node.isLeaf = true;
    };
    disposeSubtree(this.root);
    this.root = this.createNode(0, this.config.bounds, null);
    this.rebuildThresholdVisuals();
  }

  /**
   * Force refresh on all loaded nodes
   */
  public markAllNeedsRefresh(): void {
    const traverse = (node: TileNode) => {
      if (node.status === "LOADED") {
        node.status = "NEEDS_REFRESH";
      }
      for (const child of node.children) {
        traverse(child);
      }
    };
    traverse(this.root);
  }

  public setMaxLOD(maxLOD: number): void {
    if (this.config.maxLOD !== maxLOD) {
      this.config.maxLOD = maxLOD;
      this.updateNodeLODs(this.root);
      this.rebuildThresholdVisuals();
      this.markAllNeedsRefresh();
    }
  }

  private updateNodeLODs(node: TileNode): void {
    node.lod = Math.max(0, this.config.maxLOD - node.depth);
    for (const child of node.children) {
      this.updateNodeLODs(child);
    }
  }

  public setDistanceFactor(factor: number): void {
    if (this.config.distanceFactor !== factor) {
      this.config.distanceFactor = factor;
      this.rebuildThresholdVisuals();
    }
  }

  public setSimulateAsyncLoad(simulate: boolean, delayMs: number = 300): void {
    this.config.simulateAsyncLoad = simulate;
    this.config.asyncLoadDelayMs = delayMs;
  }

  public setWireframe(wireframe: boolean): void {
    this.config.wireframe = wireframe;
    this.markAllNeedsRefresh();
  }

  public setShowStatusOverlays(show: boolean): void {
    this.config.showStatusOverlays = show;
    if (this.thresholdGroup) {
      this.thresholdGroup.visible = show;
    } else if (show) {
      this.rebuildThresholdVisuals();
    }
    this.markAllNeedsRefresh();
  }

  public setBounds(bounds: TileBounds): void {
    this.config.bounds = { ...bounds };
    this.dispose();
    this.root = this.createNode(0, this.config.bounds, null);
    this.rebuildThresholdVisuals();
  }

  public getConfig(): LodManagerConfig {
    return { ...this.config };
  }

  public getStats(): ManagerStats {
    const nodesPerLod: Record<number, number> = {};

    const traverse = (node: TileNode) => {
      if (node.status == "LOADED") {
        nodesPerLod[node.lod] = (nodesPerLod[node.lod] || 0) + 1;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);

    return {
      nodesPerLod,
    };
  }

  public dispose(): void {
    if (this.thresholdGroup) {
      this.scene.remove(this.thresholdGroup);
      this.thresholdGroup.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.thresholdGroup = null;
    }

    const disposeSubtree = (node: TileNode) => {
      this.disposeNodeVisuals(node);
      for (const child of node.children) {
        disposeSubtree(child);
      }
      node.children = [];
    };

    disposeSubtree(this.root);

    for (const geo of this.planeGeometryCache.values()) {
      geo.dispose();
    }
    this.planeGeometryCache.clear();

    for (const edges of this.edgesGeometryCache.values()) {
      edges.dispose();
    }
    this.edgesGeometryCache.clear();
  }
}
