from typing import Set, List, Optional, Any, Dict
from fastapi import Request, HTTPException

from app.schemas.filter import FilterCriterion

VALID_OPERATORS: Set[str] = {"eq", "ne", "gt", "gte", "lt", "lte", "in", "like"}
RESERVED_PARAMS: Set[str] = {"lod", "page", "limit", "predefined_query"}


class QueryFilterParser:
    """
    FastAPI dependency for extracting dynamic filter criteria from query parameters.
    Supports field__operator=value syntax as well as legacy field_operator=value and default field=value.
    """

    def __init__(
        self,
        allowed_fields: Set[str],
        reserved_params: Optional[Set[str]] = None,
        valid_operators: Optional[Set[str]] = None,
    ):
        self.allowed_fields = set(allowed_fields)
        self.reserved_params = set(reserved_params) if reserved_params is not None else RESERVED_PARAMS
        self.valid_operators = set(valid_operators) if valid_operators is not None else VALID_OPERATORS

    def _parse_key(self, key: str) -> tuple[str, str]:
        """
        Parses a query key into (field, operator).
        Handles field__operator, field_operator (if field matches allowed_fields), or defaults operator to 'eq'.
        """
        if "__" in key:
            field, operator = key.rsplit("__", 1)
            return field, operator

        # Check for single-underscore suffix for backward compatibility (e.g., number_of_points_gte)
        for op in self.valid_operators:
            suffix = f"_{op}"
            if key.endswith(suffix):
                candidate = key[:-len(suffix)]
                if candidate in self.allowed_fields:
                    return candidate, op

        return key, "eq"

    def _parse_value(self, operator: str, raw_value: str) -> Any:
        """
        Parses raw string value into Python data structure according to operator.
        """
        if operator == "in":
            if isinstance(raw_value, str):
                return [v.strip() for v in raw_value.split(",") if v.strip()]
            elif isinstance(raw_value, (list, tuple)):
                result = []
                for item in raw_value:
                    if isinstance(item, str):
                        result.extend([v.strip() for v in item.split(",") if v.strip()])
                    else:
                        result.append(item)
                return result
        return raw_value

    def __call__(self, request: Request) -> List[FilterCriterion]:
        filters: List[FilterCriterion] = []
        # Mapping to merge duplicate 'in' params if specified across multiple query parameters
        in_filters_map: Dict[str, FilterCriterion] = {}

        for key, raw_val in request.query_params.multi_items():
            if key in self.reserved_params:
                continue

            field, operator = self._parse_key(key)

            if field not in self.allowed_fields:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid or unauthorized filter field '{field}'. Allowed fields: {sorted(list(self.allowed_fields))}"
                )

            if operator not in self.valid_operators:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid filter operator '{operator}'. Valid operators: {sorted(list(self.valid_operators))}"
                )

            parsed_val = self._parse_value(operator, raw_val)

            if operator == "in":
                if field in in_filters_map:
                    existing_criterion = in_filters_map[field]
                    if isinstance(parsed_val, list):
                        existing_criterion.value.extend(parsed_val)
                    else:
                        existing_criterion.value.append(parsed_val)
                else:
                    criterion = FilterCriterion(
                        field=field,
                        operator=operator,
                        value=parsed_val if isinstance(parsed_val, list) else [parsed_val]
                    )
                    in_filters_map[field] = criterion
                    filters.append(criterion)
            else:
                filters.append(FilterCriterion(field=field, operator=operator, value=parsed_val))

        return filters
