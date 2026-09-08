import * as THREE from "three";
import { getStatusTexture } from "./StatusTextures";
import {
  DEFAULT_DOMAIN_BOUNDS,
  type TileBounds,
  type ManagerStats,
  type LodManagerConfig,
  type TileStatus,
  LOD_COLORS,
} from "./QuadtreeLodManager";

export interface InsideOutTileNode {
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

/**
 * Inside Out 3x3 LOD Algorithm Manager (2D adaptation of 3D DynamicCubicLODController)
 * 
 * Generates nested 3x3 grid neighborhoods centered around the focal point.
 * Spatial cell size scales by 3x per level:
 * - LOD 0 (Finest detail): Smallest 3x3 grid immediately surrounding focal point.
 * - LOD 1..maxLOD: Progressively larger 3x3 grids surrounding the focal area.
 */
export class InsideOut3x3LodManager {
  private scene: THREE.Scene;
  private config: LodManagerConfig;
  private evictedCountTotal: number = 0;
  private nodeCounter: number = 0;

  // Active rendered grid tiles map (id -> InsideOutTileNode)
  private activeTiles: Map<string, InsideOutTileNode> = new Map();

  // Shared geometry cache per tile dimension to avoid redundant allocations
  private planeGeometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private edgesGeometryCache: Map<string, THREE.EdgesGeometry> = new Map();

  constructor(scene: THREE.Scene, config?: Partial<LodManagerConfig>) {
    this.scene = scene;
    this.config = {
      bounds: DEFAULT_DOMAIN_BOUNDS,
      maxLOD: 4,
      distanceFactor: 1.0,
      evictionDistanceFactor: 3,
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
   * Main per-frame update loop for Algorithm 2 (Inside Out 3x3 LOD)
   */
  public update(focalPosition: THREE.Vector3, timeSeconds: number = performance.now() * 0.001): void {
    const { maxLOD } = this.config;
    const neededTiles: Map<string, { lod: number; bounds: TileBounds; center: THREE.Vector3 }> = new Map();

    // 2. Base cell width for LOD 0 (finest detail)
    const baseW0 = 12.0;

    // 3. Concentric 3x3 grids from lod = 0 (finest detail) up to maxLOD (coarsest detail)
    for (let lod = 0; lod <= maxLOD; lod++) {
      const wL = baseW0 * Math.pow(3, lod);

      const centerI = Math.floor(focalPosition.x / wL);
      const centerJ = Math.floor(focalPosition.z / wL);

      // 3x3 neighborhood grid at current LOD level centered at (centerI, centerJ)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const i = centerI + dx;
          const j = centerJ + dz;

          const minX = i * wL;
          const maxX = (i + 1) * wL;
          const minZ = j * wL;
          const maxZ = (j + 1) * wL;

          const centerX = (i + 0.5) * wL;
          const centerZ = (j + 0.5) * wL;

          const key = `inside_out_lod${lod}_${i}_${j}`;
          neededTiles.set(key, {
            lod,
            bounds: { minX, minZ, maxX, maxZ },
            center: new THREE.Vector3(centerX, 0, centerZ),
          });
        }
      }
    }

    // 4. Reconcile active tiles vs needed tiles with distance-based eviction
    const nowMs = performance.now();
    const evictionFactor = this.config.evictionDistanceFactor ?? 3;

    // Only evict tiles if they are more than evictionFactor times their own size away from the current focal point
    for (const [key, tile] of this.activeTiles.entries()) {
      if (key.startsWith("inside_out_global")) continue;
      if (neededTiles.has(key)) continue;

      const tileSize = tile.bounds.maxX - tile.bounds.minX;
      const dx = Math.abs(tile.position.x - focalPosition.x);
      const dz = Math.abs(tile.position.z - focalPosition.z);
      const distFromFocal = Math.max(dx, dz);

      if (distFromFocal > evictionFactor * tileSize) {
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

  private instantiateTileMesh(node: InsideOutTileNode): void {
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
    // Slight Y elevation layer per LOD to avoid depth z-fighting
    mesh.position.set(node.position.x, 0.02 + (10 - node.lod) * 0.005, node.position.z);
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

  private updateTileMaterials(node: InsideOutTileNode): void {
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
          meshMat.opacity = 0.2;
          break;
      }
    }
  }

  private animateNodeVisuals(node: InsideOutTileNode, timeSeconds: number): void {
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

  private rebuildTileMesh(node: InsideOutTileNode): void {
    this.disposeTileVisuals(node);
    this.instantiateTileMesh(node);
  }

  private disposeTileVisuals(node: InsideOutTileNode): void {
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
  }

  public reset(): void {
    for (const tile of this.activeTiles.values()) {
      this.disposeTileVisuals(tile);
    }
    this.activeTiles.clear();
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

  public setEvictionDistanceFactor(factor: number): void {
    const intFactor = Math.max(1, Math.round(factor));
    if (this.config.evictionDistanceFactor !== intFactor) {
      this.config.evictionDistanceFactor = intFactor;
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
    this.markAllNeedsRefresh();
  }

  public getConfig(): LodManagerConfig {
    return { ...this.config };
  }

  public getStats(): ManagerStats {
    const nodesPerLod: Record<number, number> = {};

    for (const tile of this.activeTiles.values()) {
      if (tile.status === "LOADED") {
        nodesPerLod[tile.lod] = (nodesPerLod[tile.lod] || 0) + 1;
      }
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
