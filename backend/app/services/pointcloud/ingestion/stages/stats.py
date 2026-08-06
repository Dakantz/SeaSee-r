import logging
from typing import Dict, Any
from app.services.pointcloud.ingestion.base import BaseIngestionStage
from app.services.pointcloud.pdal import get_pointcloud_stats

logger = logging.getLogger(__name__)

class StatsStage(BaseIngestionStage):
    name = "StatsStage"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        file_path = context.get("file_path")
        bbox, number_of_points = await get_pointcloud_stats(file_path)
        context["bbox"] = bbox
        context["number_of_points"] = number_of_points
        return context
