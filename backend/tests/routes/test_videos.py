import os
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings

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


def test_init_resumable_upload(client, override_video_dir):
    response = client.post(
        "/videos/upload/init",
        data={"filename": "my_video.mp4", "total_bytes": 1000}
    )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert "safe_filename" in data
    
    # Check if empty file was created
    file_path = os.path.join(override_video_dir, data["safe_filename"])
    assert os.path.exists(file_path)
    assert os.path.getsize(file_path) == 0


def test_get_resumable_status_not_found(client):
    response = client.get("/videos/upload/fake_file.mp4/status")
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


def test_resumable_upload_flow(client, override_video_dir):
    # 1. Init
    chunk1 = b"chunk 1 data "
    chunk2 = b"chunk 2 data"
    total_bytes = len(chunk1) + len(chunk2)
    
    init_res = client.post(
        "/videos/upload/init",
        data={"filename": "flow_video.mp4", "total_bytes": total_bytes}
    )
    safe_filename = init_res.json()["safe_filename"]
    
    # 2. Upload Chunk 1
    response = client.post(
        f"/videos/upload/{safe_filename}",
        data={"offset": 0},
        files={"file": ("blob", chunk1, "application/octet-stream")}
    )
    assert response.status_code == 200
    assert response.json()["uploaded_bytes"] == len(chunk1)
    
    # 3. Check Status
    status_res = client.get(f"/videos/upload/{safe_filename}/status")
    assert status_res.status_code == 200
    assert status_res.json()["uploaded_bytes"] == len(chunk1)
    
    # 4. Upload Chunk 2
    response = client.post(
        f"/videos/upload/{safe_filename}",
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


def test_resumable_upload_offset_mismatch(client, override_video_dir):
    # Init
    init_res = client.post(
        "/videos/upload/init",
        data={"filename": "mismatch.mp4", "total_bytes": 1000}
    )
    safe_filename = init_res.json()["safe_filename"]
    
    # Try uploading with wrong offset
    chunk = b"some data"
    response = client.post(
        f"/videos/upload/{safe_filename}",
        data={"offset": 100},  # Wrong offset, should be 0 since it's an empty file
        files={"file": ("blob", chunk, "application/octet-stream")}
    )
    assert response.status_code == 400
    assert "Offset mismatch" in response.json()["detail"]


def test_resumable_upload_file_not_found(client):
    chunk = b"some data"
    response = client.post(
        "/videos/upload/fake_file.mp4",
        data={"offset": 0},
        files={"file": ("blob", chunk, "application/octet-stream")}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


def test_metadata_upload_flow(client, override_video_dir):
    # 1. Init a video first
    init_vid_res = client.post(
        "/videos/upload/init",
        data={"filename": "flow_video.mp4", "total_bytes": 1000}
    )
    video_safe_filename = init_vid_res.json()["safe_filename"]
    
    # 2. Init metadata
    chunk1 = b"metadata chunk 1"
    chunk2 = b"metadata chunk 2"
    total_bytes = len(chunk1) + len(chunk2)
    
    init_meta_res = client.post(
        f"/videos/upload/{video_safe_filename}/metadata/init",
        data={"filename": "meta.json", "content_type": "application/json", "total_bytes": total_bytes}
    )
    assert init_meta_res.status_code == 200
    meta_safe_filename = init_meta_res.json()["safe_filename"]
    
    # 3. Upload Metadata Chunk 1
    response = client.post(
        f"/videos/upload/metadata/{meta_safe_filename}",
        data={"offset": 0},
        files={"file": ("blob", chunk1, "application/octet-stream")}
    )
    assert response.status_code == 200
    assert response.json()["uploaded_bytes"] == len(chunk1)
    
    # 4. Check Metadata Status
    status_res = client.get(f"/videos/upload/metadata/{meta_safe_filename}/status")
    assert status_res.status_code == 200
    assert status_res.json()["uploaded_bytes"] == len(chunk1)
    
    # 5. Upload Metadata Chunk 2
    response = client.post(
        f"/videos/upload/metadata/{meta_safe_filename}",
        data={"offset": len(chunk1)},
        files={"file": ("blob", chunk2, "application/octet-stream")}
    )
    assert response.status_code == 200
    
    # 6. Verify file content on disk
    file_path = os.path.join(override_video_dir, meta_safe_filename)
    with open(file_path, "rb") as f:
        content = f.read()
    assert content == chunk1 + chunk2
    
    # 7. Cancel video upload and verify cascade delete
    cancel_res = client.delete(f"/videos/upload/{video_safe_filename}")
    assert cancel_res.status_code == 200
    
    # Verify metadata file is deleted from disk
    assert not os.path.exists(file_path)
    # Verify video file is deleted from disk
    video_file_path = os.path.join(override_video_dir, video_safe_filename)
    assert not os.path.exists(video_file_path)


def test_init_metadata_upload_video_not_found(client, override_video_dir):
    response = client.post(
        "/videos/upload/fake_video_safe_filename/metadata/init",
        data={"filename": "meta.json", "content_type": "application/json", "total_bytes": 100}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Video not found"


def test_metadata_upload_offset_mismatch(client, override_video_dir):
    # 1. Init a video
    init_vid_res = client.post(
        "/videos/upload/init",
        data={"filename": "vid.mp4", "total_bytes": 1000}
    )
    video_safe_filename = init_vid_res.json()["safe_filename"]
    
    # 2. Init metadata
    init_meta_res = client.post(
        f"/videos/upload/{video_safe_filename}/metadata/init",
        data={"filename": "meta.json", "content_type": "application/json", "total_bytes": 100}
    )
    meta_safe_filename = init_meta_res.json()["safe_filename"]
    
    # 3. Upload chunk with wrong offset
    response = client.post(
        f"/videos/upload/metadata/{meta_safe_filename}",
        data={"offset": 50},  # Wrong offset, should be 0
        files={"file": ("blob", b"data", "application/octet-stream")}
    )
    assert response.status_code == 400
    assert "Offset mismatch" in response.json()["detail"]


def test_get_metadata_status_not_found(client):
    response = client.get("/videos/upload/metadata/fake_meta_file/status")
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


def test_metadata_upload_file_not_found(client):
    response = client.post(
        "/videos/upload/metadata/fake_meta_file",
        data={"offset": 0},
        files={"file": ("blob", b"data", "application/octet-stream")}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"


def test_get_video_metadata(client, override_video_dir):
    # 1. Init a video
    init_vid_res = client.post(
        "/videos/upload/init",
        data={"filename": "vid.mp4", "total_bytes": 1000}
    )
    video_safe_filename = init_vid_res.json()["safe_filename"]
    
    # 2. Init metadata
    client.post(
        f"/videos/upload/{video_safe_filename}/metadata/init",
        data={"filename": "meta.json", "content_type": "application/json", "total_bytes": 100}
    )
    
    # We need the metadata ID from the database or from a GET videos response
    # Let's get the videos list and find our metadata ID
    videos_res = client.get("/videos")
    assert videos_res.status_code == 200
    videos = videos_res.json()
    
    # Find the video we just created
    video = next((v for v in videos if v["safe_filename"] == video_safe_filename), None)
    assert video is not None
    assert len(video["metadata_files"]) == 1
    
    metadata_id = video["metadata_files"][0]["id"]
    
    # 3. Fetch metadata info
    meta_res = client.get(f"/videos/metadata/{metadata_id}")
    assert meta_res.status_code == 200
    meta_data = meta_res.json()
    assert meta_data["filename"] == "meta.json"
    assert meta_data["content_type"] == "application/json"
    assert meta_data["total_bytes"] == 100

def test_get_video_metadata_not_found(client):
    import uuid
    fake_id = str(uuid.uuid4())
    response = client.get(f"/videos/metadata/{fake_id}")
    assert response.status_code == 404
    assert response.json()["detail"] == "Metadata not found"

