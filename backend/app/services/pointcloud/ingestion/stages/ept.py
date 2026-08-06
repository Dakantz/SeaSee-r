import logging
from typing import Dict, Any
from app.services.pointcloud.ingestion.base import BaseIngestionStage
from app.services.pointcloud.entwine import build_ept

logger = logging.getLogger(__name__)

class EPTBuildStage(BaseIngestionStage):
    name = "EPTBuildStage"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        file_path = context.get("file_path")
        file_id = context.get("file_id")
        
        await build_ept(file_path, file_id)
        context["ept_built"] = True
        return context
