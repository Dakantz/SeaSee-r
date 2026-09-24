import uuid
import pytest

def test_generate_batch_id_post(client):
    """
    Test POST /videos/batch-id generates a valid UUID batch ID.
    """
    response = client.post("/videos/batch-id")
    assert response.status_code == 200
    data = response.json()
    assert "batch_id" in data
    # Verify it is a valid UUID
    batch_uuid = uuid.UUID(data["batch_id"])
    assert batch_uuid.version == 4
    if "batchId" in data and data["batchId"] is not None:
        assert data["batchId"] == data["batch_id"]

def test_get_batch_id(client):
    """
    Test GET /videos/batch-id returns a valid UUID batch ID.
    """
    response = client.get("/videos/batch-id")
    assert response.status_code == 200
    data = response.json()
    assert "batch_id" in data
    batch_uuid = uuid.UUID(data["batch_id"])
    assert batch_uuid.version == 4

def test_generate_tusd_batch_id_post(client):
    """
    Test POST /tusd/batch-id generates a valid UUID batch ID.
    """
    response = client.post("/tusd/batch-id")
    assert response.status_code == 200
    data = response.json()
    assert "batch_id" in data
    batch_uuid = uuid.UUID(data["batch_id"])
    assert batch_uuid.version == 4

def test_get_tusd_batch_id(client):
    """
    Test GET /tusd/batch-id returns a valid UUID batch ID.
    """
    response = client.get("/tusd/batch-id")
    assert response.status_code == 200
    data = response.json()
    assert "batch_id" in data
    batch_uuid = uuid.UUID(data["batch_id"])
    assert batch_uuid.version == 4
