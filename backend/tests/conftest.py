import pytest
from fastapi.testclient import TestClient
import sys
import os
import subprocess
import time

# Add the backend directory to the sys.path to allow importing main
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# ENVIRONMENT OVERRIDES (Must happen before any app code is imported)
os.environ["DATABASE_URL"] = "postgresql+asyncpg://seaseer_user:seaseer_password@localhost:5434/seaseer_test"
os.environ["REDIS_URL"] = "redis://localhost:6380"

import subprocess
import time

def run_cmd(cmd: list[str], cwd=None):
    print(f"Running: {' '.join(cmd)}")
    try:
        return subprocess.run(cmd, check=True, text=True, capture_output=True, cwd=cwd)
    except subprocess.CalledProcessError as e:
        print(f"Command failed with {e.returncode}")
        print(f"STDOUT:\n{e.stdout}")
        print(f"STDERR:\n{e.stderr}")
        raise

@pytest.fixture(scope="session", autouse=True)
def test_environment():
    """Spin up the test docker environment and run migrations."""
    import shutil
    if not shutil.which("docker"):
        print("Docker executable not found in PATH; skipping container spinup.")
        yield
        return

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    compose_file = os.path.join(project_root, "docker-compose.test.yml")
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    
    print("Spinning up test environment...")
    run_cmd(["docker", "compose", "-f", compose_file, "up", "-d", "--wait"], cwd=project_root)


    
    # Run migrations
    print("Running database migrations...")
    for i in range(5):
        try:
            run_cmd(["alembic", "upgrade", "head"], cwd=backend_dir)
            break
        except subprocess.CalledProcessError as e:
            if i == 4:
                print("Migrations failed after 5 retries.")
                raise
            print("Migration failed, retrying in 2 seconds...")
            time.sleep(2)
    
    yield
    
    # Teardown containers and volumes
    print("Tearing down test environment...")
    run_cmd(["docker", "compose", "-f", compose_file, "down", "-v"], cwd=project_root)

from app.main import app

@pytest.fixture
def client(test_environment):
    """
    Yields a TestClient instance for the FastAPI application.
    By depending on test_environment, we guarantee Docker is up before app initialization.
    """
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
