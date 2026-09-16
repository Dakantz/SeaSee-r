# Docker Setup & Deployment Guide

This document describes how to deploy and run the entire **SeaSee-r** microservices architecture using Docker Compose.

---

## Prerequisites

Before starting, ensure you have **Docker Engine** & **Docker Compose** (V2 plugin) installed on your host system.

### Install NVIDIA Container Toolkit on Ubuntu (Recommended for 3D Point Cloud GPU Acceleration)

Run these commands in your Ubuntu terminal to add NVIDIA's repository and install the toolkit prior to running Docker:

```bash
# 1. Add NVIDIA Container Toolkit repository
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
# 2. Install the toolkit package
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
# 3. Configure Docker runtime daemon and restart Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

---

## Quick Start

The only command required to start all services is:

```bash
docker compose up -d --build
```

This single command builds the container images, initializes databases and volume mounts, passes host user permissions (`UID`/`GID`), and launches all background services.

---

## Architecture & Container Services Overview

The Docker setup orchestrates 6 main containerized services:

| Container Name | Service | Image / Build Source | Ports | Description |
| :--- | :--- | :--- | :--- | :--- |
| `seasee-r-db` | Database | `pgpointcloud/pointcloud:latest` | `5433:5432` | PostgreSQL database with Spatial & PointCloud 3D capabilities. |
| `seasee-r-redis` | Message Broker | `redis:7-alpine` | `6379:6379` | In-memory key-value store for background RQ job queues. |
| `seasee-r-backend` | FastAPI Server | `./backend/Dockerfile` | `8000:8000` | Core REST API backend handling jobs, point clouds, and spatial queries. |
| `seasee-r-worker` | Task Worker | `./backend/Dockerfile` | N/A | Background task worker handling general processing queues (`pointcloud_tasks`, `job_tasks`, `default`). |
| `seasee-r-opensfm` | OpenSfM Worker | `backend/Dockerfile.opensfm-worker` | N/A | Dedicated GPU-accelerated worker running OpenSfM photogrammetry & point cloud pipelines. |
| `seasee-r-tusd` | Resumable Uploads | `tusproject/tusd:latest` | `8080:8080` | TUSD server handling large resumable media uploads linked to backend webhooks. |

---

## Service Endpoints & Healthchecks

Once the containers are running (`docker compose up -d --build`), the following endpoints are accessible on `localhost`:

- **FastAPI Backend API**: [http://localhost:8000](http://localhost:8000)
- **Interactive OpenAPI Specs (Swagger UI)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Backend Health Check**: [http://localhost:8000/health](http://localhost:8000/health)
- **TUSD Upload Server**: [http://localhost:8080/files/](http://localhost:8080/files/)
- **PostgreSQL Database**: `localhost:5433` (`seaseer` DB)
- **Redis Queue**: `localhost:6379`

---

## Environment Configuration & User Permissions

- **Environment Settings**: Container settings are loaded from `.env` (copied from `.env.example`).
- **File Permissions (`UID` / `GID`)**: The `backend`, `worker`, and `opensfm` containers dynamically inherit the host user's UID and GID (`UID=${UID:-1000}`, `GID=${GID:-1000}`) during `docker compose up --build`. This prevents file permission mismatches between container output directories and the host filesystem.

---

## Common Management Commands

- **Start Services (Background)**:
  ```bash
  docker compose up -d --build
  ```

- **Check Service Status**:
  ```bash
  docker compose ps
  ```

- **View Live Logs**:
  ```bash
  # View all service logs
  docker compose logs -f

  # View specific service logs (e.g. opensfm or backend)
  docker compose logs -f opensfm backend
  ```

- **Stop All Services**:
  ```bash
  docker compose down
  ```

- **Stop Services & Remove Volumes (Reset DB/Redis data)**:
  ```bash
  docker compose down -v
  ```
