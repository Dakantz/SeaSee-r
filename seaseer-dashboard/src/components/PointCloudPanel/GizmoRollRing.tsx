import { useState, useRef, type FC, type PointerEvent, type MouseEvent } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

export interface GizmoRollRingProps {
    size?: number; // default 156
    onDragStateChange?: (isDragging: boolean) => void;
    onCameraChange?: () => void;
    className?: string;
    camera?: THREE.Camera;
}

// Module-scoped temporary THREE objects to avoid GC thrashing on mouse move
const _viewDir = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _currentPos = new THREE.Vector3();
const _targetPoint = new THREE.Vector3();
const _upVec = new THREE.Vector3();

export const GizmoRollRing: FC<GizmoRollRingProps> = ({
    size = 156,
    onDragStateChange,
    onCameraChange,
    className = "",
    camera: propCamera,
}) => {
    let threeCamera: THREE.Camera | undefined;
    try {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const three = useThree();
        threeCamera = three.camera;
    } catch (_) {
        // Rendered outside R3F Canvas context
    }
    const camera = propCamera || threeCamera;

    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [accumulatedAngle, setAccumulatedAngle] = useState(0);

    const lastAngleRef = useRef<number | null>(null);

    const center = size / 2;
    const radius = center - 8;

    // Calculate notch line coordinates for cardinal directions (0°, 90°, 180°, 270°)
    const notchOffsetInner = radius - 1;
    const notchOffsetOuter = radius + 6;
    const notches = [
        // Top (270° / -90°)
        {
            x1: center,
            y1: center - notchOffsetOuter,
            x2: center,
            y2: center - notchOffsetInner,
        },
        // Right (0°)
        {
            x1: center + notchOffsetInner,
            y1: center,
            x2: center + notchOffsetOuter,
            y2: center,
        },
        // Bottom (90°)
        {
            x1: center,
            y1: center + notchOffsetInner,
            x2: center,
            y2: center + notchOffsetOuter,
        },
        // Left (180°)
        {
            x1: center - notchOffsetOuter,
            y1: center,
            x2: center - notchOffsetInner,
            y2: center,
        },
    ];

    // Handle position: angle 0 corresponds to top (-PI/2)
    const handleX = center + radius * Math.cos(accumulatedAngle - Math.PI / 2);
    const handleY = center + radius * Math.sin(accumulatedAngle - Math.PI / 2);

    const handlePointerDown = (e: PointerEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);

        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        lastAngleRef.current = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        setIsDragging(true);
        onDragStateChange?.(true);
    };

    const handlePointerMove = (e: PointerEvent<SVGCircleElement>) => {
        if (!isDragging || lastAngleRef.current === null) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = e.currentTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        let delta = currentAngle - lastAngleRef.current;

        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;

        lastAngleRef.current = currentAngle;

        setAccumulatedAngle((prev) => (prev + delta) % (Math.PI * 2));

        if (camera) {
            camera.getWorldDirection(_viewDir);
            _rollQuat.setFromAxisAngle(_viewDir, -delta);
            camera.quaternion.premultiply(_rollQuat).normalize();
            onCameraChange?.();
        }
    };

    const handlePointerUp = (e: PointerEvent<SVGCircleElement>) => {
        if (isDragging) {
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch (_) {}
            setIsDragging(false);
            onDragStateChange?.(false);
            lastAngleRef.current = null;
        }
    };

    const handleDoubleClick = (e: MouseEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (camera) {
            camera.getWorldDirection(_forward);
            _currentPos.copy(camera.position);
            _targetPoint.copy(_currentPos).add(_forward);

            if (Math.abs(_forward.z) > 0.999) {
                _upVec.set(0, 1, 0);
            } else {
                _upVec.set(0, 0, 1);
            }

            camera.up.copy(_upVec);
            camera.lookAt(_targetPoint);
            onCameraChange?.();
        }

        setAccumulatedAngle(0);
    };

    // Roll angle in degrees for tooltip display
    const deg = Math.round((accumulatedAngle * 180) / Math.PI);
    const signedDeg = deg > 0 ? `+${deg}` : `${deg}`;
    const showTooltip = isHovered || isDragging;

    return (
        <div className={`gizmo-roll-ring-container ${className}`.trim()}>
            <svg
                className="gizmo-roll-ring-svg"
                viewBox={`0 0 ${size} ${size}`}
                style={{ width: size, height: size }}
            >
                {/* Background circular track */}
                <circle
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke="rgba(255, 255, 255, 0.15)"
                    strokeWidth="1.5"
                    fill="none"
                />

                {/* 4 cardinal notch ticks */}
                {notches.map((notch, idx) => (
                    <line
                        key={idx}
                        x1={notch.x1}
                        y1={notch.y1}
                        x2={notch.x2}
                        y2={notch.y2}
                        className="gizmo-roll-ring-notch"
                    />
                ))}

                {/* Interaction & visual track */}
                <circle
                    className={`gizmo-roll-ring-track ${isDragging ? "gizmo-roll-ring-track--active" : ""}`}
                    cx={center}
                    cy={center}
                    r={radius}
                    strokeWidth="8"
                    fill="none"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    onDoubleClick={handleDoubleClick}
                >
                    <title>Drag to rotate camera view axis • Double click to reset roll</title>
                </circle>

                {/* Indicator handle dot */}
                <circle
                    cx={handleX}
                    cy={handleY}
                    r="4"
                    fill="#00e5ff"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    style={{ pointerEvents: "none" }}
                />
            </svg>

            {/* Hover / drag tooltip */}
            {showTooltip && (
                <div className="gizmo-roll-ring-tooltip" style={{ display: "block" }}>
                    Roll: {signedDeg}° (Double-click to reset)
                </div>
            )}
        </div>
    );
};

export default GizmoRollRing;
