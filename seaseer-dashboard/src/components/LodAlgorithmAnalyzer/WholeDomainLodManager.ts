import * as THREE from "three";
import { getStatusTexture } from "./StatusTextures";
import {
  type TileBounds,
  type ManagerStats,
  type LodManagerConfig,
  type TileStatus,
  LOD_COLORS,
} from "./QuadtreeLodManager";

export interface WholeDomainTileNode {
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
 * Whole Domain LOD Manager (Algorithm 4)
 * 
 * Manages the original domain bounds (`config.bounds`) as a single unbroken rectangle without splitting into subrectangles.
 * Dynamically adjusts the LOD level of the entire rectangle based on the distance between the focal position and the domain rectangle.
 * Visualizes the exponential distance threshold boundaries around the bounding box in the 2D scene.
 */
export class WholeDomainLodManager {
  private scene: THREE.Scene;
  private config: LodManagerConfig;
  private tile: WholeDomainTileNode | null = null;
  private thresholdGroup: THREE.Group | null = null;

  private planeGeometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private edgesGeometryCache: Map<string, THREE.EdgesGeometry> = new Map();

  private thresholdsSq: number[] = [];

  constructor(scene: THREE.Scene, config?: Partial<LodManagerConfig>) {
    this.scene = scene;
    this.config = {
      bounds: { minX: -120, minZ: -120, maxX: 120, maxZ: 120 },
      maxLOD: 4,
      distanceFactor: 1.0,
      simulateAsyncLoad: false,
      asyncLoadDelayMs: 300,
      wireframe: false,
      showStatusOverlays: true,
      ...config,
    };
    this.recomputeThresholdsSq();
  }

  public getLodColor(lod: number): number {
    return LOD_COLORS[Math.min(lod, LOD_COLORS.length - 1)];
  }

  /**
   * Precomputes squared distance thresholds once during construction or when bounds/maxLOD change.
   * Eliminates the need for Math.sqrt during per-frame update calculations.
   */
  private recomputeThresholdsSq(): void {
    const { bounds, maxLOD } = this.config;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const baseMetric = Math.sqrt(width * width + height * height);

    this.thresholdsSq = [];

    // Precompute squared distance thresholds from centerpoint for each LOD level transition:
    // Doubled diameter / radius for each concentric circle
    for (let k = 0; k < maxLOD; k++) {
      const radius = Math.pow(2, k - 1) * baseMetric;
      this.thresholdsSq.push(radius * radius);
    }
  }

  /**
   * Calculates squared 2D distance from domain centerpoint to focalPosition.
   * Avoids calculating Math.sqrt per frame.
   */
  private calculateDistanceSqFromCenter(focalPosition: THREE.Vector3): number {
    const { bounds } = this.config;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;

    const dx = focalPosition.x - centerX;
    const dz = focalPosition.z - centerZ;

    return dx * dx + dz * dz;
  }

  /**
   * Determine LOD level (0..maxLOD) using squared distance to domain centerpoint.
   */
  private calculateLod(distSq: number): number {
    for (let lod = 0; lod < this.thresholdsSq.length; lod++) {
      if (distSq <= this.thresholdsSq[lod]) {
        return lod;
      }
    }
    return this.config.maxLOD;
  }

  /**
   * Rebuild visual 2D threshold boundary lines as concentric circles centered at the domain centerpoint.
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
    const { bounds, maxLOD } = this.config;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const baseMetric = Math.sqrt(width * width + height * height);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const segments = 64;

    // Create concentric circle threshold boundary lines for transitions between LOD levels
    for (let k = 0; k <= maxLOD; k++) {
      const radius = Math.pow(2, k - 1) * baseMetric;
      if (radius <= 0) continue;

      const color = this.getLodColor(k);
      const points: THREE.Vector3[] = [];

      for (let step = 0; step <= segments; step++) {
        const angle = (step / segments) * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
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

  public update(focalPosition: THREE.Vector3, timeSeconds: number = performance.now() * 0.001): void {
    if (!this.thresholdGroup && this.config.showStatusOverlays) {
      this.rebuildThresholdVisuals();
    }

    const { bounds } = this.config;
    const distSq = this.calculateDistanceSqFromCenter(focalPosition);
    const targetLod = this.calculateLod(distSq);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const center = new THREE.Vector3(centerX, 0, centerZ);

    const nowMs = performance.now();

    if (!this.tile) {
      this.tile = {
        id: "whole_domain_single_tile",
        lod: targetLod,
        position: center,
        bounds: { ...bounds },
        status: "NEEDS_LOAD",
        mesh: null,
        borderLines: null,
        statusOverlay: null,
      };
    } else {
      const boundsChanged =
        this.tile.bounds.minX !== bounds.minX ||
        this.tile.bounds.maxX !== bounds.maxX ||
        this.tile.bounds.minZ !== bounds.minZ ||
        this.tile.bounds.maxZ !== bounds.maxZ;

      const lodChanged = this.tile.lod !== targetLod;

      if (boundsChanged) {
        this.tile.bounds = { ...bounds };
        this.tile.position = center;
        this.tile.lod = targetLod;
        this.tile.status = "NEEDS_REFRESH";
        this.rebuildThresholdVisuals();
      } else if (lodChanged) {
        this.tile.lod = targetLod;
        this.tile.status = "NEEDS_REFRESH";
      }
    }

    const tile = this.tile;

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

  private instantiateTileMesh(node: WholeDomainTileNode): void {
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
    mesh.position.set(node.position.x, 0.02, node.position.z);
    mesh.renderOrder = 10;

    const borderMat = new THREE.LineBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.85,
    });
    const borderLines = new THREE.LineSegments(edgesGeo, borderMat);
    borderLines.renderOrder = 10.1;
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
    statusOverlay.renderOrder = 10.2;
    statusOverlay.visible = this.config.showStatusOverlays;
    mesh.add(statusOverlay);

    node.mesh = mesh;
    node.borderLines = borderLines;
    node.statusOverlay = statusOverlay;

    this.scene.add(mesh);
    this.updateTileMaterials(node);
  }

  private updateTileMaterials(node: WholeDomainTileNode): void {
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

  private animateNodeVisuals(node: WholeDomainTileNode, timeSeconds: number): void {
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

  private rebuildTileMesh(node: WholeDomainTileNode): void {
    this.disposeTileVisuals(node);
    this.instantiateTileMesh(node);
  }

  private disposeTileVisuals(node: WholeDomainTileNode): void {
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
    if (this.tile) {
      this.disposeTileVisuals(this.tile);
      this.tile = null;
    }
    this.rebuildThresholdVisuals();
  }

  public markAllNeedsRefresh(): void {
    if (this.tile && this.tile.status === "LOADED") {
      this.tile.status = "NEEDS_REFRESH";
    }
    this.rebuildThresholdVisuals();
  }

  public setMaxLOD(maxLOD: number): void {
    if (this.config.maxLOD !== maxLOD) {
      this.config.maxLOD = maxLOD;
      this.recomputeThresholdsSq();
      this.markAllNeedsRefresh();
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
    this.rebuildThresholdVisuals();
    this.markAllNeedsRefresh();
  }

  public setBounds(bounds: TileBounds): void {
    this.config.bounds = { ...bounds };
    this.recomputeThresholdsSq();
    this.reset();
  }

  public getConfig(): LodManagerConfig {
    return { ...this.config };
  }

  public getStats(): ManagerStats {
    const nodesPerLod: Record<number, number> = {};

    if (this.tile && this.tile.status === "LOADED") {
      nodesPerLod[this.tile.lod] = 1;
    }

    return {
      nodesPerLod,
    };
  }

  public dispose(): void {
    if (this.tile) {
      this.disposeTileVisuals(this.tile);
      this.tile = null;
    }

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
