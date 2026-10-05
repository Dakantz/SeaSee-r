// @ts-expect-error - geo-three submodule
import { MapHeightNodeShader, MapNodeGeometry, MapHeightNode, MapPlaneNode, CanvasUtils, MapNodeHeightGeometry } from "../../../../../public/geo-three/build/geo-three.module.js";

let isPatched = false;

export function patchGeoThreeHeight(): void {
    if (isPatched) return;
    isPatched = true;

    // Set skirt depth to 2000.0 so the skirt extends down to height -2000
    MapHeightNodeShader.geometry = new MapNodeGeometry(
        1.0,
        1.0,
        MapHeightNodeShader.geometrySize,
        MapHeightNodeShader.geometrySize,
        true,
        2000.0
    );

    if (MapHeightNode.prototype.loadHeightGeometry) {
        MapHeightNode.prototype.loadHeightGeometry = async function () {
            if (this.mapView?.heightProvider === null) {
                throw new Error("GeoThree: MapView.heightProvider provider is null.");
            }

            if (this.level < this.mapView.heightProvider.minZoom || this.level > this.mapView.heightProvider.maxZoom) {
                this.geometry = MapPlaneNode.baseGeometry;
                return;
            }

            try {
                const image = await this.mapView.heightProvider.fetchTile(this.level, this.x, this.y);
                if (this.disposed) return;

                // 1. Draw 1:1 onto a 256x256 canvas without downscaling to extract exact uncorrupted RGBA bytes
                const srcTileSize = MapHeightNode.tileSize; // 256
                const srcCanvas = CanvasUtils.createOffscreenCanvas(srcTileSize, srcTileSize);
                const srcContext = srcCanvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
                srcContext.imageSmoothingEnabled = false;
                srcContext.drawImage(image, 0, 0, srcTileSize, srcTileSize, 0, 0, srcTileSize, srcTileSize);
                const srcData = srcContext.getImageData(0, 0, srcTileSize, srcTileSize).data;

                // 2. Downsample to 17x17 via pure nearest-neighbor pixel sampling
                const dstSize = this.geometrySize + 1; // 17
                const dstCanvas = CanvasUtils.createOffscreenCanvas(dstSize, dstSize);
                const dstContext = dstCanvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
                const dstImageData = dstContext.createImageData(dstSize, dstSize);
                const dstData = dstImageData.data;

                for (let r = 0; r < dstSize; r++) {
                    const srcY = Math.min(srcTileSize - 1, Math.round((r / (dstSize - 1)) * (srcTileSize - 1)));
                    for (let c = 0; c < dstSize; c++) {
                        const srcX = Math.min(srcTileSize - 1, Math.round((c / (dstSize - 1)) * (srcTileSize - 1)));

                        const srcIdx = (srcY * srcTileSize + srcX) * 4;
                        const dstIdx = (r * dstSize + c) * 4;

                        dstData[dstIdx + 0] = srcData[srcIdx + 0];
                        dstData[dstIdx + 1] = srcData[srcIdx + 1];
                        dstData[dstIdx + 2] = srcData[srcIdx + 2];
                        dstData[dstIdx + 3] = srcData[srcIdx + 3];
                    }
                }

                // 3. Build geometry with non-corrupted 17x17 height grid
                this.geometry = new MapNodeHeightGeometry(1, 1, this.geometrySize, this.geometrySize, true, 2000.0, dstImageData, true);
            } catch (e) {
                if (this.disposed) return;
                this.geometry = MapPlaneNode.baseGeometry;
            }
            this.heightLoaded = true;
        };
    }
}
