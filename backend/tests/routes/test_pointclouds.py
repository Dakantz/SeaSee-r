import os
import shutil
import tempfile
import asyncio
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from unittest import TestCase

from app.main import app
from app.core.config import settings
from unittest.mock import MagicMock
from app.main import app
from app.core.config import settings
from app.services.pointcloud import (
    LocalPointCloudStorageService,
    DatabasePointCloudStorageService
)
from app.api.dependencies.pointcloud import get_pointcloud_service

client = TestClient(app)

class TestPointCloudServices(TestCase):
    def setUp(self):
        # Create a temporary directory to act as the point cloud storage during tests
        self.test_dir = tempfile.mkdtemp()
        self.local_service = LocalPointCloudStorageService(base_dir=self.test_dir)
        
        # Create a dummy .ply file
        self.dummy_filename = "test_cloud.ply"
        self.dummy_filepath = os.path.join(self.test_dir, self.dummy_filename)
        with open(self.dummy_filepath, "wb") as f:
            f.write(b"ply\nformat ascii 1.0\nend_header\n0 0 0\n")

    def tearDown(self):
        # Clean up the temporary directory
        shutil.rmtree(self.test_dir)

    def test_local_service_valid_file(self):
        # Test retrieving a valid file synchronously
        # Use asyncio.run since test case class methods are synchronous
        response = asyncio.run(self.local_service.get_pointcloud(self.dummy_filename))
        self.assertIsNotNone(response)
        self.assertEqual(response.path, self.dummy_filepath)
        self.assertEqual(response.media_type, "application/octet-stream")

    def test_local_service_missing_extension(self):
        # The service should append .ply if missing
        response = asyncio.run(self.local_service.get_pointcloud("test_cloud"))
        self.assertEqual(response.path, self.dummy_filepath)

    def test_local_service_file_not_found(self):
        with self.assertRaises(HTTPException) as context:
            asyncio.run(self.local_service.get_pointcloud("nonexistent.ply"))
        self.assertEqual(context.exception.status_code, 404)

    def test_database_service_not_implemented(self):
        mock_db = MagicMock()
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        with self.assertRaises(HTTPException):
            asyncio.run(db_service.get_pointcloud("test_cloud.ply"))
            
    def test_local_service_list_pointclouds(self):
        # Should return a list containing our single dummy file
        files = asyncio.run(self.local_service.list_pointclouds())
        self.assertIsInstance(files, list)
        self.assertIn(self.dummy_filename, files)
        
    def test_database_service_list_not_implemented(self):
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("Offline DB")
        db_service = DatabasePointCloudStorageService(db_session=mock_db)
        files = asyncio.run(db_service.list_pointclouds())
        self.assertEqual(files, [])

from app.core.config import settings, StorageType

def test_dependency_injection():
    # Test that the dependency returns the correct instance based on settings
    
    # Temporarily override settings
    original_type = settings.pointcloud_storage_type
    mock_db = MagicMock()
    
    try:
        settings.pointcloud_storage_type = StorageType.database
        service = get_pointcloud_service(db=mock_db)
        assert isinstance(service, DatabasePointCloudStorageService)

        settings.pointcloud_storage_type = StorageType.filesystem
        service = get_pointcloud_service(db=mock_db)
        assert isinstance(service, LocalPointCloudStorageService)
    finally:
        # Restore settings
        settings.pointcloud_storage_type = original_type



def test_endpoint_get_pointcloud():
    # Create a temporary directory for the dependency override
    temp_dir = tempfile.mkdtemp()
    dummy_file = os.path.join(temp_dir, "api_test.ply")
    with open(dummy_file, "wb") as f:
        f.write(b"ply\ntest data\n")
        
    # Dependency override for the test
    def override_get_pointcloud_service():
        return LocalPointCloudStorageService(base_dir=temp_dir)
        
    app.dependency_overrides[get_pointcloud_service] = override_get_pointcloud_service
    
    try:
        # Request list of files
        response = client.get("/pointclouds/")
        assert response.status_code == 200
        assert response.json() == ["api_test.ply"]

        # Request valid file
        response = client.get("/pointclouds/api_test.ply")
        assert response.status_code == 200
        assert response.content == b"ply\ntest data\n"
        
        # Request missing file
        response = client.get("/pointclouds/missing.ply")
        assert response.status_code == 404
        assert response.json()["detail"] == "Point cloud file not found."
    finally:
        # Clean up overrides and files
        app.dependency_overrides.clear()
        shutil.rmtree(temp_dir)
