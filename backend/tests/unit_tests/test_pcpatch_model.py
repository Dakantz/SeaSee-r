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
from unittest.mock import AsyncMock, MagicMock
from app.repositories.pointcloud_repository import PointCloudRepository

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
    query = "SELECT PC_Explode(patch) AS pt FROM pointcloud_patches WHERE pointcloud_id = 'e360394b-a241-49e5-bb66-97fee8bd85ef'"

    info = await repo.get_summary_info(query, lod=0)
    assert info["total_points"] == 12345
    assert info["bounding_box"] == {
        "min_x": -10.0, "min_y": -5.0, "min_z": 0.0,
        "max_x": 10.0, "max_y": 5.0, "max_z": 20.0
    }
    assert len(info["connected_pointclouds"]) == 1
    assert info["connected_pointclouds"][0].id == "e360394b-a241-49e5-bb66-97fee8bd85ef"
    assert len(info["connected_camera_headers"]) == 1
    assert info["connected_camera_headers"][0].id == "c160394b-a241-49e5-bb66-97fee8bd85ef"

