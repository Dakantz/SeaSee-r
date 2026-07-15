import subprocess
import time
import json
import urllib.request
import urllib.error
import os
import sys

BASE_URL = "http://localhost:8000"

def run_cmd(cmd: list[str], check=True):
    print(f"Running: {' '.join(cmd)}")
    return subprocess.run(cmd, check=check, text=True, capture_output=True)

def wait_for_service(url, timeout=30):
    print(f"Waiting for {url} to be ready...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req) as response:
                if response.status == 200:
                    print("Service is ready!")
                    return True
        except Exception:
            pass
        time.sleep(1)
    print("Timeout waiting for service.")
    return False

def http_get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def http_get_text(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        return response.read().decode()

def main():
    override_file = "docker-compose.override.yml"
    try:
        print("--- Setting up Docker ---")
        override_content = """services:
  backend:
    environment:
      - POINTCLOUD_STORAGE_TYPE=filesystem
  worker:
    environment:
      - POINTCLOUD_STORAGE_TYPE=filesystem
"""
        with open(override_file, "w") as f:
            f.write(override_content)

        run_cmd(["docker", "compose", "up", "-d", "--build"])

        # Wait for backend
        if not wait_for_service(f"{BASE_URL}/docs", timeout=60):
            sys.exit(1)

        print("\n--- Initializing Database ---")
        # Run alembic migrations
        run_cmd(["docker", "compose", "exec", "backend", "alembic", "upgrade", "head"])

        print("\n--- Testing Point Clouds ---")
        
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
        
        # 2. Upload the file using curl to handle multipart/form-data easily
        print("Uploading test.ply...")
        upload_process = run_cmd([
            "curl", "-s", "-X", "POST",
            f"{BASE_URL}/pointclouds/upload",
            "-F", "file=@test.ply"
        ])
        
        try:
            upload_data = json.loads(upload_process.stdout)
            print(f"Upload Response: {upload_data}")
        except json.JSONDecodeError:
            print(f"Error parsing upload response: {upload_process.stdout}")
            sys.exit(1)
        
        file_id = upload_data.get("file_id")
        job_id = upload_data.get("job_id")
        
        if not file_id:
            print("Error: No file_id returned from upload")
            sys.exit(1)

        # 3. Check jobs
        print("\nChecking jobs...")
        jobs_data = http_get(f"{BASE_URL}/jobs")
        print(f"Jobs list: {jobs_data}")
        
        job_found = any(j.get("id") == job_id for j in jobs_data)
        if job_found:
            print(f"Job {job_id} successfully found in /jobs")
        else:
            print(f"Error: Job {job_id} not found in /jobs")
            
        print("\nChecking specific job status...")
        job_data = http_get(f"{BASE_URL}/jobs/{job_id}")
        print(f"Job details: {job_data}")

        # 4. Check pointclouds list
        print("\nChecking pointclouds list...")
        pc_data = http_get(f"{BASE_URL}/pointclouds/")
        print(f"Point clouds list: {pc_data}")
        
        # 5. See the uploaded file
        print(f"\nDownloading the uploaded file by ID ({file_id})...")
        download_text = http_get_text(f"{BASE_URL}/pointclouds/{file_id}")
        print(f"Downloaded content preview:\n{download_text[:100]}...\n")
        
        if "ply" in download_text:
            print("Success! Downloaded file is a valid PLY file.")
        else:
            print("Error: Downloaded file does not look like a PLY file.")

    finally:
        print("\n--- Cleaning up ---")
        # run_cmd(["docker", "compose", "down", "-v"])
        if os.path.exists("test.ply"):
            os.remove("test.ply")
        if os.path.exists("docker-compose.override.yml"):
            os.remove("docker-compose.override.yml")
        print("Cleanup done.")

if __name__ == "__main__":
    # Ensure we run from the directory containing docker-compose.yml
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
    os.chdir(project_root)
    
    main()
