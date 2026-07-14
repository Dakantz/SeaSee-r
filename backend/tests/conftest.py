import pytest
from fastapi.testclient import TestClient
import sys
import os

# Add the backend directory to the sys.path to allow importing main
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app

@pytest.fixture
def client():
    """
    Yields a TestClient instance for the FastAPI application.
    This fixture ensures that the app is tested without spinning up an actual server.
    """
    with TestClient(app) as test_client:
        yield test_client
