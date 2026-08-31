import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ViewportGizmo } from "three-viewport-gizmo";
import { usePLYPointCloudContext } from "./PLYPointCloudContext";
import GizmoRollRing from "./GizmoRollRing";

const TARGET_X = 1622520.9730428709;
const TARGET_Y = -5522707.795739262;

export function ViewportGizmoHelper() {
    const { camera, gl } = useThree();
    const { setIsGizmoDragging, cameraTarget } = usePLYPointCloudContext();
    const gizmoRef = useRef<ViewportGizmo | null>(null);

    useEffect(() => {
        if (!camera || !gl) return;

        const container = gl.domElement.parentElement || document.body;

        const gizmo = new ViewportGizmo(camera, gl, {
            container,
            placement: "top-right",
            animated: true,
            size: 128,
            offset: {
                top: 25,
                right: 25,
            },
            y: { label: "Z" },
            z: { label: "Y" },
        });

        gizmo.target.set(TARGET_X, TARGET_Y, 0);
        gizmoRef.current = gizmo;

        const handleStart = () => setIsGizmoDragging(true);
        const handleEnd = () => setIsGizmoDragging(false);

        gizmo.addEventListener("start", handleStart);
        gizmo.addEventListener("end", handleEnd);

        // Filter pointerdown events on gizmo DOM element so clicking empty space inside the gizmo circle does nothing
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const gizmoAny = gizmo as any;
        const gizmoDom = gizmoAny._domElement as HTMLElement | undefined;

        const handleCaptureDown = (e: PointerEvent) => {
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
            gizmoDom.addEventListener("pointerdown", handleCaptureDown, true);
        }

        const handleResize = () => {
            gizmo.domUpdate();
        };
        window.addEventListener("resize", handleResize);

        const resizeObserver = new ResizeObserver(() => {
            gizmo.domUpdate();
        });
        resizeObserver.observe(container);
        if (gl.domElement && gl.domElement !== container) {
            resizeObserver.observe(gl.domElement);
        }

        return () => {
            window.removeEventListener("resize", handleResize);
            resizeObserver.disconnect();
            if (gizmoDom) {
                gizmoDom.removeEventListener("pointerdown", handleCaptureDown, true);
            }
            gizmo.removeEventListener("start", handleStart);
            gizmo.removeEventListener("end", handleEnd);
            gizmo.dispose();
            gizmoRef.current = null;
        };
    }, [camera, gl, setIsGizmoDragging]);

    // Declarative GizmoRollRing Overlay via ReactDOM createRoot on fixed 2D DOM container
    useEffect(() => {
        if (!gl || !camera) return;
        const container = gl.domElement.parentElement || document.body;

        const overlayDiv = document.createElement("div");
        overlayDiv.className = "gizmo-roll-ring-overlay-host";
        overlayDiv.style.position = "absolute";
        overlayDiv.style.top = "0";
        overlayDiv.style.right = "0";
        overlayDiv.style.pointerEvents = "none";
        overlayDiv.style.zIndex = "1010";
        container.appendChild(overlayDiv);

        const root = createRoot(overlayDiv);
        root.render(
            <GizmoRollRing
                camera={camera}
                onDragStateChange={setIsGizmoDragging}
                onCameraChange={() => gizmoRef.current?.cameraUpdate()}
            />
        );

        return () => {
            setTimeout(() => {
                root.unmount();
                overlayDiv.remove();
            }, 0);
        };
    }, [camera, gl, setIsGizmoDragging]);

    useEffect(() => {
        if (gizmoRef.current) {
            if (cameraTarget && typeof cameraTarget.x === "number") {
                gizmoRef.current.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
            } else {
                gizmoRef.current.target.set(TARGET_X, TARGET_Y, 0);
            }
        }
    }, [cameraTarget]);

    useFrame(({ gl, scene, camera }) => {
        if (gizmoRef.current) {
            gl.render(scene, camera);
            gizmoRef.current.cameraUpdate();
            gizmoRef.current.domUpdate();
            gizmoRef.current.render();
        }
    }, 1);

    return null;
}

export default ViewportGizmoHelper;
