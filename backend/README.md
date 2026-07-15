# SeaSee-r Backend

This directory contains the FastAPI backend for the SeaSee-r project. It is structured to provide a robust, type-safe API using Pydantic, and is designed to integrate seamlessly with the frontend via auto-generated TypeScript clients.

## Infrastructure

- **Framework**: FastAPI
- **Server**: Uvicorn
- **Data Validation**: Pydantic
- **Future Integration**: Prepared for `pgPointcloud` database separation.

---

## Architecture


### Background Job System (RQ & Redis)
- **Redis Queue:** The backend uses Redis as a lightweight message broker. Instead of blocking HTTP requests during heavy operations, FastAPI enqueues tasks (like point cloud processing) into a Redis queue.
- **Dedicated Worker Container:** A separate Docker container (the `worker` service) runs the `rq worker` process. It constantly listens to the Redis queue (`pointcloud_tasks`).
- **Isolation:** The worker container shares the same Docker image and codebase as the API but does not expose any network ports. It only communicates internally with Redis and the PostgreSQL database to report job statuses.
- **Asynchronous Execution:** By using `asyncio` and `subprocess` within the worker tasks, heavy CLI operations (like `entwine build`) run concurrently without freezing the main application logic, and provide real-time parsing of task progress back to the database.

---

## Startup Instructions

### 1. Start with Docker Compose

The backend, worker, database, and Redis instances are all orchestrated using Docker Compose. From the project root where `docker-compose.yml` is located, simply run:

```bash
docker compose up -d --build
```

This command will:
- Build the API and worker images (using Conda-forge for modern point cloud capabilities like `pdal` and `entwine`).
- Initialize the PostgreSQL database with PostGIS extensions.
- Start the Redis message broker.
- Launch the FastAPI application (with hot-reloading) and the RQ background worker.

### 2. Access the Application

Once the containers are running:
- The FastAPI backend is available at: `http://127.0.0.1:8000`
- Interactive API docs (Swagger UI) are at: `http://127.0.0.1:8000/docs`

### 3. Testing

The backend includes tests that can be run directly inside the Docker container.

**Run the test suite via Docker:**
```bash
docker compose exec backend pytest -v
```

Alternatively, you can run the provided Docker integration test script from the host machine:
```bash
python backend/test_docker_integration_filesystem.py
```
