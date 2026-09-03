import * as THREE from "three";

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
  /** Distance multiplier or per-LOD threshold array in world units */
  distanceFactor: number;
  customThresholds?: number[];
  simulateAsyncLoad: boolean;
  asyncLoadDelayMs: number;
  wireframe: boolean;
  showStatusOverlays: boolean;
}

export interface ManagerStats {
  totalNodes: number;
  leafNodes: number;
  loadedNodes: number;
  needsLoadNodes: number;
  needsRefreshNodes: number;
  needsEvictNodes: number;
  nodesPerLod: Record<number, number>;
  evictedTotal: number;
}

export const LOD_COLORS: number[] = [
  0xef4444, // Level 0: Red (Finest detail)
  0xf97316, // Level 1: Orange
  0xeab308, // Level 2: Yellow
  0x22c55e, // Level 3: Green
  0x3b82f6, // Level 4: Blue
  0xa855f7, // Level 5+: Purple (Coarsest)
];

export const LOD_COLOR_HEX: string[] = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
];

export class QuadtreeLodManager {
  private scene: THREE.Scene;
  private root: TileNode;
  private config: LodManagerConfig;
  private evictedCountTotal: number = 0;
  private nodeCounter: number = 0;

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
   * Calculate distance split threshold for a given depth/LOD and tile dimension
   */
  private getSplitThreshold(depth: number, bounds: TileBounds): number {
    if (this.config.customThresholds && this.config.customThresholds[depth] !== undefined) {
      return this.config.customThresholds[depth];
    }
    const tileSize = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    return tileSize * this.config.distanceFactor;
  }

  /**
   * Main update function called each render frame
   */
  public update(focalPosition: THREE.Vector3, timeSeconds: number = performance.now() * 0.001): void {
    // 1. Evaluate quadtree recursively based on focal position in 2D plane
    const activeLeaves: TileNode[] = [];
    const nodesToEvict: TileNode[] = [];

    this.evaluateNode(this.root, focalPosition, activeLeaves, nodesToEvict);

    // 2. Process active leaf nodes through status pipeline
    const nowMs = performance.now();
    for (const node of activeLeaves) {
      if (node.status === "NEEDS_LOAD") {
        if (!this.config.simulateAsyncLoad) {
          this.instantiateTileMesh(node);
          node.status = "LOADED";
          this.updateTileMaterials(node);
        } else {
          if (!node.loadStartTime) {
            node.loadStartTime = nowMs;
            this.instantiateTileMesh(node);
          } else if (nowMs - node.loadStartTime >= this.config.asyncLoadDelayMs) {
            node.status = "LOADED";
            this.updateTileMaterials(node);
          }
        }
      } else if (node.status === "NEEDS_REFRESH") {
        this.rebuildTileMesh(node);
        node.status = "LOADED";
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

    const threshold = this.getSplitThreshold(node.depth, node.bounds);
    const shouldSplit = node.depth < this.config.maxLOD && dist2D < threshold;

    if (shouldSplit) {
      if (node.isLeaf) {
        this.splitNode(node);
      }

      if (node.status === "LOADED" || node.status === "NEEDS_LOAD") {
        this.disposeNodeVisuals(node);
        node.status = "NEEDS_EVICT";
      }

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
        }
      }

      if (node.status === "NEEDS_EVICT") {
        node.status = "NEEDS_LOAD";
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
      color: 0x00ffff,
      transparent: true,
      opacity: 0.0,
      wireframe: true,
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

    switch (node.status) {
      case "NEEDS_LOAD":
        if (overlayMat) {
          overlayMat.color.setHex(0x00f0ff);
          overlayMat.opacity = 0.4;
          overlayMat.wireframe = false;
        }
        if (borderMat) {
          borderMat.color.setHex(0x00f0ff);
        }
        break;

      case "LOADED":
        if (overlayMat) {
          overlayMat.opacity = 0;
        }
        if (borderMat) {
          borderMat.color.setHex(baseColor);
          borderMat.opacity = 0.9;
        }
        break;

      case "NEEDS_REFRESH":
        if (overlayMat) {
          overlayMat.color.setHex(0xffb703);
          overlayMat.opacity = 0.5;
          overlayMat.wireframe = true;
        }
        if (borderMat) {
          borderMat.color.setHex(0xffb703);
        }
        break;

      case "NEEDS_EVICT":
        meshMat.opacity = 0.15;
        if (overlayMat) {
          overlayMat.color.setHex(0xff0055);
          overlayMat.opacity = 0.5;
          overlayMat.wireframe = true;
        }
        if (borderMat) {
          borderMat.color.setHex(0xff0055);
        }
        break;
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
      (node.statusOverlay.material as THREE.Material).dispose();
    }

    node.mesh = null;
    node.borderLines = null;
    node.statusOverlay = null;
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
    this.markAllNeedsRefresh();
  }

  public setBounds(bounds: TileBounds): void {
    this.config.bounds = { ...bounds };
    this.dispose();
    this.root = this.createNode(0, this.config.bounds, null);
  }

  public getConfig(): LodManagerConfig {
    return { ...this.config };
  }

  public getStats(): ManagerStats {
    let totalNodes = 0;
    let leafNodes = 0;
    let loadedNodes = 0;
    let needsLoadNodes = 0;
    let needsRefreshNodes = 0;
    let needsEvictNodes = 0;
    const nodesPerLod: Record<number, number> = {};

    const traverse = (node: TileNode) => {
      totalNodes++;
      nodesPerLod[node.lod] = (nodesPerLod[node.lod] || 0) + 1;

      if (node.isLeaf) {
        leafNodes++;
      }

      switch (node.status) {
        case "LOADED":
          loadedNodes++;
          break;
        case "NEEDS_LOAD":
          needsLoadNodes++;
          break;
        case "NEEDS_REFRESH":
          needsRefreshNodes++;
          break;
        case "NEEDS_EVICT":
          needsEvictNodes++;
          break;
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);

    return {
      totalNodes,
      leafNodes,
      loadedNodes,
      needsLoadNodes,
      needsRefreshNodes,
      needsEvictNodes,
      nodesPerLod,
      evictedTotal: this.evictedCountTotal,
    };
  }

  public dispose(): void {
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
