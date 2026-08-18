# EMODnet Bathymetry Geo-Three Provider (Tile Imagery & WCS Depth)

## Overview
The `EmodnetProvider` architecture enables 3D terrain visualization using the [EMODnet Bathymetry](https://ows.emodnet-bathymetry.eu/ows) web services via two specialized subclasses:
- **`EmodnetTileProvider`**: Uses native high-performance tile endpoint (`https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png`) for 2D/3D surface texture imagery with fallback to WMS GetMap OWS service when custom endpoints are supplied.
- **`EmodnetWCSProvider`**: Fetches raw **mathematical depth data** via WCS `GetCoverage` in unprojected native DTM coverage (`FORMAT=GeoTIFF`, coverage `emodnet:mean`, `CRS=EPSG:4326`) and performs client-side reprojection (`reprojectEPSG4326To3857`) from `EPSG:4326` to `EPSG:3857` (Spherical Mercator) using bilinear resampling, converting 32-bit floating point depth values into a Terrain-RGB encoded Canvas element for 3D terrain mesh generation. Height values are amplified by `heightMultiplier`.

## Elimination of Tile Edge Artifacts & Coordinate Reprojection

### 1. Native EPSG:4326 Fetching & Client-Side Reprojection (`reprojectEPSG4326To3857`)
- WCS `GetCoverage` requests fetch native unprojected DTM coverage in geographic coordinates (`CRS=EPSG:4326`).
- Client-side warping inverse-projects Web Mercator `EPSG:3857` tile grid points back to geographic coordinates $(\text{lon}, \text{lat})$ and resamples the source Float32 depth data using bilinear interpolation. This eliminates non-linear latitudinal distortion while maintaining native DTM coverage alignment.

### 2. NoData / Boundary Spike Removal (`cleanAndFillNoData`)
- Raw WCS GeoTIFF coverage data contains `NaN` or out-of-bounds `NoData` values near coastlines, land areas, or dataset boundaries.
- Previously, `NoData` pixels defaulted to $0$ meters elevation while adjacent ocean pixels were $-2500$ meters, generating massive $2500$m vertical cliff spikes along tile boundaries.
- The `cleanAndFillNoData` algorithm fills boundary `NoData` pixels by propagating nearest valid ocean depth values across rows, creating smooth continuous tile boundaries without vertical cliff spikes.

## Architecture & Implementation

### Provider Classes
Located in [`seaseer-dashboard/public/geo-three/source/providers/EmodnetProvider.ts`](file:///home/tastegger/Documents/SeaSee-r/seaseer-dashboard/public/geo-three/source/providers/EmodnetProvider.ts).

```tsx
import { MapView, EmodnetTileProvider, EmodnetWCSProvider } from "../../../public/geo-three/build/geo-three.module.js";

const imageryProvider = new EmodnetTileProvider();
const heightProvider = new EmodnetWCSProvider("https://ows.emodnet-bathymetry.eu/ows", "emodnet:mean", 10.0);

const map = new MapView(MapView.HEIGHT, imageryProvider, heightProvider);
```
