import os
import json
import tempfile
import pytest
from unittest.mock import AsyncMock, patch

from app.services.worker.handlers.opensfm_ingest import (
    OpenSfMIngestTaskHandler,
    _get_dense_point_count
)

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_get_dense_point_count_ply():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".ply", delete=False) as f:
        f.write("ply\nformat ascii 1.0\nelement vertex 12345\nproperty float x\nend_header\n")
        f_name = f.name

    try:
        count = await _get_dense_point_count(f_name)
        assert count == 12345
    finally:
        if os.path.exists(f_name):
            os.remove(f_name)

@pytest.mark.anyio
async def test_opensfm_ingest_result_with_reconstruction_json():
    handler = OpenSfMIngestTaskHandler()

    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create dummy pointcloud file
        pc_path = os.path.join(tmp_dir, "fused.laz")
        with open(pc_path, "wb") as f:
            f.write(b"dummy laz content")

        # Create dummy reconstruction.json
        rec_json_path = os.path.join(tmp_dir, "reconstruction.json")
        rec_data = [
            {
                "cameras": {"cam1": {"focal": 0.8, "width": 1920, "height": 1080}},
                "shots": {
                    "shot1.jpg": {"rotation": [0, 0, 0], "translation": [0, 0, 0]},
                    "shot2.jpg": {"rotation": [0, 0, 0], "translation": [1, 1, 1]}
                },
                "points": {
                    "p1": {"coordinates": [0, 0, 0]},
                    "p2": {"coordinates": [1, 1, 1]},
                    "p3": {"coordinates": [2, 2, 2]}
                }
            },
            {
                "cameras": {"cam1": {"focal": 0.8, "width": 1920, "height": 1080}},
                "shots": {
                    "shot3.jpg": {"rotation": [0, 0, 0], "translation": [2, 2, 2]}
                },
                "points": {
                    "p4": {"coordinates": [3, 3, 3]}
                }
            }
        ]
        with open(rec_json_path, "w") as f:
            json.dump(rec_data, f)

        # Create dummy fused PLY for component 0
        undistorted_dir = os.path.join(tmp_dir, "undistorted", "depthmaps")
        os.makedirs(undistorted_dir, exist_ok=True)
        ply_path = os.path.join(undistorted_dir, "merged.ply")
        with open(ply_path, "w") as f:
            f.write("ply\nformat ascii 1.0\nelement vertex 9876\nend_header\n")

        # Mock database ingestion methods inside PointCloudUploadTaskHandler & DB Session
        with patch("app.services.worker.handlers.opensfm_ingest.PointCloudUploadTaskHandler.ingest_pointcloud_pipeline", new_callable=AsyncMock) as mock_pc_pipeline, \
             patch("app.services.worker.handlers.opensfm_ingest.async_session") as mock_session_ctx, \
             patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update_status:

            mock_session = AsyncMock()
            mock_session_ctx.return_value.__aenter__.return_value = mock_session

            res = await handler.process_opensfm(
                file_path=pc_path,
                file_id="11111111-1111-1111-1111-111111111111",
                job_id="22222222-2222-2222-2222-222222222222",
                folder_path=tmp_dir
            )

            assert res["status"] == "success"
            assert res["file_id"] == "11111111-1111-1111-1111-111111111111"
            assert len(res["reconstructions"]) == 2

            # Rec 0 stats
            assert res["reconstructions"][0]["reconstruction_index"] == 0
            assert res["reconstructions"][0]["views"] == 2
            assert res["reconstructions"][0]["sparse_points"] == 3
            assert res["reconstructions"][0]["dense_points"] == 9876

            # Rec 1 stats
            assert res["reconstructions"][1]["reconstruction_index"] == 1
            assert res["reconstructions"][1]["views"] == 1
            assert res["reconstructions"][1]["sparse_points"] == 1
            assert res["reconstructions"][1]["dense_points"] == 0

            # Verify update_job_status was called with COMPLETED and result
            mock_update_status.assert_called_with(
                "22222222-2222-2222-2222-222222222222",
                "COMPLETED",
                100.0,
                result=res
            )
