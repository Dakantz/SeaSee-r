import os
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings

client = TestClient(app)

@pytest.fixture(autouse=True)
def override_video_dir():
    # Store original and override with temp dir
    original_dir = settings.video_dir
    temp_dir = tempfile.mkdtemp()
    settings.video_dir = temp_dir
    
    yield temp_dir
    
    # Restore original and cleanup
    settings.video_dir = original_dir
    shutil.rmtree(temp_dir)


def test_upload_video():
    # Test uploading a file normally
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
        tmp.write(b"fake video content")
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as f:
            response = client.post(
                "/videos/upload",
                files={"file": ("test_video.mp4", f, "video/mp4")}
            )
        
        assert response.status_code == 200
        data = response.json()
        assert "file_id" in data
        assert "filename" in data
        assert data["message"] == "Video uploaded successfully"
    finally:
        os.remove(tmp_path)


def test_init_resumable_upload(override_video_dir):
    response = client.post(
        "/videos/upload/resumable/init",
        data={"filename": "my_video.mp4"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert "safe_filename" in data
    
    # Check if empty file was created
    file_path = os.path.join(override_video_dir, data["safe_filename"])
    assert os.path.exists(file_path)
    assert os.path.getsize(file_path) == 0


def test_get_resumable_status_not_found():
    response = client.get("/videos/upload/resumable/fake_file.mp4/status")
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


def test_resumable_upload_flow(override_video_dir):
    # 1. Init
    init_res = client.post(
        "/videos/upload/resumable/init",
        data={"filename": "flow_video.mp4"}
    )
    safe_filename = init_res.json()["safe_filename"]
    
    # 2. Upload Chunk 1
    chunk1 = b"chunk 1 data "
    response = client.post(
        f"/videos/upload/resumable/{safe_filename}",
        data={"offset": 0},
        files={"file": ("blob", chunk1, "application/octet-stream")}
    )
    assert response.status_code == 200
    assert response.json()["uploaded_bytes"] == len(chunk1)
    
    # 3. Check Status
    status_res = client.get(f"/videos/upload/resumable/{safe_filename}/status")
    assert status_res.status_code == 200
    assert status_res.json()["uploaded_bytes"] == len(chunk1)
    
    # 4. Upload Chunk 2
    chunk2 = b"chunk 2 data"
    response = client.post(
        f"/videos/upload/resumable/{safe_filename}",
        data={"offset": len(chunk1)},
        files={"file": ("blob", chunk2, "application/octet-stream")}
    )
    assert response.status_code == 200
    assert response.json()["uploaded_bytes"] == len(chunk1) + len(chunk2)
    
    # 5. Verify file content on disk
    file_path = os.path.join(override_video_dir, safe_filename)
    with open(file_path, "rb") as f:
        content = f.read()
    assert content == chunk1 + chunk2


def test_resumable_upload_offset_mismatch(override_video_dir):
    # Init
    init_res = client.post(
        "/videos/upload/resumable/init",
        data={"filename": "mismatch.mp4"}
    )
    safe_filename = init_res.json()["safe_filename"]
    
    # Try uploading with wrong offset
    chunk = b"some data"
    response = client.post(
        f"/videos/upload/resumable/{safe_filename}",
        data={"offset": 100},  # Wrong offset, should be 0 since it's an empty file
        files={"file": ("blob", chunk, "application/octet-stream")}
    )
    assert response.status_code == 400
    assert "Offset mismatch" in response.json()["detail"]


def test_resumable_upload_file_not_found():
    chunk = b"some data"
    response = client.post(
        "/videos/upload/resumable/fake_file.mp4",
        data={"offset": 0},
        files={"file": ("blob", chunk, "application/octet-stream")}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"
