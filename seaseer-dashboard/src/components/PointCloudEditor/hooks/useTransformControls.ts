import { useEffect, useRef } from 'react';

import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { useViewerContext } from '../ViewerContext';
import { updateTransform } from '../../../client/sdk.gen';

export const useTransformControls = (gizmoMode: 'translate' | 'rotate' | 'scale' | null, editingPointcloudId: string | null) => {
    const { viewer } = useViewerContext();
    const transformControlRef = useRef<TransformControls | null>(null);

    useEffect(() => {
        if (!viewer || !viewer.scene || !viewer.scene.scene || !viewer.renderer) return;

        // Initialize TransformControls if not already done
        if (!transformControlRef.current) {
            const camera = viewer.scene.getActiveCamera();
            const renderer = viewer.renderer;
            const domElement = viewer.renderArea || renderer.domElement;
            const control = new TransformControls(camera, domElement);
            
            // Potree's input handler uses bubbling events and often stops propagation.
            // We need TransformControls to intercept pointer events in the capture phase.
            domElement.removeEventListener('pointerdown', (control as any)._onPointerDown);
            domElement.removeEventListener('pointermove', (control as any)._onPointerHover);
            domElement.removeEventListener('pointerup', (control as any)._onPointerUp);

            domElement.addEventListener('pointerdown', (e: Event) => {
                const c = control as any;
                if (c.object) {
                    c.getHelper().updateMatrixWorld(true);
                    c.camera.updateMatrixWorld(true);
                }
                c._onPointerDown(e);
                console.log("[TransformControls Debug] pointerdown axis:", c.axis, "pointer:", c._getPointer ? c._getPointer(e) : "no _getPointer");
                if (c.axis !== null) {
                    e.stopPropagation();
                }
            }, { capture: true });

            domElement.addEventListener('pointermove', (e: Event) => {
                const c = control as any;
                if (c.object) {
                    c.getHelper().updateMatrixWorld(true);
                    c.camera.updateMatrixWorld(true);
                }
                c._onPointerHover(e);
                
                if (c.dragging) {
                    c._onPointerMove(e);
                    e.stopPropagation();
                }
            }, { capture: true });

            domElement.addEventListener('pointerup', (e: Event) => {
                console.log("[TransformControls Debug] pointerup event", e);
                (control as any)._onPointerUp(e);
            }, { capture: true });

            console.log("control", control);

            control.addEventListener('dragging-changed', (event: any) => {
                console.log("dragging-changed", event);
                // Disable Potree controls when dragging gizmo
                if (viewer.getControls()) {
                    viewer.getControls().enabled = !event.value;
                }
                if (viewer.orbitControls) viewer.orbitControls.enabled = !event.value;
                if (viewer.earthControls) viewer.earthControls.enabled = !event.value;
                if (viewer.fpControls) viewer.fpControls.enabled = !event.value;

                if (viewer.inputHandler) {
                    viewer.inputHandler.enabled = !event.value;
                }

                // If dragging stopped, save the matrix
                if (!event.value && control.object) {
                    const pointcloud = control.object;
                    pointcloud.updateMatrix();
                    const matrixArray = pointcloud.matrix.toArray();

                    if (editingPointcloudId) {
                        updateTransform({
                            path: { id: editingPointcloudId },
                            body: { matrix: matrixArray }
                        }).then((res: any) => {
                            if (res.error) console.error('Failed to save transform', res.error);
                        }).catch((err: any) => console.error('Error saving transform', err));
                    }
                }
            });

            control.addEventListener('change', () => {
                // TransformControls modifies object.position/rotation/scale.
                // We need to tell Potree to redraw the frame since the camera isn't moving.
                if (control.object) {
                    control.object.updateMatrixWorld(true);
                }
                // Force a render in Potree
                if (viewer.setNeedsRedraw) {
                    viewer.setNeedsRedraw();
                }
            });

            viewer.scene.scene.add(control.getHelper());
            transformControlRef.current = control;
        }

        const control = transformControlRef.current;

        // Update control mode or detach based on state
        if (gizmoMode && editingPointcloudId) {
            control.setMode(gizmoMode);

            // Find the correct pointcloud in Potree scene
            let targetPc: any = null;
            const pcs = viewer.scene.pointclouds;
            for (let i = 0; i < pcs.length; i++) {
                if (pcs[i].name === editingPointcloudId || (pcs[i].pcoGeometry && pcs[i].pcoGeometry.url && pcs[i].pcoGeometry.url.includes(editingPointcloudId))) {
                    targetPc = pcs[i];
                    break;
                }
            }

            if (targetPc && control.object !== targetPc) {
                control.attach(targetPc);
            } else if (!targetPc) {
                // Wait for the point cloud to load
                control.detach();
            }
            control.enabled = true;
            control.getHelper().visible = true;
        } else {
            control.detach();
            control.enabled = false;
            control.getHelper().visible = false;
        }

        let animationFrameId: number;
        const updateLoop = () => {
            if (transformControlRef.current && viewer) {
                // Ensure TransformControls is using the currently active camera from Potree
                transformControlRef.current.camera = viewer.scene.getActiveCamera();
            }
            animationFrameId = requestAnimationFrame(updateLoop);
        };
        updateLoop();

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            // Internal cleanup if necessary
        };
    }, [viewer, editingPointcloudId, gizmoMode]);

    // Cleanup when component unmounts entirely
    useEffect(() => {
        return () => {
            if (transformControlRef.current) {
                transformControlRef.current.detach();
                const helper = transformControlRef.current.getHelper();
                if (helper.parent) {
                    helper.parent.remove(helper);
                }
                transformControlRef.current.dispose();
            }
        };
    }, []);
};
