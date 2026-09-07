import * as THREE from "three";
import type { EngineCallbacks, EngineConfig } from "../types";
import { getBoundingBoxCenter, type CustomQuery, type QuerySummaryData } from "../../../PointCloudPanel/CustomQueryManager";
import { TARGET_X, TARGET_Y } from "./LightingSystem";

const _colorHovered = new THREE.Color("#ffaa00");
const _colorDefault = new THREE.Color("#00e5ff");

export class MarkerSystem {
    private scene: THREE.Scene;
    private domElement: HTMLElement;
    private callbacks: EngineCallbacks;
    private camera: THREE.Camera;

    private instancedMesh: THREE.InstancedMesh | null = null;
    private geometry: THREE.SphereGeometry;
    private material: THREE.MeshStandardMaterial;

    private dummy: THREE.Object3D;
    private raycaster: THREE.Raycaster;
    private pointer: THREE.Vector2;

    private queries: CustomQuery[] = [];
    private summaryMap: Record<string, QuerySummaryData> = {};
    private hoveredId: string | null = null;

    private boundOnPointerMove: (e: PointerEvent) => void;
    private boundOnClick: (e: MouseEvent) => void;
    private boundOnDblClick: (e: MouseEvent) => void;

    constructor(
        scene: THREE.Scene,
        camera: THREE.Camera,
        domElement: HTMLElement,
        callbacks: EngineCallbacks = {},
        config: Partial<EngineConfig> = {}
    ) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.callbacks = callbacks;

        this.geometry = new THREE.SphereGeometry(1, 16, 16);
        this.material = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2 });
        this.dummy = new THREE.Object3D();
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnDblClick = this.onDblClick.bind(this);

        this.domElement.addEventListener("pointermove", this.boundOnPointerMove);
        this.domElement.addEventListener("click", this.boundOnClick);
        this.domElement.addEventListener("dblclick", this.boundOnDblClick);

        this.updateConfig(config);
    }

    public setCamera(camera: THREE.Camera): void {
        this.camera = camera;
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        let needsRebuild = false;

        if (config.queries !== undefined) {
            this.queries = config.queries;
            needsRebuild = true;
        }
        if (config.summaryMap !== undefined) {
            this.summaryMap = config.summaryMap;
        }
        if (config.hoveredId !== undefined) {
            this.hoveredId = config.hoveredId;
        }

        if (needsRebuild || !this.instancedMesh) {
            this.rebuildInstancedMesh();
        } else {
            this.updateInstanceTransforms();
        }
    }

    private rebuildInstancedMesh(): void {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh);
            this.instancedMesh.dispose();
            this.instancedMesh = null;
        }

        if (this.queries.length === 0) return;

        this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, this.queries.length);
        this.instancedMesh.name = "MarkerInstancedMesh";
        this.instancedMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);

        this.updateInstanceTransforms();
        this.scene.add(this.instancedMesh);
    }

    private updateInstanceTransforms(): void {
        if (!this.instancedMesh || this.queries.length === 0) return;

        this.queries.forEach((query, index) => {
            const center = getBoundingBoxCenter(this.summaryMap[query.id]);
            const [cx, cy, cz] = center || [TARGET_X, TARGET_Y, 0];
            const isHovered = query.id === this.hoveredId;
            const scale = isHovered ? 1.5 : 1.0;

            this.dummy.position.set(cx, cy, cz);
            this.dummy.scale.set(scale, scale, scale);
            this.dummy.updateMatrix();

            this.instancedMesh!.setMatrixAt(index, this.dummy.matrix);
            const color = isHovered ? _colorHovered : _colorDefault;
            this.instancedMesh!.setColorAt(index, color);
        });

        this.instancedMesh.instanceMatrix.needsUpdate = true;
        if (this.instancedMesh.instanceColor) {
            this.instancedMesh.instanceColor.needsUpdate = true;
        }
    }

    private updatePointerCoordinates(event: MouseEvent | PointerEvent): void {
        const rect = this.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private getIntersectedInstanceId(event: MouseEvent | PointerEvent): number | null {
        if (!this.instancedMesh || this.queries.length === 0) return null;
        this.updatePointerCoordinates(event);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersects = this.raycaster.intersectObject(this.instancedMesh);
        if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
            return intersects[0].instanceId;
        }
        return null;
    }

    private onPointerMove(event: PointerEvent): void {
        const instanceId = this.getIntersectedInstanceId(event);
        if (instanceId !== null && this.queries[instanceId]) {
            this.domElement.style.cursor = "pointer";
            const qId = this.queries[instanceId].id;
            if (qId !== this.hoveredId) {
                this.callbacks.onHoverPointcloud?.(qId);
            }
        } else {
            this.domElement.style.cursor = "auto";
            if (this.hoveredId !== null) {
                this.callbacks.onHoverPointcloud?.(null);
            }
        }
    }

    private onClick(event: MouseEvent): void {
        const instanceId = this.getIntersectedInstanceId(event);
        if (instanceId !== null && this.queries[instanceId]) {
            const query = this.queries[instanceId];
            this.callbacks.onSelectPointcloud?.(query.id);
        }
    }

    private onDblClick(event: MouseEvent): void {
        const instanceId = this.getIntersectedInstanceId(event);
        if (instanceId !== null && this.queries[instanceId]) {
            const query = this.queries[instanceId];
            this.callbacks.onSelectPointcloud?.(query.id);

            const center = getBoundingBoxCenter(this.summaryMap[query.id]) || [TARGET_X, TARGET_Y, 0];
            this.callbacks.onFocusCameraTarget?.(center);
        }
    }

    public destroy(): void {
        this.domElement.removeEventListener("pointermove", this.boundOnPointerMove);
        this.domElement.removeEventListener("click", this.boundOnClick);
        this.domElement.removeEventListener("dblclick", this.boundOnDblClick);

        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh);
            this.instancedMesh.dispose();
            this.instancedMesh = null;
        }
        this.geometry.dispose();
        this.material.dispose();
    }
}
