from sqlalchemy import select
from app.models.pointcloud import PCPatch, PointCloudPatch


def test_pcpatch_col_spec():
    patch_type = PCPatch()
    assert patch_type.get_col_spec() == "PCPATCH"

    patch_type_with_pcid = PCPatch(pcid=42)
    assert patch_type_with_pcid.get_col_spec() == "PCPATCH(42)"


def test_pointcloud_patch_model_column_type():
    from app.models.pointcloud import POINTCLOUD_PATCH_MODELS, PointCloudPatchLOD0, PointCloudPatchLOD10
    col_type = PointCloudPatch.patch.property.columns[0].type
    assert isinstance(col_type, PCPatch)
    assert PointCloudPatchLOD0.__tablename__ == "pointcloud_patches_lod0"
    assert PointCloudPatchLOD10.__tablename__ == "pointcloud_patches_lod10"
    assert len(POINTCLOUD_PATCH_MODELS) == 11


def test_pcpatch_comparator_expressions():
    stmt_num_points = select(PointCloudPatch.patch.num_points())
    assert "PC_NumPoints" in str(stmt_num_points)

    stmt_envelope = select(PointCloudPatch.patch.envelope())
    assert "PC_Envelope" in str(stmt_envelope)

    stmt_summary = select(PointCloudPatch.patch.summary())
    assert "PC_Summary" in str(stmt_summary)


def test_pointcloud_metadata_model_and_center_wkt():
    from app.models.pointcloud import PointCloudMetadata
    from app.services.pointcloud.db_utils import _compute_center_wkt

    assert PointCloudMetadata.__tablename__ == "pointcloud_metadata"

    wkt = _compute_center_wkt(0.0, 10.0, 0.0, 20.0, 0.0, 30.0)
    assert wkt is not None
    assert "POINT Z (5.0 10.0 15.0)" in str(wkt)


import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.repositories.pointcloud_repository import PointCloudRepository
from app.schemas.filter import FilterCriterion

@pytest.mark.anyio
async def test_get_summary_info_transformation():
    mock_db = MagicMock()

    mock_summary_res = MagicMock()
    mock_summary_res.first.return_value = (12345, -10.0, -5.0, 0.0, 10.0, 5.0, 20.0)

    mock_fk_res = MagicMock()
    mock_fk_res.all.return_value = [("e360394b-a241-49e5-bb66-97fee8bd85ef",)]

    mock_meta = MagicMock()
    mock_meta.id = "e360394b-a241-49e5-bb66-97fee8bd85ef"
    mock_meta.orig_filename = "test.ply"
    mock_meta.number_of_points = 12345
    mock_meta_res = MagicMock()
    mock_meta_res.scalars.return_value.all.return_value = [mock_meta]

    mock_cam = MagicMock()
    mock_cam.id = "c160394b-a241-49e5-bb66-97fee8bd85ef"
    mock_cam.pointcloud_id = "e360394b-a241-49e5-bb66-97fee8bd85ef"
    mock_cam_res = MagicMock()
    mock_cam_res.scalars.return_value.all.return_value = [mock_cam]

    mock_db.execute = AsyncMock(side_effect=[mock_summary_res, mock_fk_res, mock_meta_res, mock_cam_res])

    repo = PointCloudRepository(mock_db)
    info = await repo.get_summary_info(filters=[FilterCriterion(field="pointcloud_id", operator="eq", value="e360394b-a241-49e5-bb66-97fee8bd85ef")], lod=0)
    assert info["total_points"] == 12345
    assert info["bounding_box"] == {
        "min_x": -10.0, "min_y": -5.0, "min_z": 0.0,
        "max_x": 10.0, "max_y": 5.0, "max_z": 20.0
    }
    assert info["center"] == [0.0, 0.0, 10.0]
    assert info["centerpoint"] == [0.0, 0.0, 10.0]
    assert len(info["connected_pointclouds"]) == 1
    assert info["connected_pointclouds"][0].id == "e360394b-a241-49e5-bb66-97fee8bd85ef"
    assert len(info["connected_camera_headers"]) == 1
    assert info["connected_camera_headers"][0].id == "c160394b-a241-49e5-bb66-97fee8bd85ef"


@pytest.mark.anyio
async def test_upsert_pointcloud_metadata_offset_transform_matrix():
    from app.services.pointcloud.db_utils import upsert_pointcloud_metadata
    from uuid import uuid4

    file_id = str(uuid4())
    mock_session = AsyncMock()
    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(return_value=mock_res)

    bbox = {"min_x": 0.0, "max_x": 10.0, "min_y": 0.0, "max_y": 10.0, "min_z": 0.0, "max_z": 5.0}
    rec = await upsert_pointcloud_metadata(
        session=mock_session,
        file_id=file_id,
        file_path="/tmp/test.laz",
        bbox=bbox,
        number_of_points=100,
        pcid=1,
        offset_x=15.0,
        offset_y=20.0
    )

    # Offset should shift min/max coords
    assert rec.min_x == 15.0
    assert rec.max_x == 25.0
    assert rec.min_y == 20.0
    assert rec.max_y == 30.0

    # transform_matrix must remain identity matrix (offset_x/y not added to matrix)
    assert rec.transform_matrix == [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]


@pytest.mark.anyio
async def test_ingest_pgpointcloud_transformation_stage():
    from app.services.pointcloud.pdal import ingest_pgpointcloud
    
    captured_pipeline = None

    async def fake_run_pdal_pipeline(pipeline, error_prefix=""):
        nonlocal captured_pipeline
        captured_pipeline = pipeline
        return 0, "", ""

    mock_session = AsyncMock()
    mock_res = MagicMock()
    mock_res.first.return_value = (1,)
    mock_session.execute = AsyncMock(return_value=mock_res)
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()

    class FakeSessionContext:
        async def __aenter__(self):
            return mock_session
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    with patch("app.services.pointcloud.pdal.run_pdal_pipeline", side_effect=fake_run_pdal_pipeline), \
         patch("app.services.pointcloud.pdal.get_pointcloud_dimensions", return_value=["X", "Y", "Z"]), \
         patch("app.services.pointcloud.pdal.async_session", return_value=FakeSessionContext()):

        await ingest_pgpointcloud(
            file_path="/tmp/test.laz",
            connection_str="postgresql://user:pass@localhost/db",
            pointcloud_id="11111111-1111-1111-1111-111111111111",
            lod=0,
            offset_x=15.0,
            offset_y=20.0
        )

        stages = captured_pipeline["pipeline"]
        tf_stages = [s for s in stages if isinstance(s, dict) and s.get("type") == "filters.transformation"]
        assert len(tf_stages) == 1
        assert tf_stages[0]["matrix"] == "1 0 0 15.0 0 1 0 20.0 0 0 1 0 0 0 0 1"


@pytest.mark.anyio
async def test_ingest_pointcloud_to_db_skips_overdecimated_lods():
    from app.services.worker.handlers.pointcloud import PointCloudUploadTaskHandler

    ingested_lods = []

    async def fake_ingest_pgpointcloud(*args, **kwargs):
        ingested_lods.append(kwargs.get("lod"))
        return 1

    handler = PointCloudUploadTaskHandler()

    with patch("app.services.worker.handlers.pointcloud.get_pointcloud_stats", return_value=({}, 400)), \
         patch("app.services.worker.handlers.pointcloud.get_pointcloud_dimensions", return_value=["X", "Y", "Z"]), \
         patch("app.services.worker.handlers.pointcloud.ingest_pgpointcloud", side_effect=fake_ingest_pgpointcloud), \
         patch("app.services.worker.handlers.pointcloud.upsert_pointcloud_metadata", AsyncMock()):

        await handler.ingest_pointcloud_to_db(
            file_path="/tmp/small.ply",
            file_id="22222222-2222-2222-2222-222222222222"
        )

    # For 400 points, steps 512 (LOD 9) and 1024 (LOD 10) exceed point count and should be skipped
    assert ingested_lods == [0, 1, 2, 3, 4, 5, 6, 7, 8]
    assert 9 not in ingested_lods
    assert 10 not in ingested_lods



