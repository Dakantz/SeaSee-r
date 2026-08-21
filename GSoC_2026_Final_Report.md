# Google Summer of Code 2026 | Final Work Submission

**Contributor:** Thomas Astegger ([@Cott3r](https://github.com/Cott3r))  
**Organization:** SeaSee-r / Graz University of Technology / Catrobat  
**Mentors:** Benedikt Kantz, Tobias Schreck, Wolfgang Slany  
**Project Title:** SeaSee’r: Underwater Mapping and Exploration Using Spatially Anchored Panoramas  
**Primary Repository:** [https://github.com/Dakantz/SeaSee-r](https://github.com/Dakantz/SeaSee-r)  

> [!NOTE]
> **Submission Scope & Timeline:** This report documents the technical progress and features implemented **so far** as of August 2026. In accordance with the academic calendar in Austria (where university summer holidays span from July through September), active development will continue through the end of September 2026 to implement further enhancements and features.

---

## 1. Project Requirements

**SeaSee’r** is a GSoC 2026 project focused on creating a new open-source platform for ingesting and visualizing ROV (Remotely Operated Vehicle) underwater exploration videos. 
The primary requirement is to develop a navigable 3D underwater map.
It allows the ingestion of video feeds based on internal vehicle GPS positioning.
In future versions, it will be expanded to support multimodal ROV data, such as depth/attitude telemetry and sonar measurements. 
The system is designed as an extensible platform to support mission path planning, prior-pass searches, site re-identification, and point cloud registration across repeated marine research missions.

---

## 2. Summary of Work Done

### Backend
- **Database**: Created a PostgreSQL database with PostGIS and `pgPointCloud` extensions for storing and querying data such as point clouds, camera trajectories, and ROV video metadata.
- **FastAPI**: Built a REST API using FastAPI for data ingestion and database querying.
- **Binary Streaming Engine**: Created a binary streaming endpoint that streams specific point clouds directly to the frontend. Point clouds can be arbitrarily filtered using SQL queries.
- **Data Ingestion Pipeline**: Developed an ingestion pipeline for video feeds and metadata, which are processed asynchronously using PySLAM and OpenSfM via the backend job system.

### Frontend
- **Web Application**: Created a web interface allowing users to visualize ingested ROV data with support for custom query filtering and camera navigation.
- **3D Rendering**: Implemented 3D rendering of point clouds and camera routes using Three.js for easy extensibility and integration with the backend.
- **Binary Streaming Engine**: Consumes binary data from the backend endpoint directly into WebGL `BufferGeometry`. To improve rendering performance, different levels of detail (LODs) are dynamically loaded based on camera distance.
- **Bathymetry Mesh Integration**: Rendered the seafloor as a 3D mesh using the `geo-three` library and integrated EMODnet Bathymetry elevation data.

---

## 3. What’s Left to Do (Planned Work till the end of September 2026)

1. **Improve point cloud generation using video metadata**:
   - Improve point cloud generation by utilizing video metadata to align point clouds with camera trajectories. 
   - Incorporate the ROV-calculated GPS positions to refine point cloud alignment with camera trajectories.
2. **Video timeline synchronization**:
   - Display camera trajectory positions clearly on the video timeline. 
   - Enable display of corresponding video frames at specific camera trajectory positions.
3. **Point Cloud Editing**:
   - Allow users to rotate and translate point clouds to align them with previously ingested data and the bathymetry mesh.
   - Provide interactive tools to prune unwanted points or noise from point clouds.
4. **Docker Deployment**:
   - Containerize and simplify deployment for the entire stack (Backend, Frontend, OpenSfM, PySLAM) using Docker.

---

## 4. Future Scope

Looking beyond the GSoC 2026 roadmap, the architecture of SeaSee’r provides clear avenues for future extensions:

1. **Automated Point Cloud Stitching**:
   - Automatically align and stitch multiple ingested point clouds into a unified 3D map.
2. **Live Mission Planning**:
   - Utilize ingested point clouds and metadata to plan future missions, including:
     - Path planning based on ROV trajectories.
     - Site re-identification.
     - Live registration of new image frames and video feeds.
3. **Inclusion of Other Sensor Data**:
   - **Sonar**: Ingest sonar measurement data for accurate seafloor depth and bathymetry estimation.
   - **Panoramic Videos**: Ingest 360-degree panoramic videos to enable immersive 3D panoramic viewing of the seafloor.

---

## 5. Challenges & Key Learnings

### Technical Challenges & Solutions

1. **Saving the point clouds inside of PostgreSQL**:
   - *Problem*: The point clouds should be saved inside PostgreSQL using PostGIS (`pgPointCloud`). 
     This is a requirement to allow for maximal flexibility when querying point cloud points.
   - *Solution*: Using PDAL, I was able to create an ingestion pipeline that saves the point cloud inside the database for multiple LODs.
   
2. **High-Performance Binary Point Cloud Streaming**:
   - *Problem*: Providing the frontend with the point cloud data saved inside the database.
   - *Solution*: Developed a binary streaming endpoint (`/pointclouds/stream-binary`) that streams packed binary attribute buffers from PostGIS (`pgPointCloud`) straight into WebGL `BufferGeometry`.
     The number of points loaded is limited by spatial filtering that limits the distance at which points are loaded for each LOD scale.

3. **Resumable file uploads over unstable connections**:
   - *Problem*: Uploading large video and metadata files should be resumable if the internet connection drops temporarily.
   - *Solution*: I implemented the TUS (Resumable Upload Protocol) to allow for a chunked, interruptible file upload.

### Key Learnings
- **Full-Stack Development**: Gained extensive hands-on experience in modern full-stack web architecture, including FastAPI, Alembic, Pydantic, PostgreSQL, React, Three.js, and Docker.
- **Spatial Databases & PostGIS**: Mastered PostGIS and `pgPointCloud` for spatial indexing and point cloud queries using functions like `PC_PatchMin`, `PC_PatchMax`, and `PC_Explode`.
- **Map Tiles & Coordinate Reference Systems**: Deepened understanding of spatial coordinate transformations, working with systems such as EPSG:3857 (Web Mercator) and EPSG:3765 (HTRS96 / Croatia TM).
