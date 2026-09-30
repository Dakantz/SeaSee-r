import uuid
import pytest


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


def test_get_batches_overview(client):
    """
    Test GET /videos/batches and GET /videos/batches/overview return list of batch overviews.
    """
    res1 = client.get("/videos/batches?processed_only=false")
    assert res1.status_code == 200
    data1 = res1.json()
    assert isinstance(data1, list)

    res2 = client.get("/videos/batches/overview?processed_only=true")
    assert res2.status_code == 200
    data2 = res2.json()
    assert isinstance(data2, list)

    if len(data2) > 0:
        first = data2[0]
        assert "batch_id" in first
        assert "video_count" in first
        assert "total_video_length" in first
        assert "pointcloud_count" in first
        assert "total_points" in first
        assert "log_count" in first
        assert "video_filenames" in first
        assert "log_filenames" in first
        assert first["pointcloud_count"] > 0


def test_start_batch_pipeline_not_found(client):
    """
    Test POST /videos/batches/{batch_id}/pipeline returns 404 for non-existent batch.
    """
    random_uuid = str(uuid.uuid4())
    res = client.post(f"/videos/batches/{random_uuid}/pipeline", json={"frame_counts": [200], "blur_thresholds": [50.0]})
    assert res.status_code == 404
