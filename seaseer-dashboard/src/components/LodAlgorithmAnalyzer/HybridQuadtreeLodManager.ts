import * as THREE from "three";
import { getStatusTexture } from "./StatusTextures";
import {
  DEFAULT_DOMAIN_BOUNDS,
  type TileBounds,
  type ManagerStats,
  type LodManagerConfig,
  type TileNode,
  type TileStatus,
  LOD_COLORS,
} from "./QuadtreeLodManager";
import { type WholeDomainTileNode } from "./WholeDomainLodManager";

export interface HybridTileNode extends TileNode {
  tileSize: number;
  tileSizeSq: number;
}

type BaseTileNode = {
  lod: number;
  bounds: TileBounds;
  status: TileStatus;
  mesh: THREE.Mesh | null;
  borderLines: THREE.LineSegments | null;
  statusOverlay: THREE.Mesh | null;
  loadStartTime?: number;
};

export class HybridWholeDomainLodManager {
  private scene: THREE.Scene;
  private config: LodManagerConfig;

  private quadtreeRoot: HybridTileNode;
  private nodeCounter: number = 0;
  private wholeDomainTile: WholeDomainTileNode | null = null;

  private thresholdGroup: THREE.Group | null = null;
  private quadtreeThresholdGroup: THREE.Group | null = null;
  private currentIsInside: boolean | null = null;

  private planeGeometryCache = new Map<string, THREE.BufferGeometry>();
  private edgesGeometryCache = new Map<string, THREE.EdgesGeometry>();

  private switchingThresholdSq: number = 0;
  private outsideThresholdsSq: number[] = [];

  private centerX: number = 0;
  private centerZ: number = 0;
  private domainCenterPos: THREE.Vector3 = new THREE.Vector3();
  private insideMaxDepth: number = 0;
  private outsideLevelsCount: number = 0;

  private activeLeaves: HybridTileNode[] = [];
  private nodesToEvict: HybridTileNode[] = [];

  constructor(scene: THREE.Scene, config?: Partial<LodManagerConfig>) {
    this.scene = scene;
    this.config = {
      bounds: DEFAULT_DOMAIN_BOUNDS,
      maxLOD: 4,
      distanceFactor: 1.0,
      switchDistanceFactor: 1.0,
      simulateAsyncLoad: false,
      asyncLoadDelayMs: 300,
      wireframe: false,
      showStatusOverlays: true,
      ...config,
    };

    this.recomputeThresholds();
    this.quadtreeRoot = this.createQuadtreeNode(0, this.config.bounds, null);
  }

  public getLodColor(lod: number): number {
    return LOD_COLORS[Math.min(lod, LOD_COLORS.length - 1)];
  }

  private recomputeThresholds(): void {
    const { bounds, maxLOD } = this.config;
    const switchDistanceFactor = this.config.switchDistanceFactor ?? 1.0;
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerZ = (bounds.minZ + bounds.maxZ) / 2;
    this.domainCenterPos.set(this.centerX, 0, this.centerZ);

    this.insideMaxDepth = Math.floor(maxLOD / 2) + 1;
    this.outsideLevelsCount = Math.ceil(maxLOD / 2);

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const domainMetric = Math.max(width, height);
    const switchMetric = domainMetric * switchDistanceFactor;

    this.switchingThresholdSq = switchMetric * switchMetric;
    this.outsideThresholdsSq = Array.from({ length: this.outsideLevelsCount - 1 }, (_, k) => {
      const radius = Math.pow(2, k + 1) * switchMetric;
      return radius * radius;
    });
  }

  private createQuadtreeNode(depth: number, bounds: TileBounds, parent: HybridTileNode | null): HybridTileNode {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const centerX = bounds.minX + width / 2;
    const centerZ = bounds.minZ + height / 2;
    const tileSize = Math.max(width, height);
    const lod = Math.max(0, this.insideMaxDepth - depth);

    this.nodeCounter++;
    return {
      id: `hybrid_qt_depth${depth}_lod${lod}_${centerX.toFixed(1)}_${centerZ.toFixed(1)}_${this.nodeCounter}`,
      depth,
      lod,
      position: new THREE.Vector3(centerX, 0, centerZ),
      bounds: { ...bounds },
      tileSize,
      tileSizeSq: tileSize * tileSize,
      status: "NEEDS_LOAD",
      mesh: null,
      borderLines: null,
      statusOverlay: null,
      children: [],
      parent,
      isLeaf: true,
    };
  }

  public update(focalPosition: THREE.Vector3, timeSeconds: number = performance.now() * 0.001): void {
    if (!this.thresholdGroup && this.config.showStatusOverlays) {
      this.rebuildThresholdVisuals();
    }

    if (this.quadtreeThresholdGroup) {
      this.quadtreeThresholdGroup.position.set(focalPosition.x, 0, focalPosition.z);
      this.quadtreeThresholdGroup.visible = this.config.showStatusOverlays;
    }
    if (this.thresholdGroup) {
      this.thresholdGroup.visible = this.config.showStatusOverlays;
    }

    const dx = focalPosition.x - this.centerX;
    const dz = focalPosition.z - this.centerZ;
    const distSq = dx * dx + dz * dz;
    const isInside = distSq <= this.switchingThresholdSq;

    if (this.currentIsInside !== isInside) {
      this.currentIsInside = isInside;
      this.applyThresholdStyles(isInside);
    }

    if (isInside) {
      if (this.wholeDomainTile && !this.wholeDomainTile.mesh) {
        this.wholeDomainTile = null;
      }

      this.activeLeaves.length = 0;
      this.nodesToEvict.length = 0;
      this.evaluateQuadtreeNode(this.quadtreeRoot, focalPosition, this.activeLeaves, this.nodesToEvict);

      const nowMs = performance.now();
      for (const node of this.activeLeaves) {
        this.processTileLoading(node, nowMs, node.depth * 0.002);
        this.animateNodeVisuals(node, timeSeconds);
      }

      for (const node of this.nodesToEvict) {
        this.evictQuadtreeSubtree(node);
      }

      // Check all pending split nodes in quadtree:
      // Keep old LOD until all newer more detailed LODs (descendant leaves) are finished loading.
      this.processPendingEvictions(this.quadtreeRoot, timeSeconds);

      // Transition from wholeDomainTile (outside) to quadtree (inside):
      // Keep wholeDomainTile until all active quadtree leaves are finished loading.
      if (this.wholeDomainTile) {
        const allQuadtreeLoaded =
          this.activeLeaves.length > 0 &&
          this.activeLeaves.every((leaf) => leaf.status === "LOADED");

        if (allQuadtreeLoaded) {
          this.disposeTileMesh(this.wholeDomainTile);
          this.wholeDomainTile = null;
        } else {
          if (this.wholeDomainTile.status !== "NEEDS_EVICT") {
            this.wholeDomainTile.status = "NEEDS_EVICT";
            this.updateTileMaterials(this.wholeDomainTile);
          }
          this.animateNodeVisuals(this.wholeDomainTile, timeSeconds);
        }
      }
    } else {
      if (!this.quadtreeRoot.isLeaf || this.quadtreeRoot.mesh !== null) {
        this.evictQuadtreeSubtree(this.quadtreeRoot);
        this.quadtreeRoot = this.createQuadtreeNode(0, this.config.bounds, null);
      }

      let targetLod = this.config.maxLOD;
      for (let i = 0; i < this.outsideThresholdsSq.length; i++) {
        if (distSq <= this.outsideThresholdsSq[i]) {
          targetLod = this.insideMaxDepth + i;
          break;
        }
      }

      const { bounds } = this.config;
      if (!this.wholeDomainTile) {
        this.wholeDomainTile = {
          id: "hybrid_outside_single_tile",
          lod: targetLod,
          position: this.domainCenterPos,
          bounds: { ...bounds },
          status: "NEEDS_LOAD",
          mesh: null,
          borderLines: null,
          statusOverlay: null,
        };
      } else {
        const boundsChanged =
          this.wholeDomainTile.bounds.minX !== bounds.minX ||
          this.wholeDomainTile.bounds.maxX !== bounds.maxX ||
          this.wholeDomainTile.bounds.minZ !== bounds.minZ ||
          this.wholeDomainTile.bounds.maxZ !== bounds.maxZ;

        if (boundsChanged) {
          this.wholeDomainTile.bounds = { ...bounds };
          this.wholeDomainTile.position = this.domainCenterPos;
          this.wholeDomainTile.lod = targetLod;
          this.wholeDomainTile.status = "NEEDS_REFRESH";
          this.rebuildThresholdVisuals();
        } else if (this.wholeDomainTile.lod !== targetLod) {
          this.wholeDomainTile.lod = targetLod;
          this.wholeDomainTile.status = "NEEDS_REFRESH";
        } else if (this.wholeDomainTile.status === "NEEDS_EVICT") {
          if (this.wholeDomainTile.mesh) {
            this.wholeDomainTile.status = "LOADED";
            this.updateTileMaterials(this.wholeDomainTile);
          } else {
            this.wholeDomainTile.status = "NEEDS_LOAD";
          }
        }
      }

      this.processTileLoading(this.wholeDomainTile, performance.now(), -0.01, 1);
      this.animateNodeVisuals(this.wholeDomainTile, timeSeconds);
    }
  }

  private evaluateQuadtreeNode(
    node: HybridTileNode,
    focalPos: THREE.Vector3,
    activeLeaves: HybridTileNode[],
    nodesToEvict: HybridTileNode[]
  ): void {
    const dx = focalPos.x - node.position.x;
    const dz = focalPos.z - node.position.z;
    const distSq = dx * dx + dz * dz;

    const threshold = node.tileSize * this.config.distanceFactor;
    const shouldSplit = node.depth < this.insideMaxDepth && distSq < threshold * threshold;

    if (shouldSplit) {
      if (node.isLeaf) {
        this.splitQuadtreeNode(node);
      }
      if (node.status !== "NEEDS_EVICT") {
        node.status = "NEEDS_EVICT";
        delete node.loadStartTime;
        if (node.mesh) {
          this.updateTileMaterials(node);
        }
      }

      for (const child of node.children) {
        this.evaluateQuadtreeNode(child as HybridTileNode, focalPos, activeLeaves, nodesToEvict);
      }
    } else {
      if (!node.isLeaf) {
        for (const child of node.children) {
          nodesToEvict.push(child as HybridTileNode);
        }
        node.children = [];
        node.isLeaf = true;
        if (node.mesh) {
          node.status = "LOADED";
          delete node.loadStartTime;
          this.updateTileMaterials(node);
        } else if (node.status !== "LOADED") {
          node.status = "NEEDS_LOAD";
          delete node.loadStartTime;
        }
      }

      if (node.status === "NEEDS_EVICT") {
        if (node.mesh) {
          node.status = "LOADED";
          this.updateTileMaterials(node);
        } else {
          node.status = "NEEDS_LOAD";
        }
        delete node.loadStartTime;
      }

      activeLeaves.push(node);
    }
  }

  private splitQuadtreeNode(node: HybridTileNode): void {
    const { minX, minZ, maxX, maxZ } = node.bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const nextDepth = node.depth + 1;

    node.children = [
      this.createQuadtreeNode(nextDepth, { minX, minZ, maxX: midX, maxZ: midZ }, node),
      this.createQuadtreeNode(nextDepth, { minX: midX, minZ, maxX, maxZ: midZ }, node),
      this.createQuadtreeNode(nextDepth, { minX, minZ: midZ, maxX: midX, maxZ }, node),
      this.createQuadtreeNode(nextDepth, { minX: midX, minZ: midZ, maxX, maxZ }, node),
    ];
    node.isLeaf = false;
  }

  private areAllDescendantLeavesLoaded(node: HybridTileNode): boolean {
    if (node.isLeaf) {
      return node.status === "LOADED";
    }
    if (node.children.length === 0) {
      return true;
    }
    for (const child of node.children) {
      if (!this.areAllDescendantLeavesLoaded(child as HybridTileNode)) {
        return false;
      }
    }
    return true;
  }

  private processPendingEvictions(node: HybridTileNode, timeSeconds: number): void {
    if (node.isLeaf) return;

    for (const child of node.children) {
      this.processPendingEvictions(child as HybridTileNode, timeSeconds);
    }

    if (node.mesh) {
      if (this.areAllDescendantLeavesLoaded(node)) {
        this.disposeTileMesh(node);
      } else {
        if (node.status !== "NEEDS_EVICT") {
          node.status = "NEEDS_EVICT";
          this.updateTileMaterials(node);
        }
        this.animateNodeVisuals(node, timeSeconds);
      }
    }
  }

  private processTileLoading(tile: BaseTileNode, nowMs: number, yOffset: number = 0, baseRenderOrder?: number): void {
    if (tile.status === "NEEDS_LOAD") {
      if (!this.config.simulateAsyncLoad) {
        if (!tile.mesh) this.instantiateTileMesh(tile, yOffset, baseRenderOrder);
        tile.status = "LOADED";
        delete tile.loadStartTime;
        this.updateTileMaterials(tile);
      } else {
        if (!tile.loadStartTime || !tile.mesh) {
          tile.loadStartTime = nowMs;
          if (!tile.mesh) this.instantiateTileMesh(tile, yOffset, baseRenderOrder);
        } else if (nowMs - tile.loadStartTime >= this.config.asyncLoadDelayMs) {
          tile.status = "LOADED";
          delete tile.loadStartTime;
          this.updateTileMaterials(tile);
        }
      }
    } else if (tile.status === "NEEDS_REFRESH") {
      this.disposeTileMesh(tile);
      this.instantiateTileMesh(tile, yOffset, baseRenderOrder);
      tile.status = "LOADED";
      delete tile.loadStartTime;
      this.updateTileMaterials(tile);
    }
  }

  private getPlaneGeometry(width: number, height: number): THREE.BufferGeometry {
    const key = `${Math.round(width * 1000)}x${Math.round(height * 1000)}`;
    let geo = this.planeGeometryCache.get(key);
    if (!geo) {
      geo = new THREE.PlaneGeometry(width, height);
      geo.rotateX(-Math.PI / 2);
      this.planeGeometryCache.set(key, geo);
    }
    return geo;
  }

  private getEdgesGeometry(planeGeo: THREE.BufferGeometry, key: string): THREE.EdgesGeometry {
    let edges = this.edgesGeometryCache.get(key);
    if (!edges) {
      edges = new THREE.EdgesGeometry(planeGeo);
      this.edgesGeometryCache.set(key, edges);
    }
    return edges;
  }

  private instantiateTileMesh(node: BaseTileNode, yOffset: number = 0, customRenderOrder?: number): void {
    if (node.mesh) return;

    const width = node.bounds.maxX - node.bounds.minX;
    const height = node.bounds.maxZ - node.bounds.minZ;
    const geoKey = `${Math.round(width * 1000)}x${Math.round(height * 1000)}`;
    const planeGeo = this.getPlaneGeometry(width, height);
    const edgesGeo = this.getEdgesGeometry(planeGeo, geoKey);
    const color = this.getLodColor(node.lod);
    const renderOrder = customRenderOrder ?? 10 - node.lod;

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: this.config.wireframe ? 0.19 : 0.21,
      wireframe: this.config.wireframe,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const pos = (node as any).position as THREE.Vector3;
    const mesh = new THREE.Mesh(planeGeo, material);
    mesh.position.set(pos.x, yOffset, pos.z);
    mesh.renderOrder = renderOrder;

    const borderLines = new THREE.LineSegments(
      edgesGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
    );
    borderLines.renderOrder = renderOrder + 0.1;
    mesh.add(borderLines);

    const statusOverlay = new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    statusOverlay.renderOrder = renderOrder + 0.2;
    statusOverlay.visible = this.config.showStatusOverlays;
    mesh.add(statusOverlay);

    node.mesh = mesh;
    node.borderLines = borderLines;
    node.statusOverlay = statusOverlay;

    this.scene.add(mesh);
    this.updateTileMaterials(node);
  }

  private updateTileMaterials(node: BaseTileNode): void {
    if (!node.mesh) return;

    const meshMat = node.mesh.material as THREE.MeshBasicMaterial;
    const borderMat = node.borderLines?.material as THREE.LineBasicMaterial;
    const overlayMat = node.statusOverlay?.material as THREE.MeshBasicMaterial;
    const color = this.getLodColor(node.lod);

    meshMat.color.setHex(color);
    meshMat.wireframe = this.config.wireframe;
    meshMat.opacity = this.config.wireframe ? 0.15 : 0.25;

    if (node.statusOverlay) {
      node.statusOverlay.visible = this.config.showStatusOverlays;
    }
    if (borderMat) {
      borderMat.color.setHex(color);
      borderMat.opacity = 0.9;
    }

    if (overlayMat) {
      const width = node.bounds.maxX - node.bounds.minX;
      const height = node.bounds.maxZ - node.bounds.minZ;
      if (overlayMat.map) overlayMat.map.dispose();
      overlayMat.map = getStatusTexture(node.status, width, height);
      overlayMat.color.setHex(0xffffff);

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

  private animateNodeVisuals(node: BaseTileNode, timeSeconds: number): void {
    if (!node.mesh || !node.statusOverlay || !this.config.showStatusOverlays) return;
    const overlayMat = node.statusOverlay.material as THREE.MeshBasicMaterial;
    if (node.status === "NEEDS_LOAD") {
      overlayMat.opacity = Math.sin(timeSeconds * 8) * 0.25 + 0.45;
    } else if (node.status === "NEEDS_REFRESH") {
      overlayMat.opacity = Math.sin(timeSeconds * 6) * 0.2 + 0.4;
    } else if (node.status === "NEEDS_EVICT") {
      overlayMat.opacity = Math.sin(timeSeconds * 6) * 0.15 + 0.7;
    }
  }

  private disposeTileMesh(node: BaseTileNode): void {
    if (!node.mesh) return;

    this.scene.remove(node.mesh);
    if (node.mesh.material) {
      const mats = Array.isArray(node.mesh.material) ? node.mesh.material : [node.mesh.material];
      mats.forEach((m) => m.dispose());
    }
    if (node.borderLines?.material) {
      (node.borderLines.material as THREE.Material).dispose();
    }
    if (node.statusOverlay?.material) {
      const mat = node.statusOverlay.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }

    node.mesh = null;
    node.borderLines = null;
    node.statusOverlay = null;
    delete node.loadStartTime;
  }

  private evictQuadtreeSubtree(node: HybridTileNode): void {
    node.status = "NEEDS_EVICT";
    this.disposeTileMesh(node);
    for (const child of node.children) {
      this.evictQuadtreeSubtree(child as HybridTileNode);
    }
    node.children = [];
    node.isLeaf = true;
  }

  private clearGroup(group: THREE.Group | null): THREE.Group | null {
    if (!group) return null;
    this.scene.remove(group);
    group.traverse((child) => {
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m.dispose());
      }
    });
    return null;
  }

  private createCircleGeometry(radius: number, segments: number = 64): THREE.BufferGeometry {
    const positions = new Float32Array((segments + 1) * 3);
    for (let step = 0; step <= segments; step++) {
      const angle = (step / segments) * Math.PI * 2;
      positions[step * 3] = Math.cos(angle) * radius;
      positions[step * 3 + 1] = 0.05;
      positions[step * 3 + 2] = Math.sin(angle) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }

  private createDashedCircle(radius: number, color: number, dashSize: number, opacity: number): THREE.Line {
    const geo = this.createCircleGeometry(radius);
    const mat = new THREE.LineDashedMaterial({
      color,
      transparent: true,
      opacity,
      scale: 1,
      dashSize,
      gapSize: 2,
      linewidth: 3,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 15;
    line.userData.baseOpacity = opacity;
    return line;
  }

  private applyThresholdStyles(isInside: boolean): void {
    const setGroupStyle = (group: THREE.Group | null, isActive: boolean) => {
      if (!group) return;
      group.traverse((child) => {
        if (child instanceof THREE.Line && child.material) {
          const mat = child.material as THREE.LineDashedMaterial;
          const baseOpacity = (child.userData.baseOpacity as number) ?? 0.75;
          if (isActive) {
            mat.opacity = Math.min(1.0, baseOpacity * 1.25);
            mat.linewidth = 3;
            child.renderOrder = 20;
          } else {
            mat.opacity = 0.25;
            mat.linewidth = 1;
            child.renderOrder = 10;
          }
        }
      });
    };

    setGroupStyle(this.quadtreeThresholdGroup, isInside);
    setGroupStyle(this.thresholdGroup, !isInside);
  }

  private rebuildThresholdVisuals(): void {
    this.thresholdGroup = this.clearGroup(this.thresholdGroup);
    this.quadtreeThresholdGroup = this.clearGroup(this.quadtreeThresholdGroup);
    this.currentIsInside = null;
    if (!this.config.showStatusOverlays) return;

    const { bounds, distanceFactor } = this.config;
    const switchDistanceFactor = this.config.switchDistanceFactor ?? 1.0;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const domainMetric = Math.max(width, height);
    const switchMetric = domainMetric * switchDistanceFactor;

    this.thresholdGroup = new THREE.Group();
    this.thresholdGroup.position.set(this.centerX, 0, this.centerZ);

    this.thresholdGroup.add(
      this.createDashedCircle(switchMetric, this.getLodColor(this.insideMaxDepth), 4, 0.85)
    );

    for (let k = 0; k < this.outsideLevelsCount - 1; k++) {
      const radius = Math.pow(2, k + 1) * switchMetric;
      const lod = this.insideMaxDepth + k;
      this.thresholdGroup.add(this.createDashedCircle(radius, this.getLodColor(lod), 3, 0.75));
    }
    this.scene.add(this.thresholdGroup);

    this.quadtreeThresholdGroup = new THREE.Group();
    const baseTileSize = Math.max(width, height);
    for (let depth = 0; depth < this.insideMaxDepth; depth++) {
      const lod = Math.max(0, this.insideMaxDepth - depth);
      const radius = (baseTileSize / Math.pow(2, depth)) * distanceFactor;
      if (radius > 0) {
        this.quadtreeThresholdGroup.add(this.createDashedCircle(radius, this.getLodColor(lod), 3, 0.75));
      }
    }
    this.scene.add(this.quadtreeThresholdGroup);
  }

  public reset(): void {
    this.evictQuadtreeSubtree(this.quadtreeRoot);
    this.quadtreeRoot = this.createQuadtreeNode(0, this.config.bounds, null);
    if (this.wholeDomainTile) {
      this.disposeTileMesh(this.wholeDomainTile);
      this.wholeDomainTile = null;
    }
    this.rebuildThresholdVisuals();
  }

  public markAllNeedsRefresh(): void {
    const traverse = (node: HybridTileNode) => {
      if (node.status === "LOADED") {
        node.status = "NEEDS_REFRESH";
      } else if (node.mesh) {
        this.updateTileMaterials(node);
      }
      for (const child of node.children) traverse(child as HybridTileNode);
    };
    traverse(this.quadtreeRoot);

    if (this.wholeDomainTile?.status === "LOADED") {
      this.wholeDomainTile.status = "NEEDS_REFRESH";
    } else if (this.wholeDomainTile?.mesh) {
      this.updateTileMaterials(this.wholeDomainTile);
    }
    this.rebuildThresholdVisuals();
  }

  public setMaxLOD(maxLOD: number): void {
    if (this.config.maxLOD !== maxLOD) {
      this.config.maxLOD = maxLOD;
      this.recomputeThresholds();
      this.reset();
    }
  }

  public setDistanceFactor(factor: number): void {
    if (this.config.distanceFactor !== factor) {
      this.config.distanceFactor = factor;
      this.recomputeThresholds();
      this.rebuildThresholdVisuals();
    }
  }

  public setSwitchDistanceFactor(factor: number): void {
    if (this.config.switchDistanceFactor !== factor) {
      this.config.switchDistanceFactor = factor;
      this.recomputeThresholds();
      this.rebuildThresholdVisuals();
      this.reset();
    }
  }

  public setSwitchingDistanceFactor(factor: number): void {
    this.setSwitchDistanceFactor(factor);
  }

  public setSwitchThresholdFactor(factor: number): void {
    this.setSwitchDistanceFactor(factor);
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
    this.recomputeThresholds();
    this.reset();
  }

  public getConfig(): LodManagerConfig {
    return { ...this.config };
  }

  public getStats(): ManagerStats {
    const nodesPerLod: Record<number, number> = {};
    const traverse = (node: HybridTileNode) => {
      if (node.status === "LOADED") {
        nodesPerLod[node.lod] = (nodesPerLod[node.lod] || 0) + 1;
      }
      for (const child of node.children) traverse(child as HybridTileNode);
    };
    traverse(this.quadtreeRoot);

    if (this.wholeDomainTile?.status === "LOADED") {
      nodesPerLod[this.wholeDomainTile.lod] = (nodesPerLod[this.wholeDomainTile.lod] || 0) + 1;
    }

    return { nodesPerLod };
  }

  public dispose(): void {
    this.evictQuadtreeSubtree(this.quadtreeRoot);
    if (this.wholeDomainTile) {
      this.disposeTileMesh(this.wholeDomainTile);
      this.wholeDomainTile = null;
    }

    this.thresholdGroup = this.clearGroup(this.thresholdGroup);
    this.quadtreeThresholdGroup = this.clearGroup(this.quadtreeThresholdGroup);

    for (const geo of this.planeGeometryCache.values()) geo.dispose();
    this.planeGeometryCache.clear();

    for (const edges of this.edgesGeometryCache.values()) edges.dispose();
    this.edgesGeometryCache.clear();
  }
}

export { HybridWholeDomainLodManager as HybridQuadtreeWholeDomainLodManager };
