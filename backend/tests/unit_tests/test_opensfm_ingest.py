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
async def test_get_dense_point_count_las_standard():
    import struct
    # Create valid LAS 1.2 binary header
    header = bytearray(375)
    header[0:4] = b"LASF"
    header[24:26] = struct.pack("BB", 1, 2) # version 1.2
    header[107:111] = struct.pack("<I", 54321) # legacy count

    with tempfile.NamedTemporaryFile(mode="wb", suffix=".las", delete=False) as f:
        f.write(header)
        f_name = f.name

    try:
        count = await _get_dense_point_count(f_name)
        assert count == 54321
    finally:
        if os.path.exists(f_name):
            os.remove(f_name)

@pytest.mark.anyio
async def test_get_dense_point_count_laz_extended_1_4():
    import struct
    # Create valid LAS 1.4 binary header with 64-bit extended count
    header = bytearray(375)
    header[0:4] = b"LASF"
    header[24:26] = struct.pack("BB", 1, 4) # version 1.4
    header[107:111] = struct.pack("<I", 0) # legacy count = 0
    header[247:255] = struct.pack("<Q", 5000000000) # extended count

    with tempfile.NamedTemporaryFile(mode="wb", suffix=".laz", delete=False) as f:
        f.write(header)
        f_name = f.name

    try:
        count = await _get_dense_point_count(f_name)
        assert count == 5000000000
    finally:
        if os.path.exists(f_name):
            os.remove(f_name)

@pytest.mark.anyio
async def test_get_dense_point_count_laz_fallback_pdal():
    # File without LASF header should fall back to get_pointcloud_stats
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".laz", delete=False) as f:
        f.write(b"not a valid lasf header")
        f_name = f.name

    try:
        with patch("app.services.pointcloud.pdal.get_pointcloud_stats", new_callable=AsyncMock) as mock_stats:
            mock_stats.return_value = ({}, 8888)
            count = await _get_dense_point_count(f_name)
            assert count == 8888
            mock_stats.assert_called_once_with(f_name)
    finally:
        if os.path.exists(f_name):
            os.remove(f_name)

@pytest.mark.anyio
async def test_get_dense_point_count_nonexistent():
    assert await _get_dense_point_count(None) == 0
    assert await _get_dense_point_count("/nonexistent/file.laz") == 0

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

        with patch("app.services.worker.handlers.opensfm_ingest.PointCloudUploadTaskHandler.ingest_pointcloud_pipeline", new_callable=AsyncMock) as mock_pc_pipeline, \
             patch("app.services.worker.handlers.opensfm_ingest.async_session") as mock_session_ctx, \
             patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_update_status:

            mock_session = AsyncMock()
            mock_session_ctx.return_value.__aenter__.return_value = mock_session

            res = await handler.process_opensfm(
                file_path=pc_path,
                file_id="11111111-1111-1111-1111-111111111111",
                job_id="22222222-2222-2222-2222-222222222222",
                folder_path=tmp_dir,
                subfolder="undistorted",
                reconstruction_index=0
            )

            assert res["status"] == "success"
            assert res["file_id"] == "11111111-1111-1111-1111-111111111111"
            assert mock_pc_pipeline.call_count == 1
            assert len(res["reconstructions"]) == 1

            # Rec 0 stats
            assert res["reconstructions"][0]["reconstruction_index"] == 0
            assert res["reconstructions"][0]["views"] == 2
            assert res["reconstructions"][0]["sparse_points"] == 3
            assert res["reconstructions"][0]["dense_points"] == 9876

            # Verify update_job_status was called with COMPLETED and result
            mock_update_status.assert_called_with(
                "22222222-2222-2222-2222-222222222222",
                "COMPLETED",
                100.0,
                result=res
            )


@pytest.mark.anyio
async def test_opensfm_ingest_single_reconstruction_component_1():
    handler = OpenSfMIngestTaskHandler()

    with tempfile.TemporaryDirectory() as tmp_dir:
        pc_path = os.path.join(tmp_dir, "fused.laz")
        with open(pc_path, "wb") as f:
            f.write(b"dummy laz content")

        rec_json_path = os.path.join(tmp_dir, "reconstruction.json")
        rec_data = [
            {"cameras": {}, "shots": {}, "points": {}},
            {
                "cameras": {"cam1": {"focal": 0.8, "width": 1920, "height": 1080}},
                "shots": {"shot3.jpg": {"rotation": [0, 0, 0], "translation": [2, 2, 2]}},
                "points": {"p4": {"coordinates": [3, 3, 3]}}
            }
        ]
        with open(rec_json_path, "w") as f:
            json.dump(rec_data, f)

        # Create fused pointcloud for component 1
        dir1 = os.path.join(tmp_dir, "undistorted_1", "depthmaps")
        os.makedirs(dir1, exist_ok=True)
        fused1_path = os.path.join(dir1, "fused.laz")
        with open(fused1_path, "wb") as f:
            f.write(b"laz 1")

        dataset_name = "dataset_11111111_1111_1111_1111_111111111111_f50_b50"

        with patch("app.services.worker.handlers.opensfm_ingest.PointCloudUploadTaskHandler.ingest_pointcloud_pipeline", new_callable=AsyncMock) as mock_pc_pipeline, \
             patch("app.services.worker.handlers.opensfm_ingest.async_session") as mock_session_ctx, \
             patch.object(handler, "update_job_status", new_callable=AsyncMock):

            mock_session = AsyncMock()
            mock_session_ctx.return_value.__aenter__.return_value = mock_session

            res = await handler.process_opensfm(
                file_path=pc_path,
                file_id="33333333-3333-3333-3333-333333333333",
                job_id="22222222-2222-2222-2222-222222222222",
                folder_path=tmp_dir,
                subfolder="undistorted_1",
                reconstruction_index=1,
                dataset_name=dataset_name
            )

            assert res["status"] == "success"
            assert mock_pc_pipeline.call_count == 1

            call_kwargs = mock_pc_pipeline.call_args.kwargs
            assert call_kwargs["file_path"] == fused1_path
            assert call_kwargs["override_filename"] == f"{dataset_name}_rec_1.laz"
            assert call_kwargs["file_id"] == "33333333-3333-3333-3333-333333333333"

            assert len(res["reconstructions"]) == 1
            assert res["reconstructions"][0]["reconstruction_index"] == 1
            assert res["reconstructions"][0]["views"] == 1
            assert res["reconstructions"][0]["sparse_points"] == 1
