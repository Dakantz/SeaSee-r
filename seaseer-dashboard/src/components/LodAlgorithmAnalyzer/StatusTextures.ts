import * as THREE from "three";
import type { TileStatus } from "./QuadtreeLodManager";

const textureCache: Map<TileStatus, THREE.CanvasTexture> = new Map();

/**
 * Creates a procedural 2D canvas texture for a given tile status.
 * Pattern uses white pixels with alpha transparency so it overlays cleanly
 * on top of any LOD level color without altering the underlying LOD color hue.
 */
function createStatusCanvasTexture(status: TileStatus): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);

    switch (status) {
      case "NEEDS_LOAD":
        // Polka-Dot / Matrix pattern for NEEDS_LOAD
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        for (let x = 8; x < 64; x += 16) {
          for (let y = 8; y < 64; y += 16) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;

      case "NEEDS_REFRESH":
        // 45-degree diagonal warning hatch lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = -64; i < 128; i += 12) {
          ctx.moveTo(i, 0);
          ctx.lineTo(i + 64, 64);
        }
        ctx.stroke();
        break;

      case "NEEDS_EVICT":
        // Cross-hatch (X-grid) pattern
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = -64; i < 128; i += 16) {
          // Top-left to bottom-right
          ctx.moveTo(i, 0);
          ctx.lineTo(i + 64, 64);
          // Top-right to bottom-left
          ctx.moveTo(i, 64);
          ctx.lineTo(i - 64, 0);
        }
        ctx.stroke();
        break;

      case "LOADED":
      default:
        // Completely transparent / clean for LOADED
        break;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Returns a procedural texture for the specified TileStatus, configured with repeat values
 * proportional to world-space width and height so overlay textures are never stretched.
 */
export function getStatusTexture(
  status: TileStatus,
  width: number = 20,
  height: number = 20,
  unitSize: number = 20
): THREE.CanvasTexture {
  if (!textureCache.has(status)) {
    textureCache.set(status, createStatusCanvasTexture(status));
  }
  const baseTexture = textureCache.get(status)!;
  const texture = baseTexture.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / unitSize, height / unitSize);
  texture.needsUpdate = true;
  return texture;
}
