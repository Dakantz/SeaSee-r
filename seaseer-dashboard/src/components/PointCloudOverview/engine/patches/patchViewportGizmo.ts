import * as THREE from "three";
import { ViewportGizmo } from "three-viewport-gizmo";

let isPatched = false;

interface GizmoAnimState {
    startTime: number;
    duration: number;
    targetPos: THREE.Vector3;
    targetQuat: THREE.Quaternion;
    targetUp: THREE.Vector3;
    startQuatPos: THREE.Quaternion;
    endQuatPos: THREE.Quaternion;
    startQuatRot: THREE.Quaternion;
    endQuatRot: THREE.Quaternion;
}

const _tempQuat = new THREE.Quaternion();

/**
 * Patches ViewportGizmo to fix axis click animation cut-offs and support Z-Up coordinate space:
 * 1. Checks both position distance and orientation slerp to prevent premature animation termination.
 * 2. Uses adaptive Z-Up lookAt so vertical views (+Z Top, -Z Bottom) don't become degenerate or misaligned.
 * 3. Enforces a smooth cubic ease-out transition that guarantees an exact final snap to the target transform and up vector.
 */
export function patchViewportGizmo(): void {
    if (isPatched) return;
    isPatched = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = ViewportGizmo.prototype as any;

    /**
     * Coordinate conversion for Z-Up coordinate spaces
     */
    proto.coordinateConversion = function (t: THREE.Vector3, n: boolean = false): THREE.Vector3 {
        const { x: i, y: o, z: a } = t;
        return n ? t.set(a, i, o) : t.set(o, a, i);
    };

    /**
     * Sets target orientation and initiates smooth synchronized animation
     */
    proto._setOrientation = function (t: THREE.Vector3): void {
        const camera = this.camera as THREE.PerspectiveCamera;
        const target = this.target as THREE.Vector3;

        if (!this._distance || this._distance <= 0) {
            this._distance = camera.position.distanceTo(target) || 100;
        }

        const targetCamPos = t.clone().normalize().multiplyScalar(this._distance).add(target);
        const targetDir = new THREE.Vector3().subVectors(target, targetCamPos).normalize();
        const targetUp = Math.abs(targetDir.z) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

        const matEnd = new THREE.Matrix4().setPosition(targetCamPos).lookAt(targetCamPos, target, targetUp);
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(matEnd);

        this._targetQuaternion.copy(targetQuat);
        this._quaternionEnd.copy(targetQuat);

        const currentDir = new THREE.Vector3().subVectors(target, camera.position).normalize();
        const currentUp = Math.abs(currentDir.z) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        const matStart = new THREE.Matrix4().setPosition(camera.position).lookAt(camera.position, target, currentUp);
        const startQuatPos = new THREE.Quaternion().setFromRotationMatrix(matStart);
        this._quaternionStart.copy(startQuatPos);

        const isPosAtTarget = camera.position.distanceTo(targetCamPos) < 1e-4;
        const isRotAtTarget = camera.quaternion.angleTo(targetQuat) < 1e-4;

        if (!this.animated || (isPosAtTarget && isRotAtTarget)) {
            camera.position.copy(targetCamPos);
            camera.quaternion.copy(targetQuat);
            camera.up.copy(targetUp);
            this._updateOrientation();
            this.animating = false;
            this._animState = null;
            this.dispatchEvent({ type: "change" });
            this.dispatchEvent({ type: "end" });
            return;
        }

        const duration = 0.45 / Math.max(0.1, this.speed || 1);

        this._animState = {
            startTime: performance.now() / 1000,
            duration,
            targetPos: targetCamPos,
            targetQuat,
            targetUp,
            startQuatPos,
            endQuatPos: targetQuat.clone(),
            startQuatRot: camera.quaternion.clone(),
            endQuatRot: targetQuat.clone(),
        };

        this.animating = true;
        this._clock.start();
        this.dispatchEvent({ type: "start" });
    };

    /**
     * Animation step running on every render frame
     */
    proto._animate = function (): void {
        const camera = this.camera as THREE.PerspectiveCamera;
        const anim: GizmoAnimState | null = this._animState;

        if (!anim) {
            if (this.animating) {
                this.animating = false;
                this.dispatchEvent({ type: "end" });
            }
            return;
        }

        if (this._controls) {
            this._controls.enabled = false;
        }

        const now = performance.now() / 1000;
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.duration);
        const easeT = 1 - Math.pow(1 - progress, 3); // Cubic ease-out

        // Slerp along spherical orbital arc around target
        _tempQuat.slerpQuaternions(anim.startQuatPos, anim.endQuatPos, easeT);
        camera.position.set(0, 0, 1)
            .applyQuaternion(_tempQuat)
            .multiplyScalar(this._distance)
            .add(this.target);
        this._quaternionStart.copy(_tempQuat);

        // Slerp camera orientation smoothly
        camera.quaternion.slerpQuaternions(anim.startQuatRot, anim.endQuatRot, easeT);

        this._updateOrientation();
        requestAnimationFrame(() => this.dispatchEvent({ type: "change" }));

        if (progress >= 1) {
            camera.position.copy(anim.targetPos);
            camera.quaternion.copy(anim.targetQuat);
            camera.up.copy(anim.targetUp);
            this._quaternionStart.copy(anim.endQuatPos);

            this._updateOrientation();
            if (this._controls) {
                this._controls.enabled = true;
            }
            this.animating = false;
            this._animState = null;
            this.dispatchEvent({ type: "change" });
            this.dispatchEvent({ type: "end" });
        }
    };
}
