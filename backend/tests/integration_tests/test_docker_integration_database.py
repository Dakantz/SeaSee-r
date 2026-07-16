import pytest
import time
import os
import anyio
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest.mark.anyio
async def test_docker_integration_database(async_client):
    print("\n--- Testing Point Clouds (Database mode) ---")
    
    # 1. Create a dummy .ply file
    ply_content = """ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
end_header
0.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
"""
    with open("test.ply", "w") as f:
        f.write(ply_content)
    
    # 2. Upload the file using client
    print("Uploading test.ply...")
    with open("test.ply", "rb") as f:
        response = await async_client.post("/pointclouds/upload", files={"file": ("test.ply", f, "application/octet-stream")})
    
    assert response.status_code == 200, f"Upload failed: {response.text}"
    upload_data = response.json()
    print(f"Upload Response: {upload_data}")
    
    file_id = upload_data.get("file_id")
    job_id = upload_data.get("job_id")
    
    assert file_id, "No file_id returned from upload"
    
    # 3. Check jobs list
    print("\nChecking jobs...")
    response = await async_client.get("/jobs")
    assert response.status_code == 200
    jobs_data = response.json()
    
    job_found = any(j.get("id") == job_id for j in jobs_data)
    assert job_found, f"Job {job_id} not found in /jobs"
        
    print("\nChecking specific job status...")
    response = await async_client.get(f"/jobs/{job_id}")
    assert response.status_code == 200
    job_data = response.json()
    print(f"Job details: {job_data}")

    # 4. Wait for job completion
    print("\nWaiting for job to complete...")
    start_time = time.time()
    timeout = 60
    job_completed = False
    while time.time() - start_time < timeout:
        response = await async_client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        job_data = response.json()
        status = job_data.get("status")
        progress = job_data.get("progress")
        print(f"Job Status: {status} (Progress: {progress}%)")
        if status in ["COMPLETED", "FAILED"]:
            job_completed = True
            break
        await anyio.sleep(2)
        
    assert job_completed, "Timeout waiting for job to complete"
    assert job_data.get("status") != "FAILED", f"Job failed with error: {job_data.get('error_message')}"

    # 5. Check pointclouds list
    print("\nChecking pointclouds list...")
    response = await async_client.get("/pointclouds/")
    assert response.status_code == 200
    pc_data = response.json()
    print(f"Point clouds list: {pc_data}")
    
    # 6. See the uploaded/processed file from database
    print(f"\nDownloading the uploaded file by ID ({file_id}) from database...")
    response = await async_client.get(f"/pointclouds/{file_id}")
    assert response.status_code == 200
    download_text = response.text
    print(f"Downloaded content preview:\n{download_text[:100]}...\n")
    
    assert "ply" in download_text, "Downloaded file does not look like a PLY file."
    
    # Cleanup
    if os.path.exists("test.ply"):
        os.remove("test.ply")

