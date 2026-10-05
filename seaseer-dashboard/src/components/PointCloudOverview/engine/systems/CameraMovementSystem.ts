import * as THREE from "three";
import type { CameraViewTarget } from "../types";

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

export class CameraMovementSystem {
    public isFixedUp: boolean = false;
    private camera: THREE.PerspectiveCamera;
    private domElement: HTMLElement | null = null;

    private enabled: boolean = true;
    private isGizmoDragging: boolean = false;
    private isDragging: boolean = false;
    private dragButton: number | null = null;
    private previousMouse = { x: 0, y: 0 };
    private keysPressed: Record<string, boolean> = {};

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

    // Bound event listeners
    private onPointerDownBound: (e: PointerEvent) => void;
    private onPointerMoveBound: (e: PointerEvent) => void;
    private onPointerUpBound: () => void;
    private onWheelBound: (e: WheelEvent) => void;
    private onContextMenuBound: (e: MouseEvent) => void;
    private onKeyDownBound: (e: KeyboardEvent) => void;
    private onKeyUpBound: (e: KeyboardEvent) => void;
    private onTouchStartBound: () => void;

    constructor(camera: THREE.PerspectiveCamera, domElement?: HTMLElement) {
        this.camera = camera;

        this.onPointerDownBound = this.onPointerDown.bind(this);
        this.onPointerMoveBound = this.onPointerMove.bind(this);
        this.onPointerUpBound = this.onPointerUp.bind(this);
        this.onWheelBound = this.onWheel.bind(this);
        this.onContextMenuBound = this.onContextMenu.bind(this);
        this.onKeyDownBound = this.onKeyDown.bind(this);
        this.onKeyUpBound = this.onKeyUp.bind(this);
        this.onTouchStartBound = this.onTouchStart.bind(this);

        if (domElement) {
            this.attach(domElement);
        }
    }

    public attach(domElement: HTMLElement): void {
        if (this.domElement === domElement) return;
        this.detach();

        this.domElement = domElement;

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
        this.isDragging = false;
        this.dragButton = null;
        this.keysPressed = {};
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.isDragging = false;
            this.dragButton = null;
            this.keysPressed = {};
        }
    }

    public setIsGizmoDragging(dragging: boolean): void {
        this.isGizmoDragging = dragging;
        if (dragging) {
            this.isDragging = false;
            this.dragButton = null;
        }
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
        if (!viewTarget.position) return;
        const targetPos = new THREE.Vector3(...viewTarget.position);

        let targetQuat: THREE.Quaternion;
        if (viewTarget.quaternion && viewTarget.quaternion.length === 4) {
            targetQuat = new THREE.Quaternion(
                viewTarget.quaternion[0],
                viewTarget.quaternion[1],
                viewTarget.quaternion[2],
                viewTarget.quaternion[3]
            );
        } else {
            targetQuat = this.camera.quaternion.clone();
        }

        const startFov = this.camera.fov ?? 60;
        const targetFov = viewTarget.fov ?? startFov;

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

            if (startFov !== targetFov) {
                this.camera.fov = THREE.MathUtils.lerp(startFov, targetFov, easeT);
                this.camera.updateProjectionMatrix();
            }

            if (progress >= 1) {
                this.camera.position.copy(targetPos);
                this.camera.quaternion.copy(targetQuat);
                if (targetFov) {
                    this.camera.fov = targetFov;
                    this.camera.updateProjectionMatrix();
                }
                this.viewAnimState = null;
            }
            return;
        }

        // 2. Process active WASDQE keyboard movement
        if (!this.enabled || this.isGizmoDragging) return;

        if (
            document.activeElement &&
            (document.activeElement.tagName === "INPUT" ||
                document.activeElement.tagName === "TEXTAREA" ||
                document.activeElement.tagName === "SELECT")
        ) {
            return;
        }

        const isShift = this.keysPressed["ShiftLeft"] || this.keysPressed["ShiftRight"];
        const heightFactor = getHeightFactor(this.camera.position.z);
        const moveSpeed = (isShift ? 1000 : 100) * heightFactor * delta;

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
        if (!this.enabled || this.isGizmoDragging) return;
        this.isDragging = true;
        this.dragButton = e.button;
        this.previousMouse = { x: e.clientX, y: e.clientY };
    }

    private onPointerMove(e: PointerEvent): void {
        if (!this.enabled || this.isGizmoDragging || !this.isDragging) return;

        const deltaX = e.clientX - this.previousMouse.x;
        const deltaY = e.clientY - this.previousMouse.y;
        this.previousMouse = { x: e.clientX, y: e.clientY };

        if (this.dragButton === 2) {
            // Right click: Rotate around current camera position using quaternions
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
        } else if (this.dragButton === 0 || this.dragButton === 1) {
            // Left or middle click: Pan camera position
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
        if (!this.enabled || this.isGizmoDragging) return;
        e.preventDefault();
        const heightFactor = getHeightFactor(this.camera.position.z);
        const zoomSpeed = 1.0 * heightFactor;
        this.camera.getWorldDirection(_tmpVecDir);

        const moveDistance = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 10) * zoomSpeed;
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

        if (!this.enabled || this.isGizmoDragging) return;
        this.keysPressed[e.code] = true;
    }

    private onKeyUp(e: KeyboardEvent): void {
        this.keysPressed[e.code] = false;
    }

    private onTouchStart(): void {
        this.stopAnimations();
    }

    public destroy(): void {
        this.detach();
        this.stopAnimations();
    }
}
