import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.worker.handlers.emodnet import EMODnetCSVTaskHandler
from app.services.pointcloud.pdal import ingest_postgis_raster_pyramids, process_emodnet_csv
from app.models.pointcloud import BathymetryRaster

@pytest.mark.anyio
async def test_ingest_postgis_raster_pyramids_mocked():
    with patch("app.services.pointcloud.pdal.async_session") as mock_session_ctx, \
         patch("asyncio.create_subprocess_exec") as mock_subproc:
        
        mock_session = AsyncMock()
        mock_res = MagicMock()
        mock_res.scalar.return_value = False
        mock_session.execute.return_value = mock_res
        mock_session_ctx.return_value.__aenter__.return_value = mock_session
        
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"CREATE TABLE bathymetry_raster;", b"")
        mock_proc.returncode = 0
        mock_subproc.return_value = mock_proc

        await ingest_postgis_raster_pyramids(
            geotiff_path="test_raster.tif",
            table_name="bathymetry_raster",
            srid=3857,
            pyramid_levels="2,4,8,16",
            pointcloud_id="11111111-1111-1111-1111-111111111111"
        )
        assert mock_session.execute.called

@pytest.mark.anyio
async def test_emodnet_csv_task_handler_execution(tmp_path):
    csv_file = tmp_path / "test_emodnet.csv"
    csv_file.write_text("longitude,latitude,elevation\ndeg,deg,m\n1.0,2.0,10.0\n")

    handler = EMODnetCSVTaskHandler()
    with patch.object(handler, "update_job_status", new_callable=AsyncMock) as mock_status, \
         patch("app.services.worker.handlers.emodnet.process_emodnet_csv", new_callable=AsyncMock) as mock_process, \
         patch("app.services.worker.handlers.emodnet.upsert_pointcloud_metadata", new_callable=AsyncMock):
        
        mock_process.return_value = ({"min_x": 0, "max_x": 1}, 100, 1)

        result = await handler.execute(
            job_id="22222222-2222-2222-2222-222222222222",
            payload={"file_path": str(csv_file), "file_id": "22222222-2222-2222-2222-222222222222"}
        )

        assert result["status"] == "success"
        assert result["file_id"] == "22222222-2222-2222-2222-222222222222"
        mock_process.assert_called_once()
