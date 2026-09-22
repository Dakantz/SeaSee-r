import pytest
from fastapi import Request, HTTPException
from app.api.dependencies.filter_parser import QueryFilterParser
from app.schemas.filter import FilterCriterion

ALLOWED_FIELDS = {"pointcloud_id", "number_of_points", "video_start_at", "orig_filename"}


def make_request(query_string: str) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/test",
        "query_string": query_string.encode("utf-8"),
        "headers": [],
    }
    return Request(scope)


def test_parser_exact_match():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("pointcloud_id=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
    filters = parser(req)
    assert len(filters) == 1
    assert filters[0] == FilterCriterion(field="pointcloud_id", operator="eq", value="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")


def test_parser_double_underscore_operator():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("number_of_points__gte=1000&video_start_at__lt=2026-01-01T00:00:00Z")
    filters = parser(req)
    assert len(filters) == 2
    assert filters[0] == FilterCriterion(field="number_of_points", operator="gte", value="1000")
    assert filters[1] == FilterCriterion(field="video_start_at", operator="lt", value="2026-01-01T00:00:00Z")


def test_parser_single_underscore_operator():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("number_of_points_gte=1000")
    filters = parser(req)
    assert len(filters) == 1
    assert filters[0] == FilterCriterion(field="number_of_points", operator="gte", value="1000")


def test_parser_in_operator_comma_separated():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    u1 = "11111111-1111-1111-1111-111111111111"
    u2 = "22222222-2222-2222-2222-222222222222"
    u3 = "33333333-3333-3333-3333-333333333333"
    req = make_request(f"pointcloud_id__in={u1},{u2},{u3}")
    filters = parser(req)
    assert len(filters) == 1
    assert filters[0] == FilterCriterion(field="pointcloud_id", operator="in", value=[u1, u2, u3])


def test_parser_like_operator():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("orig_filename__like=underwater%")
    filters = parser(req)
    assert len(filters) == 1
    assert filters[0] == FilterCriterion(field="orig_filename", operator="like", value="underwater%")


def test_parser_reserved_params_ignored():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    u1 = "11111111-1111-1111-1111-111111111111"
    req = make_request(f"lod=2&page=1&limit=50&pointcloud_id={u1}")
    filters = parser(req)
    assert len(filters) == 1
    assert filters[0] == FilterCriterion(field="pointcloud_id", operator="eq", value=u1)


def test_parser_unauthorized_field_raises_400():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("unauthorized_field=123")
    with pytest.raises(HTTPException) as exc_info:
        parser(req)
    assert exc_info.value.status_code == 400
    assert "Invalid or unauthorized filter field" in exc_info.value.detail


def test_parser_invalid_operator_raises_400():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("number_of_points__invalidop=100")
    with pytest.raises(HTTPException) as exc_info:
        parser(req)
    assert exc_info.value.status_code == 400
    assert "Invalid filter operator" in exc_info.value.detail


def test_parser_invalid_type_raises_400():
    parser = QueryFilterParser(allowed_fields=ALLOWED_FIELDS)
    req = make_request("number_of_points__gte=490e4bfb-d08b-5ebc-b039-a9ce436dd944")
    with pytest.raises(HTTPException) as exc_info:
        parser(req)
    assert exc_info.value.status_code == 400
    assert "Invalid input format for filter field 'number_of_points'" in exc_info.value.detail


def test_parser_all_pointcloud_metadata_fields():
    from app.api.dependencies.pointcloud import POINTCLOUD_ALLOWED_FIELDS
    parser = QueryFilterParser(allowed_fields=POINTCLOUD_ALLOWED_FIELDS)
    req = make_request("min_x__gte=10.5&pcid=4326&safe_filename=clean.ply")
    filters = parser(req)
    assert len(filters) == 3
    assert FilterCriterion(field="min_x", operator="gte", value="10.5") in filters
    assert FilterCriterion(field="pcid", operator="eq", value="4326") in filters
    assert FilterCriterion(field="safe_filename", operator="eq", value="clean.ply") in filters

