import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EngineCallbacks, EngineConfig } from "../types";
import { getPointCloudTransform } from "../../../PointCloudPanel/utils/pointCloudTransform";

export class TransformGizmoSystem {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private domElement: HTMLElement;
    private callbacks: EngineCallbacks;

    private transformControls: TransformControls | null = null;
    private pivotGroup: THREE.Group;
    private activeTargetId: string | null = null;

    private editingPointcloudId: string | null = null;
    private gizmoMode: "translate" | "rotate" | "scale" | null = null;
    private summaryMap: Record<string, any> = {};
    private catalog: any[] = [];

    private boundMouseDown: () => void;
    private boundMouseUp: () => void;
    private boundObjectChange: () => void;

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

        this.pivotGroup = new THREE.Group();
        this.pivotGroup.name = "GizmoPivotGroup";
        this.scene.add(this.pivotGroup);

        this.boundMouseDown = this.onMouseDown.bind(this);
        this.boundMouseUp = this.onMouseUp.bind(this);
        this.boundObjectChange = this.onObjectChange.bind(this);

        this.initControls();
        this.updateConfig(config);
    }

    private initControls(): void {
        if (this.transformControls) {
            this.transformControls.detach();
            this.scene.remove(this.transformControls.getHelper());
            this.transformControls.dispose();
        }

        this.transformControls = new TransformControls(this.camera, this.domElement);
        this.scene.add(this.transformControls.getHelper());

        this.transformControls.addEventListener("mouseDown", this.boundMouseDown);
        this.transformControls.addEventListener("mouseUp", this.boundMouseUp);
        this.transformControls.addEventListener("objectChange", this.boundObjectChange);
    }

    public setCamera(camera: THREE.Camera): void {
        this.camera = camera;
        if (this.transformControls) {
            this.initControls();
            this.syncGizmoState();
        }
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        let dirty = false;

        if (config.editingPointcloudId !== undefined) {
            this.editingPointcloudId = config.editingPointcloudId;
            dirty = true;
        }
        if (config.gizmoMode !== undefined) {
            this.gizmoMode = config.gizmoMode;
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
            this.syncGizmoState();
        }
    }

    private syncGizmoState(): void {
        if (!this.transformControls) return;

        if (!this.editingPointcloudId || !this.gizmoMode) {
            this.transformControls.detach();
            this.activeTargetId = null;
            return;
        }

        this.activeTargetId = this.editingPointcloudId;
        this.transformControls.setMode(this.gizmoMode);

        // Retrieve initial transformation matrix (M_world) and center point (c)
        const { matrixArr, center } = getPointCloudTransform(this.activeTargetId, this.summaryMap, this.catalog);
        const [cx, cy, cz] = center;

        const matWorld = (matrixArr && matrixArr.length === 16)
            ? new THREE.Matrix4().fromArray(matrixArr)
            : new THREE.Matrix4().identity();

        // Calculate pivot matrix: M_pivot = T(-c) * M_world * T(c)
        const Tc = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        const T_neg_c = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz);
        const matPivot = T_neg_c.clone().multiply(matWorld).multiply(Tc);

        matPivot.decompose(this.pivotGroup.position, this.pivotGroup.quaternion, this.pivotGroup.scale);
        this.pivotGroup.updateMatrix();

        this.transformControls.attach(this.pivotGroup);
    }

    private onMouseDown(): void {
        this.callbacks.onSetIsGizmoDragging?.(true);
    }

    private onObjectChange(): void {
        this.pivotGroup.updateMatrix();
    }

    private onMouseUp(): void {
        this.callbacks.onSetIsGizmoDragging?.(false);

        if (!this.activeTargetId) return;

        this.pivotGroup.updateMatrix();

        const { center } = getPointCloudTransform(this.activeTargetId, this.summaryMap, this.catalog);
        const [cx, cy, cz] = center;

        // Convert pivot delta matrix (matPivot) back to full world matrix (matWorld):
        // Formula: M_world = T(c) * M_pivot * T(-c)
        const matPivot = this.pivotGroup.matrix;
        const Tc = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        const T_neg_c = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz);
        const matWorld = Tc.clone().multiply(matPivot).multiply(T_neg_c);

        const matrixArray = matWorld.toArray();
        this.callbacks.onUpdatePointcloudTransform?.(this.activeTargetId, matrixArray);
    }

    public destroy(): void {
        if (this.transformControls) {
            this.transformControls.removeEventListener("mouseDown", this.boundMouseDown);
            this.transformControls.removeEventListener("mouseUp", this.boundMouseUp);
            this.transformControls.removeEventListener("objectChange", this.boundObjectChange);
            this.transformControls.detach();
            this.scene.remove(this.transformControls.getHelper());
            this.transformControls.dispose();
            this.transformControls = null;
        }

        this.scene.remove(this.pivotGroup);
        this.pivotGroup.clear();
        this.activeTargetId = null;
    }
}
