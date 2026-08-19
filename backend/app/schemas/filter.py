from dataclasses import dataclass
from typing import Any


@dataclass
class FilterCriterion:
    """
    Represents a single query parameter filter condition.
    """
    field: str
    operator: str
    value: Any
