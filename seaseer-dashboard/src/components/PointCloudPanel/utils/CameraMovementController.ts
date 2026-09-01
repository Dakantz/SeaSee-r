import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePLYPointCloudContext, type CameraViewTarget } from "../PLYPointCloudContext";

export const TARGET_X = 1622520.9730428709;
export const TARGET_Y = -5522707.795739262;

export function getHeightFactor(z: number): number {
    return Math.max(0.1, Math.abs(z) / 1000);
}

const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _tmpVecForward = new THREE.Vector3();
const _tmpVecRight = new THREE.Vector3();
const _tmpVecUp = new THREE.Vector3();
const _tmpVecDir = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

export interface FocusTarget {
    x: number;
    y: number;
    z: number;
    offset?: [number, number, number] | number;
    timestamp?: number;
}

export class CameraMovementController {
    public isFixedUp: boolean = false;
    private camera: THREE.Camera;
    private domElement: HTMLElement | null = null;
    private getIsGizmoDragging: () => boolean;

    private isDragging: boolean = false;
    private dragButton: number | null = null;
    private previousMouse = { x: 0, y: 0 };
    private keysPressed: Record<string, boolean> = {};
    private initialized: boolean = false;

    private animState: {
        startTime: number;
        duration: number;
        startPos: THREE.Vector3;
        targetCamPos: THREE.Vector3;
        targetCenter: THREE.Vector3;
    } | null = null;

    private viewAnimState: {
        startTime: number;
        duration: number;
        startPos: THREE.Vector3;
        targetPos: THREE.Vector3;
        startQuat: THREE.Quaternion;
        targetQuat: THREE.Quaternion;
        startFov: number;
        targetFov: number;
    } | null = null;

    // Bound event handlers
    private onPointerDownBound: (e: PointerEvent) => void;
    private onPointerMoveBound: (e: PointerEvent) => void;
    private onPointerUpBound: () => void;
    private onWheelBound: (e: WheelEvent) => void;
    private onContextMenuBound: (e: MouseEvent) => void;
    private onKeyDownBound: (e: KeyboardEvent) => void;
    private onKeyUpBound: (e: KeyboardEvent) => void;
    private onTouchStartBound: () => void;

    constructor(camera: THREE.Camera, getIsGizmoDragging: () => boolean = () => false) {
        this.camera = camera;
        this.getIsGizmoDragging = getIsGizmoDragging;

        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerUpBound = this.onPointerUp.bind(this);
        this.onWheelBound = this.onWheel.bind(this);
        this.onContextMenuBound = this.onContextMenu.bind(this);
        this.onKeyDownBound = this.onKeyDown.bind(this);
        this.onKeyUpBound = this.onKeyUp.bind(this);
        this.onTouchStartBound = this.onTouchStart.bind(this);
    }

    public updateIsGizmoDraggingGetter(getter: () => boolean): void {
        this.getIsGizmoDragging = getter;
        if (getter()) {
            this.isDragging = false;
            this.dragButton = null;
        }
    }

    public initDefaultCameraView(): void {
        if (!this.initialized) {
            this.camera.up.set(0, 0, 1);
            this.camera.lookAt(TARGET_X, TARGET_Y, 0);
            this.initialized = true;
        }
    }

    public attach(domElement: HTMLElement): void {
        if (this.domElement === domElement) return;
        this.detach();

        this.domElement = domElement;
        this.initDefaultCameraView();

        domElement.addEventListener("pointerdown", this.onPointerDownBound);
        window.addEventListener("pointermove", this.onPointerMoveBound);
        window.addEventListener("pointerup", this.onPointerUpBound);
        domElement.addEventListener("wheel", this.onWheelBound, { passive: false });
        domElement.addEventListener("contextmenu", this.onContextMenuBound);
        window.addEventListener("keydown", this.onKeyDownBound);
        window.addEventListener("keyup", this.onKeyUpBound);
        domElement.addEventListener("touchstart", this.onTouchStartBound, { passive: true });
    }

    public detach(): void {
        if (!this.domElement) return;

        this.domElement.removeEventListener("pointerdown", this.onPointerDownBound);
        window.removeEventListener("pointermove", this.onPointerMoveBound);
        window.removeEventListener("pointerup", this.onPointerUpBound);
        this.domElement.removeEventListener("wheel", this.onWheelBound);
        this.domElement.removeEventListener("contextmenu", this.onContextMenuBound);
        window.removeEventListener("keydown", this.onKeyDownBound);
        window.removeEventListener("keyup", this.onKeyUpBound);
        this.domElement.removeEventListener("touchstart", this.onTouchStartBound);

        this.domElement = null;
    }

    public stopAnimations(): void {
        this.animState = null;
        this.viewAnimState = null;
    }

    public focusOnTarget(targetCenter: THREE.Vector3, customOffset?: [number, number, number] | number): void {
        let offsetVec = new THREE.Vector3(0, -150, 150);
        if (customOffset !== undefined) {
            if (Array.isArray(customOffset)) {
                offsetVec = new THREE.Vector3(...customOffset);
            } else if (typeof customOffset === "number") {
                offsetVec = new THREE.Vector3(0, -customOffset, customOffset);
            }
        }
        const targetCamPos = targetCenter.clone().add(offsetVec);

        this.viewAnimState = null;
        this.animState = {
            startTime: performance.now() / 1000,
            duration: 0.6,
            startPos: this.camera.position.clone(),
            targetCamPos,
            targetCenter: targetCenter.clone(),
        };
    }

    public setCameraViewTarget(viewTarget: CameraViewTarget): void {
        const { position, quaternion, fov } = viewTarget;
        const targetPos = new THREE.Vector3(...position);

        let targetQuat: THREE.Quaternion;
        if (quaternion && quaternion.length === 4) {
            targetQuat = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
        } else {
            targetQuat = this.camera.quaternion.clone();
        }

        const perspCam = this.camera as THREE.PerspectiveCamera;
        const startFov = perspCam.fov ?? 60;
        const targetFov = fov ?? startFov;

        this.animState = null;
        this.viewAnimState = {
            startTime: performance.now() / 1000,
            duration: 0.6,
            startPos: this.camera.position.clone(),
            targetPos,
            startQuat: this.camera.quaternion.clone(),
            targetQuat,
            startFov,
            targetFov,
        };
    }

    public update(delta: number): void {
        // 1. Process active smooth animation state
        if (this.animState) {
            const { startTime, duration, startPos, targetCamPos, targetCenter } = this.animState;
            const now = performance.now() / 1000;
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const easeT = 1 - Math.pow(1 - progress, 3);

            this.camera.position.lerpVectors(startPos, targetCamPos, easeT);
            this.camera.up.set(0, 0, 1);
            this.camera.lookAt(targetCenter);

            if (progress >= 1) {
                this.camera.position.copy(targetCamPos);
                this.camera.up.set(0, 0, 1);
                this.camera.lookAt(targetCenter);
                this.animState = null;
            }
            return;
        }

        if (this.viewAnimState) {
            const { startTime, duration, startPos, targetPos, startQuat, targetQuat, startFov, targetFov } = this.viewAnimState;
            const now = performance.now() / 1000;
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const easeT = 1 - Math.pow(1 - progress, 3);

            this.camera.position.lerpVectors(startPos, targetPos, easeT);
            this.camera.quaternion.slerpQuaternions(startQuat, targetQuat, easeT);

            const perspCam = this.camera as THREE.PerspectiveCamera;
            if (perspCam.fov !== undefined && startFov !== targetFov) {
                perspCam.fov = THREE.MathUtils.lerp(startFov, targetFov, easeT);
                perspCam.updateProjectionMatrix();
            }

            if (progress >= 1) {
                this.camera.position.copy(targetPos);
                this.camera.quaternion.copy(targetQuat);
                if (perspCam.fov !== undefined && targetFov) {
                    perspCam.fov = targetFov;
                    perspCam.updateProjectionMatrix();
                }
                this.viewAnimState = null;
            }
            return;
        }

        // 2. Process active WASDQE keyboard movement
        if (this.getIsGizmoDragging()) return;

        if (
            document.activeElement &&
            (document.activeElement.tagName === "INPUT" ||
                document.activeElement.tagName === "TEXTAREA" ||
                document.activeElement.tagName === "SELECT")
        ) {
            return;
        }

        const isShift = this.keysPressed["ShiftLeft"];
        const heightFactor = getHeightFactor(this.camera.position.z);
        const moveSpeed = (isShift ? 3000 : 800) * heightFactor * delta;

        this.camera.getWorldDirection(_tmpVecForward);
        const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);

        if (this.keysPressed["KeyW"]) {
            this.camera.position.addScaledVector(_tmpVecForward, moveSpeed);
        }
        if (this.keysPressed["KeyS"]) {
            this.camera.position.addScaledVector(_tmpVecForward, -moveSpeed);
        }
        if (this.keysPressed["KeyA"]) {
            this.camera.position.addScaledVector(right, -moveSpeed);
        }
        if (this.keysPressed["KeyD"]) {
            this.camera.position.addScaledVector(right, moveSpeed);
        }
        if (this.keysPressed["KeyE"]) {
            this.camera.position.addScaledVector(up, moveSpeed);
        }
        if (this.keysPressed["KeyQ"]) {
            this.camera.position.addScaledVector(up, -moveSpeed);
        }
    }

    private onPointerDown(e: PointerEvent): void {
        this.stopAnimations();
        if (this.getIsGizmoDragging()) return;
        this.isDragging = true;
        this.dragButton = e.button;
        this.previousMouse = { x: e.clientX, y: e.clientY };
    }

    private onPointerMove(e: PointerEvent): void {
        if (this.getIsGizmoDragging() || !this.isDragging) return;

        const deltaX = e.clientX - this.previousMouse.x;
        const deltaY = e.clientY - this.previousMouse.y;
        this.previousMouse = { x: e.clientX, y: e.clientY };

        if (this.dragButton === 0) {
            // Left click: Rotate around current camera position using quaternions
            const rotateSpeed = 0.003;

            if (this.isFixedUp) {
                // Fixed +Z Up mode: Yaw around global +Z axis, Pitch around local Right axis
                const worldUp = _tmpVecUp.set(0, 0, 1);
                _qYaw.setFromAxisAngle(worldUp, -deltaX * rotateSpeed);

                const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
                _qPitch.setFromAxisAngle(right, -deltaY * rotateSpeed);

                const candidateQuat = _tmpQuat.copy(this.camera.quaternion).premultiply(_qPitch).premultiply(_qYaw).normalize();
                const candidateUpZ = _tmpVecUp.set(0, 1, 0).applyQuaternion(candidateQuat).z;

                if (candidateUpZ >= 0.001) {
                    this.camera.quaternion.copy(candidateQuat);
                } else {
                    const yawOnlyQuat = _tmpQuat.copy(this.camera.quaternion).premultiply(_qYaw).normalize();
                    if (_tmpVecUp.set(0, 1, 0).applyQuaternion(yawOnlyQuat).z >= 0.001) {
                        this.camera.quaternion.copy(yawOnlyQuat);
                    }
                }
            } else {
                // Free rotating mode (default): Yaw around local camera Up-axis
                const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
                _qYaw.setFromAxisAngle(up, -deltaX * rotateSpeed);

                const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
                _qPitch.setFromAxisAngle(right, -deltaY * rotateSpeed);

                this.camera.quaternion.premultiply(_qPitch).premultiply(_qYaw).normalize();
            }
        } else if (this.dragButton === 2 || this.dragButton === 1) {
            // Right or middle click: Pan camera position
            const heightFactor = getHeightFactor(this.camera.position.z);
            const panSpeed = 2.0 * heightFactor;
            const right = _tmpVecRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const up = _tmpVecUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);

            right.z = 0;
            up.z = 0;
            if (right.lengthSq() > 0) right.normalize();
            if (up.lengthSq() > 0) up.normalize();

            this.camera.position.addScaledVector(right, -deltaX * panSpeed);
            this.camera.position.addScaledVector(up, deltaY * panSpeed);
        }
    }

    private onPointerUp(): void {
        this.isDragging = false;
        this.dragButton = null;
    }

    private onWheel(e: WheelEvent): void {
        this.stopAnimations();
        if (this.getIsGizmoDragging()) return;
        e.preventDefault();
        const heightFactor = getHeightFactor(this.camera.position.z);
        const zoomSpeed = 1.0 * heightFactor;
        this.camera.getWorldDirection(_tmpVecDir);

        const moveDistance = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * zoomSpeed;
        this.camera.position.addScaledVector(_tmpVecDir, moveDistance);
    }

    private onContextMenu(e: MouseEvent): void {
        e.preventDefault();
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (
            document.activeElement &&
            (document.activeElement.tagName === "INPUT" ||
                document.activeElement.tagName === "TEXTAREA" ||
                document.activeElement.tagName === "SELECT")
        ) {
            return;
        }

        const navKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"];
        if (navKeys.includes(e.code)) {
            this.stopAnimations();
        }

        if (this.getIsGizmoDragging()) return;
        this.keysPressed[e.code] = true;
    }

    private onKeyUp(e: KeyboardEvent): void {
        this.keysPressed[e.code] = false;
    }

    private onTouchStart(): void {
        this.stopAnimations();
    }
}

/**
 * React Component wrapper for R3F integration
 */
export function CameraMovementSystem() {
    const { camera, gl } = useThree();
    const { isGizmoDragging, cameraTarget, cameraViewTarget, isCameraUpFixed } = usePLYPointCloudContext();

    const controllerRef = useRef<CameraMovementController | null>(null);

    if (!controllerRef.current) {
        controllerRef.current = new CameraMovementController(camera, () => isGizmoDragging);
    }

    useEffect(() => {
        if (controllerRef.current) {
            controllerRef.current.isFixedUp = isCameraUpFixed;
        }
    }, [isCameraUpFixed]);

    useEffect(() => {
        controllerRef.current?.updateIsGizmoDraggingGetter(() => isGizmoDragging);
    }, [isGizmoDragging]);

    useEffect(() => {
        const controller = controllerRef.current;
        if (!controller || !gl.domElement) return;

        controller.attach(gl.domElement);

        return () => {
            controller.detach();
        };
    }, [gl.domElement]);

    useEffect(() => {
        if (!cameraTarget || !controllerRef.current) return;
        const { x, y, z, offset } = cameraTarget;
        if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
            const targetCenter = new THREE.Vector3(x, y, z);
            controllerRef.current.focusOnTarget(targetCenter, offset);
        }
    }, [cameraTarget]);

    useEffect(() => {
        if (!cameraViewTarget || !controllerRef.current) return;
        controllerRef.current.setCameraViewTarget(cameraViewTarget);
    }, [cameraViewTarget]);

    useFrame((_, delta) => {
        controllerRef.current?.update(delta);
    });

    return null;
}
