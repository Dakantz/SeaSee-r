import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { QuadtreeLodManager, DEFAULT_DOMAIN_BOUNDS, type ManagerStats } from "./QuadtreeLodManager";
import { InsideOut3x3LodManager } from "./InsideOut3x3LodManager";
import { WholeDomainLodManager } from "./WholeDomainLodManager";
import { HybridWholeDomainLodManager } from "./HybridQuadtreeLodManager";

export type FocalSource = "camera" | "mouse" | "orbit";
export type LodAlgorithm = "quadtree" | "inside-out-3x3" | "whole-domain" | "hybrid-whole-domain";

export function useLodAlgorithmAnalyzer() {
  const mountRef = useRef<HTMLDivElement>(null);

  // HUD & Analytics State
  const [fps, setFps] = useState<number>(60);
  const [cameraPosText, setCameraPosText] = useState<string>("0.0, 0.0");
  const [focalPosText, setFocalPosText] = useState<string>("0.0, 0.0");
  const [mousePosText, setMousePosText] = useState<string>("0.0, 0.0");
  const [focalDistance, setFocalDistance] = useState<number>(0);
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);

  // Manager Controls State
  const [lodAlgorithm, setLodAlgorithm] = useState<LodAlgorithm>("quadtree");
  const [maxLOD, setMaxLOD] = useState<number>(4);
  const [distanceFactor, setDistanceFactor] = useState<number>(1.0);
  const [evictionDistanceFactor, setEvictionDistanceFactor] = useState<number>(3);
  const [switchDistanceFactor, setSwitchDistanceFactor] = useState<number>(1.0);
  const [focalSource, setFocalSource] = useState<FocalSource>("camera");
  const focalSourceRef = useRef<FocalSource>(focalSource);

  useEffect(() => {
    focalSourceRef.current = focalSource;
  }, [focalSource]);
  const [simulateAsync, setSimulateAsync] = useState<boolean>(false);
  const [asyncDelay, setAsyncDelay] = useState<number>(300);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [showStatusOverlays, setShowStatusOverlays] = useState<boolean>(true);

  // Real-time Stats
  const [stats, setStats] = useState<ManagerStats>({
    nodesPerLod: {},
  });

  // Manager reference
  const lodManagerRef = useRef<QuadtreeLodManager | InsideOut3x3LodManager | WholeDomainLodManager | HybridWholeDomainLodManager | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const resetCameraTriggerRef = useRef<(() => void) | null>(null);

  // Sync state changes with LOD Manager
  useEffect(() => {
    if (lodManagerRef.current) {
      lodManagerRef.current.setMaxLOD(maxLOD);
    }
  }, [maxLOD]);

  useEffect(() => {
    if (lodManagerRef.current) {
      lodManagerRef.current.setDistanceFactor(distanceFactor);
    }
  }, [distanceFactor]);

  useEffect(() => {
    if (lodManagerRef.current && lodManagerRef.current instanceof InsideOut3x3LodManager) {
      lodManagerRef.current.setEvictionDistanceFactor(evictionDistanceFactor);
    }
  }, [evictionDistanceFactor]);

  useEffect(() => {
    if (lodManagerRef.current && lodManagerRef.current instanceof HybridWholeDomainLodManager) {
      lodManagerRef.current.setSwitchDistanceFactor(switchDistanceFactor);
    }
  }, [switchDistanceFactor]);

  useEffect(() => {
    if (lodManagerRef.current) {
      lodManagerRef.current.setSimulateAsyncLoad(simulateAsync, asyncDelay);
    }
  }, [simulateAsync, asyncDelay]);

  useEffect(() => {
    if (lodManagerRef.current) {
      lodManagerRef.current.setWireframe(wireframe);
    }
  }, [wireframe]);

  useEffect(() => {
    if (lodManagerRef.current) {
      lodManagerRef.current.setShowStatusOverlays(showStatusOverlays);
    }
  }, [showStatusOverlays]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Three.js 2D Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    sceneRef.current = scene;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;

    // 2. Strict 2D Orthographic Camera (Looking straight down Y axis onto 2D XZ Plane)
    const frustumSize = 260;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      (-frustumSize) / 2,
      0.1,
      1000
    );
    camera.position.set(0, 200, 0);
    camera.up.set(0, 0, -1); // Top down: +X right, +Z down/up
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // 3. OrbitControls configured for strict 2D Panning & Zooming ONLY
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false; // STRICT 2D LOCK: Disable 3D rotation
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0, 0);

    resetCameraTriggerRef.current = () => {
      camera.position.set(0, 200, 0);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    };

    // 4. 2D Lighting (Flat ambient)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // 5. 2D Grid Background Lines
    const gridHelper = new THREE.GridHelper(3000, 600, 0x38bdf8, 0x1e293b);
    gridHelper.position.y = -0.1;
    scene.add(gridHelper);

    // LOD Tile Manager Config Setup
    const managerConfig = {
      bounds: DEFAULT_DOMAIN_BOUNDS,
      maxLOD,
      distanceFactor,
      evictionDistanceFactor,
      simulateAsyncLoad: simulateAsync,
      asyncLoadDelayMs: asyncDelay,
      wireframe,
      showStatusOverlays,
    };

    const bboxCenter = new THREE.Vector3(
      (managerConfig.bounds.minX + managerConfig.bounds.maxX) / 2,
      0,
      (managerConfig.bounds.minZ + managerConfig.bounds.maxZ) / 2
    );

    // 6. 2D Bounding Box Center Marker (-200, 0)
    const centerRingGeo = new THREE.RingGeometry(0.8, 1.8, 32);
    centerRingGeo.rotateX(-Math.PI / 2);
    const centerRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const centerRing = new THREE.Mesh(centerRingGeo, centerRingMat);
    centerRing.position.set(bboxCenter.x, 0.05, bboxCenter.z);
    scene.add(centerRing);

    // 7. LOD Tile Manager is dynamically created and updated in a dedicated effect below

    // 8. 2D Focal Point Target Ring
    const focalRingGeo = new THREE.RingGeometry(1.5, 2.5, 32);
    focalRingGeo.rotateX(-Math.PI / 2);
    const focalRingMat = new THREE.MeshBasicMaterial({
      color: 0xff0055,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const focalMarker = new THREE.Mesh(focalRingGeo, focalRingMat);
    focalMarker.position.set(0, 0.1, 0);
    scene.add(focalMarker);

    // Inner 2D focal core dot
    const focalCoreGeo = new THREE.CircleGeometry(0.8, 16);
    focalCoreGeo.rotateX(-Math.PI / 2);
    const focalCoreMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const focalCore = new THREE.Mesh(focalCoreGeo, focalCoreMat);
    focalCore.position.set(0, 0.12, 0);
    scene.add(focalCore);

    // 2D Dashed line connecting focal target to center of bounding box (-200, 0)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.1, 0),
      new THREE.Vector3(bboxCenter.x, 0.1, bboxCenter.z),
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      linewidth: 2,
      scale: 1,
      dashSize: 2,
      gapSize: 1,
    });
    const connectorLine = new THREE.Line(lineGeo, lineMat);
    scene.add(connectorLine);

    // 9. 2D Raycasting on XZ plane
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(-999, -999);
    const mouseWorldPos = new THREE.Vector3();

    const handleMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const canvasEl = renderer.domElement;
    canvasEl.addEventListener("mousemove", handleMouseMove);

    // 10. Animation Loop
    let animId: number;
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    const focalPos = new THREE.Vector3();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const now = performance.now();
      const timeSec = now * 0.001;
      frameCount++;
      if (now - lastFpsUpdate >= 500) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)));
        frameCount = 0;
        lastFpsUpdate = now;
      }

      controls.update();

      // Intersect 2D XZ plane with mouse raycast
      raycaster.setFromCamera(mouse, camera);
      const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(xzPlane, intersection)) {
        mouseWorldPos.copy(intersection);
      }

      // Determine active 2D focal position based on user setting
      if (focalSourceRef.current === "mouse") {
        focalPos.copy(mouseWorldPos);
      } else if (focalSourceRef.current === "orbit") {
        focalPos.x = Math.sin(timeSec * 0.08) * 6500;
        focalPos.z = Math.sin(timeSec * 0.16) * 4500;
      } else {
        // Camera 2D target (where camera is panning)
        focalPos.set(controls.target.x, 0, controls.target.z);
      }

      // Update 2D focal marker position and pulse scale
      focalMarker.position.set(focalPos.x, 0.1, focalPos.z);
      focalCore.position.set(focalPos.x, 0.12, focalPos.z);

      const pulseScale = Math.sin(timeSec * 5) * 0.18 + 1.0;
      focalMarker.scale.set(pulseScale, 1, pulseScale);
      centerRing.scale.set(Math.sin(timeSec * 3) * 0.1 + 1.0, 1, Math.sin(timeSec * 3) * 0.1 + 1.0);

      // Update 2D dashed line to center of bounding box (-200, 0)
      const linePositions = connectorLine.geometry.attributes.position as THREE.BufferAttribute;
      linePositions.setXYZ(0, focalPos.x, 0.1, focalPos.z);
      linePositions.setXYZ(1, bboxCenter.x, 0.1, bboxCenter.z);
      linePositions.needsUpdate = true;
      connectorLine.computeLineDistances();

      // Update Active LOD Manager
      if (lodManagerRef.current) {
        lodManagerRef.current.update(focalPos, timeSec);
        setStats(lodManagerRef.current.getStats());
      }

      setFocalDistance(parseFloat(focalPos.distanceTo(bboxCenter).toFixed(2)));
      setCameraPosText(`${controls.target.x.toFixed(1)}, ${controls.target.z.toFixed(1)}`);
      setFocalPosText(`${focalPos.x.toFixed(1)}, ${focalPos.z.toFixed(1)}`);
      setMousePosText(`${mouseWorldPos.x.toFixed(1)}, ${mouseWorldPos.z.toFixed(1)}`);
      setZoomFactor(parseFloat(camera.zoom.toFixed(2)));

      renderer.render(scene, camera);
    };

    animate();

    // 11. Window Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const newAspect = w / h;

      camera.left = (-frustumSize * newAspect) / 2;
      camera.right = (frustumSize * newAspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();

      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    // 12. Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      canvasEl.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animId);
      renderer.dispose();
      controls.dispose();
      gridHelper.geometry.dispose();
      centerRingGeo.dispose();
      centerRingMat.dispose();
      focalRingGeo.dispose();
      focalRingMat.dispose();
      focalCoreGeo.dispose();
      focalCoreMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      lodManagerRef.current?.dispose();
      lodManagerRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // Dedicated effect to swap LOD Manager when switching algorithms without tearing down scene/camera
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (lodManagerRef.current) {
      lodManagerRef.current.dispose();
      lodManagerRef.current = null;
    }

    const managerConfig = {
      bounds: DEFAULT_DOMAIN_BOUNDS,
      maxLOD,
      distanceFactor,
      evictionDistanceFactor,
      switchDistanceFactor,
      simulateAsyncLoad: simulateAsync,
      asyncLoadDelayMs: asyncDelay,
      wireframe,
      showStatusOverlays,
    };

    switch (lodAlgorithm) {
      case "hybrid-whole-domain":
        lodManagerRef.current = new HybridWholeDomainLodManager(scene, managerConfig);
        break;
      case "inside-out-3x3":
        lodManagerRef.current = new InsideOut3x3LodManager(scene, managerConfig);
        break;
      case "whole-domain":
        lodManagerRef.current = new WholeDomainLodManager(scene, managerConfig);
        break;
      case "quadtree":
      default:
        lodManagerRef.current = new QuadtreeLodManager(scene, managerConfig);
        break;
    }
  }, [lodAlgorithm]);

  const handleRecenter = () => {
    resetCameraTriggerRef.current?.();
  };

  const handleReset = () => {
    lodManagerRef.current?.reset();
  };

  return {
    mountRef,
    fps,
    cameraPosText,
    focalPosText,
    mousePosText,
    focalDistance,
    zoomFactor,
    lodAlgorithm,
    setLodAlgorithm,
    maxLOD,
    setMaxLOD,
    distanceFactor,
    setDistanceFactor,
    evictionDistanceFactor,
    setEvictionDistanceFactor,
    switchDistanceFactor,
    setSwitchDistanceFactor,
    focalSource,
    setFocalSource,
    simulateAsync,
    setSimulateAsync,
    asyncDelay,
    setAsyncDelay,
    wireframe,
    setWireframe,
    showStatusOverlays,
    setShowStatusOverlays,
    stats,
    handleRecenter,
    handleReset,
  };
}

