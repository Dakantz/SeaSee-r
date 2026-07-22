import { useEffect, useRef } from 'react';

import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { useViewerContext } from '../ViewerContext';
import { updateTransform } from '../../../client/sdk.gen';

export const useTransformControls = (gizmoMode: 'translate' | 'rotate' | 'scale' | null, editingPointcloudId: string | null) => {
    const { viewer, pointCloud } = useViewerContext();
    const transformControlRef = useRef<TransformControls | null>(null);
    const editingIdRef = useRef(editingPointcloudId);

    useEffect(() => {
        editingIdRef.current = editingPointcloudId;
    }, [editingPointcloudId]);

    useEffect(() => {
        if (!viewer || !viewer.scene || !viewer.scene.scene || !viewer.renderer) return;

        // Initialize TransformControls if not already done
        if (!transformControlRef.current) {
            const camera = viewer.scene.getActiveCamera();
            const renderer = viewer.renderer;
            const domElement = renderer.domElement;
            const control = new TransformControls(camera, domElement);

            // Potree's input handler uses bubbling events and often stops propagation.
            // We need TransformControls to intercept pointer events in the capture phase.
            domElement.removeEventListener('pointerdown', (control as any)._onPointerDown);
            domElement.removeEventListener('pointermove', (control as any)._onPointerHover);
            domElement.removeEventListener('pointerup', (control as any)._onPointerUp);

            const capturePointerHover = (e: any) => {
                if (!domElement.contains(e.target as Node)) return;
                (control as any)._onPointerHover(e);
            };

            // Also proxy the dynamically added pointermove to see if it fires
            const capturePointerMove = (e: any) => {
                (control as any)._onPointerMove(e);
            };

            const onPointerDownWrapper = (e: any) => {
                if (!domElement.contains(e.target as Node)) return;
                (control as any)._onPointerDown(e);
                window.addEventListener('pointermove', capturePointerMove, { capture: true });
            };

            const onPointerUpWrapper = (e: any) => {
                (control as any)._onPointerUp(e);
                window.removeEventListener('pointermove', capturePointerMove, { capture: true });
            };

            window.addEventListener('pointerdown', onPointerDownWrapper, { capture: true });
            window.addEventListener('pointermove', capturePointerHover, { capture: true });
            window.addEventListener('pointerup', onPointerUpWrapper, { capture: true });
            
            // Store cleanup functions on the control so we can remove them later
            (control as any)._cleanupWindowListeners = () => {
                window.removeEventListener('pointerdown', onPointerDownWrapper, { capture: true });
                window.removeEventListener('pointermove', capturePointerHover, { capture: true });
                window.removeEventListener('pointerup', onPointerUpWrapper, { capture: true });
                window.removeEventListener('pointermove', capturePointerMove, { capture: true });
            };

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

            control.addEventListener('dragging-changed', (event: any) => {
                const isDragging = event.value;

                // Handle Camera Conflicts: Disable/enable Potree navigation
                if (viewer.setControlsEnabled) {
                    // Depends on exact Potree version, this might exist
                    viewer.setControlsEnabled(!isDragging);
                }
                if (viewer.inputHandler) {
                    // Usually this is how you disable interactions in Potree
                    viewer.inputHandler.enabled = !isDragging;
                }
                if (viewer.controls) {
                    // Sometimes controls are directly attached
                    viewer.controls.enabled = !isDragging;
                }

                // Extract and Save the Matrix on Drag End
                if (!isDragging && control.object) {
                    const pointcloud = control.object;
                    pointcloud.updateMatrix();
                    const matrixArray = pointcloud.matrix.toArray();

                    const currentEditingId = editingIdRef.current;
                    if (currentEditingId) {
                        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
                        fetch(`${API_BASE_URL}/pointclouds/${currentEditingId}/transform`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ matrix: matrixArray })
                        })
                            .then(res => {
                                if (!res.ok) console.error("Failed to save transform");
                            })
                            .catch(err => console.error("Error saving transform:", err));
                    }
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
            
            // 1. Check Potree's managed pointclouds (EPT)
            const pcs = viewer.scene.pointclouds;
            for (let i = 0; i < pcs.length; i++) {
                const pc = pcs[i];
                if (pc.name && pc.name.includes(editingPointcloudId)) {
                    targetPc = pc;
                    break;
                }
                if (pc.pcoGeometry && pc.pcoGeometry.url && pc.pcoGeometry.url.includes(editingPointcloudId)) {
                    targetPc = pc;
                    break;
                }
            }
            
            // 2. Check general Three.js scene (PLY)
            if (!targetPc) {
                viewer.scene.scene.children.forEach((child: any) => {
                    if (child.name && child.name.includes(editingPointcloudId)) {
                        targetPc = child;
                    }
                });
            }

            if (!targetPc && pointCloud) {
                targetPc = pointCloud;
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
    }, [viewer, editingPointcloudId, gizmoMode, pointCloud]);

    // Cleanup when component unmounts entirely
    useEffect(() => {
        return () => {
            if (transformControlRef.current) {
                if ((transformControlRef.current as any)._cleanupWindowListeners) {
                    (transformControlRef.current as any)._cleanupWindowListeners();
                }
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
