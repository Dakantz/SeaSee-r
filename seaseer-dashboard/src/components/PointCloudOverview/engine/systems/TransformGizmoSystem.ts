import * as THREE from "three";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ViewportGizmo } from "three-viewport-gizmo";
import GizmoRollRing from "../../../PointCloudPanel/GizmoRollRing";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EngineCallbacks, EngineConfig } from "../types";
import { getPointCloudTransform } from "../../../PointCloudPanel/utils/pointCloudTransform";
import { TARGET_X, TARGET_Y } from "../PointCloudOverviewEngine";

export class TransformGizmoSystem {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera | THREE.Camera;
    private renderer: THREE.WebGLRenderer | null = null;
    private domElement: HTMLElement;
    private callbacks: EngineCallbacks;

    // ViewportGizmo & Roll Ring State
    private viewportGizmo: ViewportGizmo | null = null;
    private overlayRoot: Root | null = null;
    private overlayDiv: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private boundResize: (() => void) | null = null;
    private boundPointerDownCapture: ((e: PointerEvent) => void) | null = null;
    private isCameraUpFixed: boolean = false;
    private cameraTarget: { x: number; y: number; z: number } | null = null;

    // TransformControls State (Pointcloud editing)
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
        camera: THREE.PerspectiveCamera | THREE.Camera,
        rendererOrDom: THREE.WebGLRenderer | HTMLElement,
        callbacks: EngineCallbacks = {},
        config: Partial<EngineConfig> = {}
    ) {
        this.scene = scene;
        this.camera = camera;
        if (rendererOrDom instanceof THREE.WebGLRenderer) {
            this.renderer = rendererOrDom;
            this.domElement = rendererOrDom.domElement;
        } else {
            this.domElement = rendererOrDom;
        }
        this.callbacks = callbacks;

        // Initialize TransformControls pivot group
        this.pivotGroup = new THREE.Group();
        this.pivotGroup.name = "GizmoPivotGroup";
        this.scene.add(this.pivotGroup);

        this.boundMouseDown = this.onMouseDown.bind(this);
        this.boundMouseUp = this.onMouseUp.bind(this);
        this.boundObjectChange = this.onObjectChange.bind(this);

        this.initControls();
        this.initViewportGizmo();
        this.updateConfig(config);
    }

    private initViewportGizmo(): void {
        if (!this.camera || !this.renderer) return;

        const container = this.domElement.parentElement || this.domElement;

        const gizmo = new ViewportGizmo(this.camera as THREE.PerspectiveCamera, this.renderer, {
            container,
            placement: "top-right",
            animated: true,
            size: 128,
            offset: {
                top: 70,
                right: 25,
            },
        });

        if (this.cameraTarget && typeof this.cameraTarget.x === "number") {
            gizmo.target.set(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
        } else {
            gizmo.target.set(TARGET_X, TARGET_Y, 0);
        }

        const handleStart = () => this.callbacks.onSetIsGizmoDragging?.(true);
        const handleEnd = () => this.callbacks.onSetIsGizmoDragging?.(false);

        gizmo.addEventListener("start", handleStart);
        gizmo.addEventListener("end", handleEnd);

        // Filter pointerdown events on gizmo DOM element so clicking empty space inside the gizmo circle does nothing
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const gizmoAny = gizmo as any;
        const gizmoDom = gizmoAny._domElement as HTMLElement | undefined;

        this.boundPointerDownCapture = (e: PointerEvent) => {
            if (!gizmoDom || !gizmoAny._intersections || !gizmoAny._camera) return;

            const rect = gizmoDom.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, gizmoAny._camera);
            const intersects = raycaster.intersectObjects(gizmoAny._intersections, false);

            const hitAxis = intersects.length > 0 && intersects[0].object.visible;

            if (!hitAxis) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        };

        if (gizmoDom) {
            gizmoDom.addEventListener("pointerdown", this.boundPointerDownCapture, true);
        }

        this.boundResize = () => {
            gizmo.domUpdate();
        };
        window.addEventListener("resize", this.boundResize);

        this.resizeObserver = new ResizeObserver(() => {
            gizmo.domUpdate();
        });
        this.resizeObserver.observe(container);
        if (this.domElement && this.domElement !== container) {
            this.resizeObserver.observe(this.domElement);
        }

        this.viewportGizmo = gizmo;

        // Declarative GizmoRollRing Overlay via persistent ReactDOM Root container
        const overlayDiv = document.createElement("div");
        overlayDiv.className = "gizmo-roll-ring-overlay-host";
        overlayDiv.style.position = "absolute";
        overlayDiv.style.top = "0";
        overlayDiv.style.right = "0";
        overlayDiv.style.pointerEvents = "none";
        overlayDiv.style.zIndex = "1010";
        container.appendChild(overlayDiv);
        this.overlayDiv = overlayDiv;

        this.overlayRoot = createRoot(overlayDiv);
        this.renderRollRing();
    }

    private renderRollRing(): void {
        if (!this.overlayRoot || !this.camera) return;

        this.overlayRoot.render(
            React.createElement(GizmoRollRing, {
                className: "gizmo-roll-ring-container--overview",
                camera: this.camera,
                isFixedUp: this.isCameraUpFixed,
                onToggleFixedUp: () => {
                    this.isCameraUpFixed = !this.isCameraUpFixed;
                    this.callbacks.onToggleCameraUpFixed?.();
                    this.callbacks.onSetIsCameraUpFixed?.(this.isCameraUpFixed);
                    this.renderRollRing();
                },
                setIsCameraUpFixed: (fixed: boolean) => {
                    this.isCameraUpFixed = fixed;
                    this.callbacks.onSetIsCameraUpFixed?.(fixed);
                    this.renderRollRing();
                },
                onDragStateChange: (dragging: boolean) => {
                    this.callbacks.onSetIsGizmoDragging?.(dragging);
                },
                onCameraChange: () => {
                    this.viewportGizmo?.cameraUpdate();
                },
            })
        );
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

    public setCamera(camera: THREE.PerspectiveCamera | THREE.Camera): void {
        this.camera = camera;
        if (this.viewportGizmo) {
            (this.viewportGizmo as any).camera = camera;
            this.viewportGizmo.cameraUpdate();
        }
        this.renderRollRing();

        if (this.transformControls) {
            this.initControls();
            this.syncGizmoState();
        }
    }

    public updateConfig(config: Partial<EngineConfig>): void {
        let dirtyTransform = false;

        if (config.isCameraUpFixed !== undefined && config.isCameraUpFixed !== this.isCameraUpFixed) {
            this.isCameraUpFixed = config.isCameraUpFixed;
            this.renderRollRing();
        }

        if (config.cameraTarget !== undefined) {
            this.cameraTarget = config.cameraTarget;
            if (this.viewportGizmo) {
                if (this.cameraTarget && typeof this.cameraTarget.x === "number") {
                    this.viewportGizmo.target.set(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
                } else {
                    this.viewportGizmo.target.set(TARGET_X, TARGET_Y, 0);
                }
            }
        }

        if (config.editingPointcloudId !== undefined) {
            this.editingPointcloudId = config.editingPointcloudId;
            dirtyTransform = true;
        }
        if (config.gizmoMode !== undefined) {
            this.gizmoMode = config.gizmoMode;
            dirtyTransform = true;
        }
        if (config.summaryMap !== undefined) {
            this.summaryMap = config.summaryMap;
            dirtyTransform = true;
        }
        if (config.catalog !== undefined) {
            this.catalog = config.catalog;
            dirtyTransform = true;
        }

        if (dirtyTransform) {
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

        if (!this.activeTargetId) return;

        const { center } = getPointCloudTransform(this.activeTargetId, this.summaryMap, this.catalog);
        const [cx, cy, cz] = center;

        const matPivot = this.pivotGroup.matrix;
        const Tc = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        const T_neg_c = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz);
        const matWorld = Tc.clone().multiply(matPivot).multiply(T_neg_c);

        const matrixArray = matWorld.toArray();
        this.callbacks.onPreviewPointcloudTransform?.(this.activeTargetId, matrixArray);
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

    public render(): void {
        if (this.viewportGizmo) {
            this.viewportGizmo.cameraUpdate();
            this.viewportGizmo.domUpdate();
            this.viewportGizmo.render();
        }
    }

    public destroy(): void {
        if (this.boundResize) {
            window.removeEventListener("resize", this.boundResize);
            this.boundResize = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.viewportGizmo) {
            const gizmoAny = this.viewportGizmo as any;
            const gizmoDom = gizmoAny._domElement as HTMLElement | undefined;
            if (gizmoDom && this.boundPointerDownCapture) {
                gizmoDom.removeEventListener("pointerdown", this.boundPointerDownCapture, true);
                this.boundPointerDownCapture = null;
            }
            this.viewportGizmo.dispose();
            this.viewportGizmo = null;
        }

        if (this.overlayRoot) {
            const root = this.overlayRoot;
            const div = this.overlayDiv;
            setTimeout(() => {
                root.unmount();
                div?.remove();
            }, 0);
            this.overlayRoot = null;
            this.overlayDiv = null;
        }

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
