# EMODnet Bathymetry Geo-Three Provider (WMS & WCS Mathematical Depth)

## Overview
The `EmodnetProvider` enables 3D terrain visualization using the [EMODnet Bathymetry](https://ows.emodnet-bathymetry.eu/ows) web services.
- **WMS Mode**: Fetches georeferenced map imagery (`FORMAT=image/png`, layer `emodnet:mean`) for 2D/3D surface texture.
- **WCS Mode**: Fetches raw **mathematical depth data** via WCS `GetCoverage` (`FORMAT=GeoTIFF`, layer `emodnet:mean`, `CRS=EPSG:3857` for zoom $\ge 7$) and converts 32-bit floating point depth values (in meters) into a Terrain-RGB encoded Canvas element for 3D terrain mesh generation. Height values are amplified by `heightMultiplier`.

## Elimination of Tile Edge Artifacts

### 1. Web Mercator Alignment (`CRS=EPSG:3857`)
- WCS `GetCoverage` requests for zoom $\ge 7$ use `CRS=EPSG:3857` (Spherical Mercator). This eliminates the non-linear latitudinal distortion that occurs when projecting `EPSG:4326` geographic coordinates onto `geo-three`'s Web Mercator 3D quadtree mesh grid.

### 2. NoData / Boundary Spike Removal (`cleanAndFillNoData`)
- Raw WCS GeoTIFF coverage data contains `NaN` or out-of-bounds `NoData` values near coastlines, land areas, or dataset boundaries.
- Previously, `NoData` pixels defaulted to $0$ meters elevation while adjacent ocean pixels were $-2500$ meters, generating massive $2500$m vertical cliff spikes along tile boundaries.
- The `cleanAndFillNoData` algorithm fills boundary `NoData` pixels by propagating nearest valid ocean depth values across rows, creating smooth continuous tile boundaries without vertical cliff spikes.

## Architecture & Implementation

### `EmodnetProvider` Class
Located in [`seaseer-dashboard/public/geo-three/source/providers/EmodnetProvider.ts`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/public/geo-three/source/providers/EmodnetProvider.ts).

```tsx
import { MapView, EmodnetProvider } from "../../../public/geo-three/build/geo-three.module.js";

const imageryProvider = new EmodnetProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", "", "image/png", "WMS");
const heightProvider = new EmodnetProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", "", "image/png", "WCS", 10.0);

const map = new MapView(MapView.HEIGHT, imageryProvider, heightProvider);
```
