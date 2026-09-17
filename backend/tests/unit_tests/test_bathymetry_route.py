import io
import pytest
from PIL import Image
import numpy as np
from app.api.routes.bathymetry import (
    tile_to_bbox_3857,
    select_pyramid_table,
    encode_terrain_rgb
)


def test_tile_to_bbox_3857():
    xmin, ymin, xmax, ymax = tile_to_bbox_3857(0, 0, 0)
    assert pytest.approx(xmin, rel=1e-4) == -20037508.342789244
    assert pytest.approx(xmax, rel=1e-4) == 20037508.342789244
    assert pytest.approx(ymin, rel=1e-4) == -20037508.342789244
    assert pytest.approx(ymax, rel=1e-4) == 20037508.342789244


def test_select_pyramid_table():
    assert select_pyramid_table(2) == "o_16_bathymetry_raster"
    assert select_pyramid_table(6) == "o_8_bathymetry_raster"
    assert select_pyramid_table(8) == "o_4_bathymetry_raster"
    assert select_pyramid_table(10) == "o_2_bathymetry_raster"
    assert select_pyramid_table(14) == "bathymetry_raster"


def test_encode_terrain_rgb():
    grid = np.zeros((256, 256), dtype=np.float32)
    grid[0, 0] = 100.0

    png_bytes = encode_terrain_rgb(grid)
    assert isinstance(png_bytes, bytes)

    img = Image.open(io.BytesIO(png_bytes))
    assert img.size == (256, 256)
    assert img.mode == "RGB"

    r, g, b = img.getpixel((0, 0))
    val = (r * 256 * 256) + (g * 256) + b
    decoded_elevation = -10000.0 + (val * 0.1)
    assert pytest.approx(decoded_elevation, abs=0.2) == 100.0


def test_encode_terrain_rgb_debug_border():
    grid = np.zeros((256, 256), dtype=np.float32)
    png_bytes = encode_terrain_rgb(grid, draw_border=True)
    img = Image.open(io.BytesIO(png_bytes))

    assert img.getpixel((0, 0)) == (255, 255, 255)
    assert img.getpixel((255, 0)) == (255, 255, 255)
    assert img.getpixel((0, 255)) == (255, 255, 255)
    assert img.getpixel((255, 255)) == (255, 255, 255)
    assert img.getpixel((10, 10)) != (255, 255, 255)


def test_upload_emodnet_csv_invalid_file_extension():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    
    response = client.post(
        "/bathymetry/upload-emodnet-csv",
        files={"file": ("test.txt", b"invalid data", "text/plain")}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Only .csv files are supported."


def test_upload_emodnet_csv_success():
    from unittest.mock import MagicMock, AsyncMock, patch
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import get_db_session

    client = TestClient(app)

    mock_db = MagicMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()

    app.dependency_overrides[get_db_session] = lambda: mock_db

    try:
        with patch("app.api.routes.bathymetry.enqueue_job"):
            response = client.post(
                "/bathymetry/upload-emodnet-csv",
                files={"file": ("test.csv", b"X,Y,Z\n1,2,3\n", "text/csv")}
            )
            assert response.status_code == 201
            data = response.json()
            assert "job_id" in data
            assert data["message"] == "EMODnet CSV uploaded successfully and processing job enqueued."
    finally:
        app.dependency_overrides.clear()


def test_get_bathymetry_tile_success():
    from unittest.mock import MagicMock, AsyncMock, patch
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import get_db_session

    client = TestClient(app)

    mock_db = MagicMock()
    mock_res_table = MagicMock()
    mock_res_table.scalar.return_value = True

    mock_res_tile = MagicMock()
    mock_res_tile.first.return_value = [[[10.0] * 256] * 256]

    mock_db.execute = AsyncMock(side_effect=[mock_res_table, mock_res_tile])

    app.dependency_overrides[get_db_session] = lambda: mock_db

    try:
        with patch("app.api.routes.bathymetry.get_connected_pointcloud_bbox", new_callable=AsyncMock) as mock_bbox:
            mock_bbox.return_value = None  # No bbox constraint -> fallback to normal raster query
            response = client.get("/bathymetry/10/500/300.png")
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            img = Image.open(io.BytesIO(response.content))
            assert img.size == (256, 256)
    finally:
        app.dependency_overrides.clear()


def test_get_bathymetry_tile_outside_bbox_returns_empty():
    from unittest.mock import MagicMock, AsyncMock, patch
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import get_db_session
    from app.api.routes.bathymetry import tile_to_bbox_3857

    client = TestClient(app)
    mock_db = MagicMock()
    mock_db.execute = AsyncMock()

    app.dependency_overrides[get_db_session] = lambda: mock_db

    # tile (10, 500, 300) bounding box
    xmin, ymin, xmax, ymax = tile_to_bbox_3857(10, 500, 300)

    # Pointcloud bbox completely far away from (500, 300) tile
    far_bbox = (xmax + 10000.0, ymax + 10000.0, xmax + 20000.0, ymax + 20000.0)

    try:
        with patch("app.api.routes.bathymetry.get_connected_pointcloud_bbox", new_callable=AsyncMock) as mock_bbox:
            mock_bbox.return_value = far_bbox
            response = client.get("/bathymetry/10/500/300.png")
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/png"
            
            # Since it's outside bbox, DB execute for raster table check/query should NOT be called
            assert mock_db.execute.call_count == 0

            img = Image.open(io.BytesIO(response.content))
            assert img.size == (256, 256)
            # Verify image pixel is empty (0 elevation -> terrain RGB encoded)
            r, g, b = img.getpixel((0, 0))
            val = (r * 256 * 256) + (g * 256) + b
            elev = -10000.0 + (val * 0.1)
            assert pytest.approx(elev, abs=0.2) == 0.0
    finally:
        app.dependency_overrides.clear()


def test_get_bathymetry_tile_inside_bbox_queries_raster():
    from unittest.mock import MagicMock, AsyncMock, patch
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import get_db_session
    from app.api.routes.bathymetry import tile_to_bbox_3857

    client = TestClient(app)
    mock_db = MagicMock()

    mock_res_table = MagicMock()
    mock_res_table.scalar.return_value = True

    mock_res_tile = MagicMock()
    mock_res_tile.first.return_value = [[[50.0] * 256] * 256]

    mock_db.execute = AsyncMock(side_effect=[mock_res_table, mock_res_tile])

    app.dependency_overrides[get_db_session] = lambda: mock_db

    # Tile bbox overlaps pointcloud bbox
    xmin, ymin, xmax, ymax = tile_to_bbox_3857(10, 500, 300)
    overlapping_bbox = (xmin - 100.0, ymin - 100.0, xmax + 100.0, ymax + 100.0)

    try:
        with patch("app.api.routes.bathymetry.get_connected_pointcloud_bbox", new_callable=AsyncMock) as mock_bbox:
            mock_bbox.return_value = overlapping_bbox
            response = client.get("/bathymetry/10/500/300.png")
            assert response.status_code == 200
            assert mock_db.execute.call_count == 2
    finally:
        app.dependency_overrides.clear()


def test_get_bathymetry_info_uses_pointcloud_bbox():
    from unittest.mock import MagicMock, AsyncMock, patch
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import get_db_session

    client = TestClient(app)
    mock_db = MagicMock()

    app.dependency_overrides[get_db_session] = lambda: mock_db

    try:
        with patch("app.api.routes.bathymetry.get_connected_pointcloud_bbox", new_callable=AsyncMock) as mock_bbox:
            mock_bbox.return_value = (1000.0, 2000.0, 5000.0, 6000.0)
            response = client.get("/bathymetry/info")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "available"
            assert data["bbox_3857"] == {"xmin": 1000.0, "ymin": 2000.0, "xmax": 5000.0, "ymax": 6000.0}
            assert "z6" in data["recommended_test_tiles"]
    finally:
        app.dependency_overrides.clear()



