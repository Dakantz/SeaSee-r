# SeaSee-r
A system to ingest, explore, and plan operations for ROV systems in marine environments

## Installation

An automated installation script is provided to set up the project and its dependencies. The script will automatically:

- Initialize and download all Git submodules.
- Install Miniconda locally.
- Create and set up the `opensfm` Conda environment.
- Create and set up the `pyslam` Conda environment.

To run the installation, execute the following command from the project root:

```bash
./install_all.sh
```

## Running Instructions

### Backend Services

Build and launch the backend services (PostgreSQL with PostGIS/pgPointCloud, FastAPI, TUS server) via Docker:
```bash
docker compose up -d --build
```

### Running the Dashboard Visualizer
Navigate to `seaseer-dashboard`, install dependencies, and start the Vite dev server:
```bash
cd seaseer-dashboard
npm install
npm run generate-client
npm run dev
```
Open `http://localhost:5173` in any WebGL2-enabled browser to access the visualizer interface.

---