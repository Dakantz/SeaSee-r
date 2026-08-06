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
        with patch("app.api.routes.bathymetry.Redis.from_url"), \
             patch("app.api.routes.bathymetry.Queue"):
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

