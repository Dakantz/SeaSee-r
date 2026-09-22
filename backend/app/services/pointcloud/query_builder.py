import uuid
import datetime
from typing import Dict, Any, Tuple, List, Optional
import logging

from app.schemas.filter import FilterCriterion

logger = logging.getLogger(__name__)

# Centralized Parameter Registry: Maps filter parameter names to table columns and types.
FILTER_FIELD_MAP = {
    "pointcloud_id": {"column": "pm.id", "type": "uuid"},
    "id": {"column": "pm.id", "type": "uuid"},
    "job_id": {"column": "pm.job_id", "type": "uuid"},
    "video_metadata_id": {"column": "pm.video_metadata_id", "type": "uuid"},
    "number_of_points": {"column": "pm.number_of_points", "type": "int"},
    "orig_filename": {"column": "pm.orig_filename", "type": "string"},
    "safe_filename": {"column": "pm.safe_filename", "type": "string"},
    "pcid": {"column": "pm.pcid", "type": "int"},
    "created_at": {"column": "pm.created_at", "type": "datetime"},
    "min_x": {"column": "pm.min_x", "type": "float", "is_spatial": True},
    "max_x": {"column": "pm.max_x", "type": "float", "is_spatial": True},
    "min_y": {"column": "pm.min_y", "type": "float", "is_spatial": True},
    "max_y": {"column": "pm.max_y", "type": "float", "is_spatial": True},
    "min_z": {"column": "pm.min_z", "type": "float", "is_spatial": True},
    "max_z": {"column": "pm.max_z", "type": "float", "is_spatial": True},
    "video_start_at": {"column": "vm.video_start_at", "type": "datetime"},
    "video_stop_at": {"column": "vm.video_stop_at", "type": "datetime"},
    "reconstruction_index": {"column": "pm.reconstruction_index", "type": "int"},
    "views": {"column": "pm.views", "type": "int"},
    "sparse_points": {"column": "pm.sparse_points", "type": "int"},
    "dense_points": {"column": "pm.dense_points", "type": "int"},
}

SPATIAL_FILTER_MAP = {
    "min_x": {"dim": "X", "patch_func": "PC_PatchMax", "bound_type": "min"},
    "max_x": {"dim": "X", "patch_func": "PC_PatchMin", "bound_type": "max"},
    "min_y": {"dim": "Y", "patch_func": "PC_PatchMax", "bound_type": "min"},
    "max_y": {"dim": "Y", "patch_func": "PC_PatchMin", "bound_type": "max"},
    "min_z": {"dim": "Z", "patch_func": "PC_PatchMax", "bound_type": "min"},
    "max_z": {"dim": "Z", "patch_func": "PC_PatchMin", "bound_type": "max"},
}

# Comparison operators matrix
OPERATORS = {
    "eq": "=",
    "ne": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "like": "LIKE",
    "in": "IN",
}


def parse_filter_key(key: str) -> Tuple[str, str]:
    """
    Parses an incoming parameter key like 'number_of_points__gte' or 'number_of_points_gte'
    into (field_name, operator_key). Defaults operator to 'eq'.
    """
    if "__" in key:
        field_name, op = key.rsplit("__", 1)
        return field_name, op

    for op in ("gte", "lte", "gt", "lt", "ne", "eq", "in", "like"):
        suffix = f"_{op}"
        if key.endswith(suffix):
            field_name = key[:-len(suffix)]
            if field_name in FILTER_FIELD_MAP:
                return field_name, op

    return key, "eq"


def cast_value(val: Any, val_type: str) -> Any:
    """Casts incoming raw parameter values to appropriate Python types."""
    if val is None:
        return None

    if isinstance(val, (list, tuple)):
        return [cast_value(item, val_type) for item in val]

    try:
        if val_type == "uuid":
            return str(uuid.UUID(str(val)))
        elif val_type == "int":
            return int(val)
        elif val_type == "float":
            return float(val)
        elif val_type == "datetime":
            if isinstance(val, datetime.datetime):
                return val
            return datetime.datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        elif val_type == "string":
            return str(val)
    except Exception as e:
        logger.warning(f"Failed to cast value {val} to type {val_type}: {e}")
        raise ValueError(f"Invalid {val_type} value '{val}'") from e
    return val


class PointCloudQueryBuilder:
    """
    Constructs parameterized SQL queries and bind parameter dictionaries for pointcloud streaming & summary.
    """

    @classmethod
    def build_query_components(
        cls,
        filters: Optional[List[FilterCriterion]] = None,
        lod: int = 0
    ) -> Tuple[str, str, str, Dict[str, Any], bool, List[str]]:
        """
        Builds patch where clauses, point where clauses, bind parameters, join requirements, and expanding parameters.

        Returns:
            (table_name, patch_where_sql, point_where_sql, bind_params, requires_video_join, expanding_params)
        """
        table_name = f"pointcloud_patches_lod{lod}"
        patch_where_clauses: List[str] = []
        point_where_clauses: List[str] = []
        bind_params: Dict[str, Any] = {}
        expanding_params: List[str] = []
        requires_video_join = False

        criterion_list = filters or []

        param_counter = 0
        for criterion in criterion_list:
            field_name = criterion.field
            op_key = criterion.operator
            raw_val = criterion.value

            if raw_val is None or field_name not in FILTER_FIELD_MAP:
                continue

            field_spec = FILTER_FIELD_MAP[field_name]
            val_type = field_spec.get("type", "string")

            bind_name = f"p_{param_counter}"
            param_counter += 1

            typed_val = cast_value(raw_val, val_type)

            if field_name in SPATIAL_FILTER_MAP:
                spatial_info = SPATIAL_FILTER_MAP[field_name]
                dim = spatial_info["dim"]
                patch_func = spatial_info["patch_func"]
                bound_type = spatial_info["bound_type"]

                if op_key == "gt":
                    sql_op = ">"
                elif op_key == "gte":
                    sql_op = ">="
                elif op_key == "lt":
                    sql_op = "<"
                elif op_key == "lte":
                    sql_op = "<="
                elif op_key == "ne":
                    sql_op = "!="
                else:  # "eq" or unspecified
                    sql_op = ">=" if bound_type == "min" else "<="

                patch_where_clauses.append(f"{patch_func}(p.patch, '{dim}') {sql_op} :{bind_name}")
                point_where_clauses.append(f"PC_Get(pt, '{dim}') {sql_op} :{bind_name}")
                bind_params[bind_name] = typed_val
            else:
                column_name = field_spec["column"]
                if column_name.startswith("vm."):
                    requires_video_join = True

                if op_key == "in":
                    val_list = typed_val if isinstance(typed_val, (list, tuple)) else [typed_val]
                    if not val_list:
                        continue
                    patch_where_clauses.append(f"{column_name} IN :{bind_name}")
                    bind_params[bind_name] = tuple(val_list)
                    expanding_params.append(bind_name)
                elif op_key == "like":
                    patch_where_clauses.append(f"{column_name} LIKE :{bind_name}")
                    bind_params[bind_name] = str(typed_val)
                else:
                    sql_operator = OPERATORS.get(op_key, "=")
                    patch_where_clauses.append(f"{column_name} {sql_operator} :{bind_name}")
                    bind_params[bind_name] = typed_val

        combined_patch_where = " AND ".join(patch_where_clauses) if patch_where_clauses else "1=1"
        combined_point_where = " AND ".join(point_where_clauses) if point_where_clauses else ""

        return table_name, combined_patch_where, combined_point_where, bind_params, requires_video_join, expanding_params

    @classmethod
    def build_binary_stream_query(
        cls,
        filters: Optional[List[FilterCriterion]] = None,
        lod: int = 0
    ) -> Tuple[str, Dict[str, Any], List[str]]:
        """
        Constructs the SQL string, bind parameters, and expanding parameter list for binary point streaming (/stream-binary).
        """
        table_name, patch_where_sql, point_where_sql, bind_params, requires_video_join, expanding_params = cls.build_query_components(
            filters=filters,
            lod=lod
        )

        video_join_clause = "LEFT JOIN video_metadata vm ON pm.video_metadata_id = vm.id" if requires_video_join else ""
        point_where_clause = f"\nWHERE {point_where_sql}" if point_where_sql else ""

        sql = f"""
            SELECT 
                PC_Get(pt, 'X')         as x,
                PC_Get(pt, 'Y')         as y,
                PC_Get(pt, 'Z')         as z,
                PC_Get(pt, 'Red')       as r,
                PC_Get(pt, 'Green')     as g,
                PC_Get(pt, 'Blue')      as b
            FROM (
                SELECT PC_Explode(p.patch) AS pt
                FROM {table_name} p
                JOIN pointcloud_metadata pm ON p.pointcloud_id = pm.id
                {video_join_clause}
                WHERE {patch_where_sql}
            ) AS exploded{point_where_clause};
        """
        # logger.info(f"Binary stream query: {sql}")
        return sql, bind_params, expanding_params

    @classmethod
    def has_spatial_filters(cls, filters: Optional[List[FilterCriterion]]) -> bool:
        """
        Determines whether any spatial bounding box filters (min_x, max_x, min_y, max_y, min_z, max_z) are present.
        """
        if not filters:
            return False
        for criterion in filters:
            if criterion.field in SPATIAL_FILTER_MAP and criterion.value is not None:
                return True
        return False

    @classmethod
    def build_summary_query(
        cls,
        filters: Optional[List[FilterCriterion]] = None,
        lod: int = 0
    ) -> Tuple[str, str, Dict[str, Any], List[str]]:
        """
        Constructs SQL strings for summary metrics and distinct pointcloud FK IDs (/stream-summary).
        If no spatial filters are applied, queries pointcloud_metadata directly for sub-millisecond execution.
        Returns (summary_sql, distinct_ids_sql, bind_params, expanding_params).
        """
        table_name, patch_where_sql, point_where_sql, bind_params, requires_video_join, expanding_params = cls.build_query_components(
            filters=filters,
            lod=lod
        )

        video_join_clause = "LEFT JOIN video_metadata vm ON pm.video_metadata_id = vm.id" if requires_video_join else ""

        if not cls.has_spatial_filters(filters):
            summary_sql = f"""
                SELECT 
                    COALESCE(SUM(pm.number_of_points), 0) AS total_points,
                    MIN(pm.min_x) AS min_x,
                    MIN(pm.min_y) AS min_y,
                    MIN(pm.min_z) AS min_z,
                    MAX(pm.max_x) AS max_x,
                    MAX(pm.max_y) AS max_y,
                    MAX(pm.max_z) AS max_z
                FROM pointcloud_metadata pm
                {video_join_clause}
                WHERE {patch_where_sql};
            """

            distinct_ids_sql = f"""
                SELECT DISTINCT pm.id
                FROM pointcloud_metadata pm
                {video_join_clause}
                WHERE {patch_where_sql};
            """
        else:
            summary_sql = f"""
                SELECT 
                    COALESCE(SUM(PC_NumPoints(p.patch)), 0) AS total_points,
                    MIN(PC_PatchMin(p.patch, 'X')) AS min_x,
                    MIN(PC_PatchMin(p.patch, 'Y')) AS min_y,
                    MIN(PC_PatchMin(p.patch, 'Z')) AS min_z,
                    MAX(PC_PatchMax(p.patch, 'X')) AS max_x,
                    MAX(PC_PatchMax(p.patch, 'Y')) AS max_y,
                    MAX(PC_PatchMax(p.patch, 'Z')) AS max_z
                FROM {table_name} p
                JOIN pointcloud_metadata pm ON p.pointcloud_id = pm.id
                {video_join_clause}
                WHERE {patch_where_sql};
            """

            distinct_ids_sql = f"""
                SELECT DISTINCT p.pointcloud_id
                FROM {table_name} p
                JOIN pointcloud_metadata pm ON p.pointcloud_id = pm.id
                {video_join_clause}
                WHERE {patch_where_sql};
            """

        # logger.info(f"Summary query: {summary_sql}")
        # logger.info(f"Distinct IDs query: {distinct_ids_sql}")
        return summary_sql, distinct_ids_sql, bind_params, expanding_params

