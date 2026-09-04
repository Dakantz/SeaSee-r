import * as THREE from "three";
import { type TileBounds, type ManagerStats, type LodManagerConfig, type TileStatus, LOD_COLORS } from "./QuadtreeLodManager";

export interface GridTileNode {
  id: string;
  lod: number;
  position: THREE.Vector3;
  bounds: TileBounds;
  status: TileStatus;
  mesh: THREE.Mesh | null;
  borderLines: THREE.LineSegments | null;
  statusOverlay: THREE.Mesh | null;
  loadStartTime?: number;
}

export class GridCutoutLodManager {
  private scene: THREE.Scene;
  private config: LodManagerConfig;
  private evictedCountTotal: number = 0;
  private nodeCounter: number = 0;

  // Active rendered grid tiles map (id -> GridTileNode)
  private activeTiles: Map<string, GridTileNode> = new Map();

  // Shared geometry cache per tile dimension to avoid redundant allocations
  private planeGeometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private edgesGeometryCache: Map<string, THREE.EdgesGeometry> = new Map();

  constructor(scene: THREE.Scene, config?: Partial<LodManagerConfig>) {
    this.scene = scene;
    this.config = {
      bounds: { minX: -120, minZ: -120, maxX: 120, maxZ: 120 },
      maxLOD: 4,
      distanceFactor: 1.6,
      simulateAsyncLoad: false,
      asyncLoadDelayMs: 300,
      wireframe: false,
      showStatusOverlays: true,
      ...config,
    };
  }

  public getLodColor(lod: number): number {
    return LOD_COLORS[Math.min(lod, LOD_COLORS.length - 1)];
  }

  /**
   * Main per-frame update loop for Algorithm 2 (Grid-Aligned Cutout LOD)
   */
  public update(focalPosition: THREE.Vector3, timeSeconds: number = performance.now() * 0.001): void {
    const { bounds, maxLOD, distanceFactor } = this.config;
    const totalWidth = bounds.maxX - bounds.minX;
    const totalHeight = bounds.maxZ - bounds.minZ;

    // Base coarse grid size at LOD 0 (4x4 coarse grid across total domain)
    const baseCoarseGridCols = 4;
    const baseCoarseGridRows = 4;
    const coarseTileW = totalWidth / baseCoarseGridCols; // e.g. 60
    const coarseTileH = totalHeight / baseCoarseGridRows; // e.g. 60

    // Fine detail level (LOD 1) subdivides coarse tile into 2x2 fine sub-squares (30x30)
    // 8x8 fine sub-squares total across domain.
    const fineCols = baseCoarseGridCols * 2; // 8
    const fineRows = baseCoarseGridRows * 2; // 8
    const fineTileW = coarseTileW / 2; // 30
    const fineTileH = coarseTileH / 2; // 30

    // Distance threshold: when focal position is at center of alignment (0,0),
    // the 16 fine sub-squares surrounding (0,0) span [-60, 60] x [-60, 60].
    // Their centers are at (+-15, +-15), (+-15, +-45), (+-45, +-15), (+-45, +-45).
    // Maximum distance from (0,0) to center of these 16 squares is sqrt(45^2 + 45^2) = 63.64.
    // Setting threshold radius to ~65 * (distanceFactor / 1.6) loads exactly 16 fine squares at center,
    // and loads fewer than 16 in most off-center situations.
    const cutoffRadius = 65.0 * (distanceFactor / 1.6);

    const neededTiles: Map<string, { lod: number; bounds: TileBounds; center: THREE.Vector3 }> = new Map();

    // Track active fine sub-squares (col, row)
    const activeFineSquares = new Set<string>();

    // 1. Evaluate fine sub-squares (LOD 1 or maxLOD detail)
    for (let r = 0; r < fineRows; r++) {
      for (let c = 0; c < fineCols; c++) {
        const minX = bounds.minX + c * fineTileW;
        const maxX = minX + fineTileW;
        const minZ = bounds.minZ + r * fineTileH;
        const maxZ = minZ + fineTileH;

        const centerX = minX + fineTileW / 2;
        const centerZ = minZ + fineTileH / 2;
        const center = new THREE.Vector3(centerX, 0, centerZ);

        const dx = focalPosition.x - centerX;
        const dz = focalPosition.z - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= cutoffRadius) {
          activeFineSquares.add(`${r}_${c}`);
          const fineLodLevel = 0; // LOD 0 is finest detail
          const key = `grid_fine_${r}_${c}_lod${fineLodLevel}`;
          neededTiles.set(key, {
            lod: fineLodLevel,
            bounds: { minX, minZ, maxX, maxZ },
            center,
          });
        }
      }
    }

    // 2. Evaluate coarse tiles (coarsest detail level) and cut out fine sub-squares
    const coarseLodLevel = Math.max(1, maxLOD);
    for (let cr = 0; cr < baseCoarseGridRows; cr++) {
      for (let cc = 0; cc < baseCoarseGridCols; cc++) {
        // A coarse tile contains 4 fine sub-squares: (2*cr, 2*cc), (2*cr+1, 2*cc), (2*cr, 2*cc+1), (2*cr+1, 2*cc+1)
        for (let subR = 0; subR < 2; subR++) {
          for (let subC = 0; subC < 2; subC++) {
            const fr = cr * 2 + subR;
            const fc = cc * 2 + subC;

            // If fine sub-square is NOT active, render it as coarse sub-tile!
            if (!activeFineSquares.has(`${fr}_${fc}`)) {
              const minX = bounds.minX + fc * fineTileW;
              const maxX = minX + fineTileW;
              const minZ = bounds.minZ + fr * fineTileH;
              const maxZ = minZ + fineTileH;

              const centerX = minX + fineTileW / 2;
              const centerZ = minZ + fineTileH / 2;
              const center = new THREE.Vector3(centerX, 0, centerZ);

              const key = `grid_coarse_${fr}_${fc}_lod${coarseLodLevel}`;
              neededTiles.set(key, {
                lod: coarseLodLevel,
                bounds: { minX, minZ, maxX, maxZ },
                center,
              });
            }
          }
        }
      }
    }

    // 3. Reconcile existing active tiles vs needed tiles
    const nowMs = performance.now();

    // Mark missing tiles for eviction
    for (const [key, tile] of this.activeTiles.entries()) {
      if (!neededTiles.has(key)) {
        this.disposeTileVisuals(tile);
        this.activeTiles.delete(key);
        this.evictedCountTotal++;
      }
    }

    // Add or update needed tiles
    for (const [key, info] of neededTiles.entries()) {
      let tile = this.activeTiles.get(key);
      if (!tile) {
        this.nodeCounter++;
        tile = {
          id: key,
          lod: info.lod,
          position: info.center,
          bounds: info.bounds,
          status: "NEEDS_LOAD",
          mesh: null,
          borderLines: null,
          statusOverlay: null,
        };
        this.activeTiles.set(key, tile);
      }

      if (tile.status === "NEEDS_LOAD") {
        if (!this.config.simulateAsyncLoad) {
          this.instantiateTileMesh(tile);
          tile.status = "LOADED";
          this.updateTileMaterials(tile);
        } else {
          if (!tile.loadStartTime) {
            tile.loadStartTime = nowMs;
            this.instantiateTileMesh(tile);
          } else if (nowMs - tile.loadStartTime >= this.config.asyncLoadDelayMs) {
            tile.status = "LOADED";
            this.updateTileMaterials(tile);
          }
        }
      } else if (tile.status === "NEEDS_REFRESH") {
        this.rebuildTileMesh(tile);
        tile.status = "LOADED";
        this.updateTileMaterials(tile);
      }

      this.animateNodeVisuals(tile, timeSeconds);
    }
  }

  private getPlaneGeometry(width: number, height: number): THREE.BufferGeometry {
    const key = `${width.toFixed(3)}x${height.toFixed(3)}`;
    if (!this.planeGeometryCache.has(key)) {
      const geo = new THREE.PlaneGeometry(width, height);
      geo.rotateX(-Math.PI / 2);
      this.planeGeometryCache.set(key, geo);
    }
    return this.planeGeometryCache.get(key)!;
  }

  private getEdgesGeometry(planeGeo: THREE.BufferGeometry, key: string): THREE.EdgesGeometry {
    if (!this.edgesGeometryCache.has(key)) {
      const edges = new THREE.EdgesGeometry(planeGeo);
      this.edgesGeometryCache.set(key, edges);
    }
    return this.edgesGeometryCache.get(key)!;
  }

  private instantiateTileMesh(node: GridTileNode): void {
    if (node.mesh) return;

    const width = node.bounds.maxX - node.bounds.minX;
    const height = node.bounds.maxZ - node.bounds.minZ;
    const geoKey = `${width.toFixed(3)}x${height.toFixed(3)}`;

    const planeGeo = this.getPlaneGeometry(width, height);
    const edgesGeo = this.getEdgesGeometry(planeGeo, geoKey);

    const baseColor = this.getLodColor(node.lod);

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

    const borderMat = new THREE.LineBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.85,
    });
    const borderLines = new THREE.LineSegments(edgesGeo, borderMat);
    borderLines.renderOrder = 10 - node.lod + 0.1;
    mesh.add(borderLines);

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

  private updateTileMaterials(node: GridTileNode): void {
    if (!node.mesh) return;

    const meshMat = node.mesh.material as THREE.MeshBasicMaterial;
    const borderMat = node.borderLines?.material as THREE.LineBasicMaterial;
    const overlayMat = node.statusOverlay?.material as THREE.MeshBasicMaterial;

    const baseColor = this.getLodColor(node.lod);
    meshMat.color.setHex(baseColor);
    meshMat.wireframe = this.config.wireframe;

    meshMat.opacity = this.config.wireframe ? 0.15 : 0.25;

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
        if (borderMat) borderMat.color.setHex(0x00f0ff);
        break;

      case "LOADED":
        if (overlayMat) overlayMat.opacity = 0;
        if (borderMat) {
          borderMat.color.setHex(baseColor);
          borderMat.opacity = 0.9;
        }
        break;

      case "NEEDS_REFRESH":
        if (overlayMat) {
          overlayMat.color.setHex(0xffb703);
          overlayMat.opacity = 0.55;
          overlayMat.wireframe = true;
        }
        if (borderMat) borderMat.color.setHex(0xffb703);
        break;

      case "NEEDS_EVICT":
        meshMat.opacity = 0.2;
        if (overlayMat) {
          overlayMat.color.setHex(0xff0055);
          overlayMat.opacity = 0.6;
          overlayMat.wireframe = true;
        }
        if (borderMat) borderMat.color.setHex(0xff0055);
        break;
    }
  }

  private animateNodeVisuals(node: GridTileNode, timeSeconds: number): void {
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

  private rebuildTileMesh(node: GridTileNode): void {
    this.disposeTileVisuals(node);
    this.instantiateTileMesh(node);
  }

  private disposeTileVisuals(node: GridTileNode): void {
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

  public markAllNeedsRefresh(): void {
    for (const tile of this.activeTiles.values()) {
      if (tile.status === "LOADED") {
        tile.status = "NEEDS_REFRESH";
      }
    }
  }

  public setMaxLOD(maxLOD: number): void {
    if (this.config.maxLOD !== maxLOD) {
      this.config.maxLOD = maxLOD;
      this.markAllNeedsRefresh();
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

  public getStats(): ManagerStats {
    const nodesPerLod: Record<number, number> = {};

    for (const tile of this.activeTiles.values()) {
      nodesPerLod[tile.lod] = (nodesPerLod[tile.lod] || 0) + 1;
    }

    return {
      nodesPerLod,
    };
  }

  public dispose(): void {
    for (const tile of this.activeTiles.values()) {
      this.disposeTileVisuals(tile);
    }
    this.activeTiles.clear();

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
