import pytest
from fastapi.testclient import TestClient
from app.main import app

def test_get_opensfm_config():
    client = TestClient(app)
    response = client.get("/api/opensfm/config")
    assert response.status_code == 200
    data = response.json()
    assert "config" in data
    assert "raw_yaml" in data
    assert "file_path" in data
    assert data["config"]["processes"] >= 1
    assert data["config"]["mem_ceiling"] >= 1024

def test_update_and_reset_opensfm_config():
    client = TestClient(app)
    
    # Get current
    get_res = client.get("/api/opensfm/config")
    assert get_res.status_code == 200

    # Update config via structured payload
    updated_payload = {
        "config": {
            "processes": 4,
            "feature_process_size": 1024,
            "mem_ceiling": 8192,
            "depthmap_max_image_size": 1024,
            "depthmap_cluster_max_size": 8,
            "depthmap_max_cluster_views": 16,
            "depthmap_fusion_svo_max_voxels": 20000000,
            "undistorted_image_max_size": 1024,
            "submodel_size": 40
        }
    }
    put_res = client.put("/api/opensfm/config", json=updated_payload)
    assert put_res.status_code == 200
    put_data = put_res.json()
    assert put_data["config"]["processes"] == 4
    assert put_data["config"]["mem_ceiling"] == 8192

    # Reset back to default
    reset_res = client.post("/api/opensfm/config/reset")
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    assert reset_data["config"]["processes"] == 2
    assert reset_data["config"]["mem_ceiling"] == 12288

def test_invalid_raw_yaml_validation():
    client = TestClient(app)
    # Raw YAML with invalid negative processes (violates ge=1 constraint)
    invalid_yaml = "processes: -5\nmem_ceiling: 12288"
    res = client.put("/api/opensfm/config", json={"raw_yaml": invalid_yaml})
    assert res.status_code == 400
    assert "validation" in res.json()["detail"].lower()

def test_preserve_custom_yaml_keys():
    client = TestClient(app)
    # Put raw YAML with custom extra key
    custom_yaml = "processes: 3\ncustom_extra_param: 99\nmem_ceiling: 12288\nfeature_process_size: 2048\ndepthmap_max_image_size: 2048\ndepthmap_cluster_max_size: 12\ndepthmap_max_cluster_views: 32\ndepthmap_fusion_svo_max_voxels: 50000000\nundistorted_image_max_size: 2048\nsubmodel_size: 60"
    res = client.put("/api/opensfm/config", json={"raw_yaml": custom_yaml})
    assert res.status_code == 200
    assert "custom_extra_param: 99" in res.json()["raw_yaml"]

    # Now update via form payload and verify custom key remains in raw_yaml
    form_update = {
        "config": {
            "processes": 5,
            "feature_process_size": 2048,
            "mem_ceiling": 12288,
            "depthmap_max_image_size": 2048,
            "depthmap_cluster_max_size": 12,
            "depthmap_max_cluster_views": 32,
            "depthmap_fusion_svo_max_voxels": 50000000,
            "undistorted_image_max_size": 2048,
            "submodel_size": 60
        }
    }
    put_res = client.put("/api/opensfm/config", json=form_update)
    assert put_res.status_code == 200
    assert put_res.json()["config"]["processes"] == 5
    assert "custom_extra_param: 99" in put_res.json()["raw_yaml"]

    # Cleanup reset
    client.post("/api/opensfm/config/reset")

