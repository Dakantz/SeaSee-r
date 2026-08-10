import pytest
import json
from unittest.mock import AsyncMock, patch
from app.services.pointcloud.pdal import (
    run_pdal_subprocess,
    run_pdal_pipeline,
    run_pdal_info,
)


@pytest.mark.anyio
async def test_run_pdal_subprocess_native_success():
    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"native output", b"")
        mock_proc.returncode = 0
        mock_exec.return_value = mock_proc

        retcode, stdout, stderr = await run_pdal_subprocess(
            cmd=["pdal", "--version"]
        )

        assert retcode == 0
        assert stdout == "native output"
        assert stderr == ""
        mock_exec.assert_called_once()


@pytest.mark.anyio
async def test_run_pdal_subprocess_failure_raises():
    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"", b"native pdal error")
        mock_proc.returncode = 1
        mock_exec.return_value = mock_proc

        with pytest.raises(RuntimeError) as exc_info:
            await run_pdal_subprocess(
                cmd=["pdal", "--version"]
            )
        assert "native pdal error" in str(exc_info.value)


@pytest.mark.anyio
async def test_run_pdal_subprocess_no_raise():
    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"", b"native pdal error")
        mock_proc.returncode = 1
        mock_exec.return_value = mock_proc

        retcode, stdout, stderr = await run_pdal_subprocess(
            cmd=["pdal", "--version"],
            raise_on_error=False
        )

        assert retcode == 1
        assert stdout == ""
        assert stderr == "native pdal error"


@pytest.mark.anyio
async def test_run_pdal_pipeline_execution():
    pipeline_data = {"pipeline": [{"type": "readers.las", "filename": "test.las"}]}
    with patch("app.services.pointcloud.pdal.run_pdal_subprocess", new_callable=AsyncMock) as mock_subproc:
        mock_subproc.return_value = (0, "pipeline complete", "")

        retcode, stdout, stderr = await run_pdal_pipeline(pipeline=pipeline_data)

        assert retcode == 0
        assert stdout == "pipeline complete"
        mock_subproc.assert_called_once()


@pytest.mark.anyio
async def test_run_pdal_info_execution():
    fake_info = {
        "stats": {
            "bbox": {
                "native": {
                    "bbox": {"minx": 0.0, "miny": 0.0, "minz": 0.0, "maxx": 10.0, "maxy": 10.0, "maxz": 10.0}
                }
            },
            "statistic": [{"name": "X", "minimum": 0.0, "maximum": 10.0, "count": 100}]
        },
        "summary": {"num_points": 100, "srs": {"horizontal": "EPSG:4326"}}
    }
    with patch("app.services.pointcloud.pdal.run_pdal_subprocess", new_callable=AsyncMock) as mock_subproc:
        mock_subproc.return_value = (0, json.dumps(fake_info), "")

        result = await run_pdal_info("/fake/path/test.las")
        assert result == fake_info
        assert result["summary"]["num_points"] == 100

