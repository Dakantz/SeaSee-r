# User Story: EMODnet Bathymetry WMS Provider

## Description
As a user of SeaSee dashboard, I want to use EMODnet Bathymetry WMS map tiles as a geo-three map imagery provider so that I can visualize high-resolution European marine bathymetry data on the 3D terrain canvas.

## Acceptance Criteria
- [x] Create `EmodnetProvider` in `geo-three` supporting WMS 1.3.0 GetMap requests for `emodnet:mean` in EPSG:3857.
- [x] Export `EmodnetProvider` from `geo-three` build artifacts.
- [x] Integrate `Emodnet` as a selection option in `PLYPointCloud` context, map view switcher, and sidebar UI.
- [x] Pass build and TypeScript validation.

## Technical Constraints / Notes
- WMS service URL: `https://ows.emodnet-bathymetry.eu/ows`
- Layer: `emodnet:mean`
- Coordinate system: `EPSG:3857` (Spherical Mercator) for seamless integration with `geo-three` quadtree tiles.

## Implementation Tasks (for Antigravity)
- [x] Implement `EmodnetProvider.ts` in `public/geo-three/source/providers/`.
- [x] Rebuild `geo-three` bundle.
- [x] Update `PLYPointCloudContext.tsx`, `PLYPointCloud.tsx`, and `PLYPointCloudSidebar.tsx`.
- [x] Verify build and add documentation.
