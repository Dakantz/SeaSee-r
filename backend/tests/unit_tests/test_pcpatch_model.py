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

