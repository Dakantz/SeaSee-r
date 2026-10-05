# Google Summer of Code 2026 – Final Report

**Contributor**: Thomas Astegger ([@Cott3r](https://github.com/Cott3r))  
**Mentor(s)**: Benedikt Kantz, Tobias Schreck, Wolfgang Slany  
**Organization**: International Catrobat Association / Graz University of Technology  
**Project**: SeaSee’r  
**GitHub Repository**:
- https://github.com/Dakantz/SeaSee-r

---

## 1. Project Overview

**SeaSee’r** is a GSoC 2026 project focused on creating an open-source platform for ingesting, reconstructing, and visualizing ROV (Remotely Operated Vehicle) underwater exploration videos and sensor telemetry. The primary requirement is to develop an interactive, navigable 3D underwater map that allows ingestion of video feeds aligned with internal vehicle GPS positioning, depth sensors, and navigation logs.

The system is designed as an extensible, scalable platform for marine researchers to support mission path planning, prior-pass searches, site re-identification, and point cloud registration across repeated marine research expeditions.

---

## 2. Goals of the Project

The goal is to create a website that allows users to upload ROV video feeds, process the data into a point cloud, and provide a flexible navigation interface that allows users to explore the 3D map. 

---

## 3. Current State

The base architecture of the SeaSee-r website has been fully implemented:

- **Database**: On the backend, PostgreSQL with PostGIS is used to store ingested point clouds and metadata.

- **Data Ingestion Pipeline**: A multi-stage pipeline is implemented to ingest uploaded ROV data:
  - `video_upload`: Registers uploaded video files and logs.
  - `frame_extraction`: Extracts individual frames and creates exif_overrides.
  - `opensfm_sparse`: Performs feature detection and matching using OpenSfM.
  - `opensfm_dense`: Computes depth maps and generates a dense 3D point cloud.
  - `opensfm_ingest`: Ingests the point cloud into the database.
  
- **Web Application**: Created a dashboard allowing users to visualize ROV datasets with custom query filtering and interactive camera navigation:
  - `Custom Query`: Users can filter point clouds by any of the metadata fields in the database.
  - `3D Rendering`: A Three.js scene that allows for interactive 3D rendering of point clouds and camera routes.
  - `Dynamic Level of Detail (LOD)`: The point clouds are loaded in different levels of detail based on the distance to the camera. A specific "LOD Analyzer" page was created to test different LOD algorithms in 2D.
  - `Logs Charts & Video Player`: Support for synchronized video playback and telemetry charts.
  - `Bathymetry Mesh Integration`: Renders the seafloor as a 3D terrain mesh using the `geo-three` library, which was extended to use EMODnet Bathymetry elevation data.
  - `Point Cloud Editing`: Allows editing point clouds by translating, rotating, or scaling them.

- **Docker Setup**: Containerized all SeaSee-r services into 7 Docker containers.

---

## 4. What’s Left to Do

- Fine-tune OpenSfM settings to improve camera pose estimation and reconstruction.
- Point Cloud Editing & Cleaning: Provide pruning tools to eliminate floating particulate noise.
- Automatic point cloud alignment based on GPS positioning and existing point clouds.
- Live mission planning & re-identification.
- Inclusion of additional multimodal sensor data in the ingestion pipeline and point cloud generation.

---

### Key Learnings
- **Full-Stack Programming**: Gained extensive experience with both the front-end and back-end of web development.
- **Spatial Databases & PostGIS**: Learned about spatial databases like PostGIS and how to filter and query data in them.
- **Coordinate Reference Systems**: Deepened my understanding of geographic coordinate systems like EPSG:3765 (Croatia TM) and EPSG:3857 (Web Mercator).

---

## 5. Acknowledgements

I would like to thank my mentors **Benedikt Kantz**, **Tobias Schreck**, and **Wolfgang Slany** for their guidance and help with technical challenges. 
They always made time for me and supported the project with great ideas and advice.

---
