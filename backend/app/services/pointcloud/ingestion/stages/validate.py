import os
import logging
from typing import Dict, Any
from app.services.pointcloud.ingestion.base import BaseIngestionStage

logger = logging.getLogger(__name__)

class ValidateStage(BaseIngestionStage):
    name = "ValidateStage"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        file_path = context.get("file_path")
        if not file_path or not os.path.exists(file_path):
            raise FileNotFoundError(f"Point cloud file not found at path: {file_path}")
        context["validated"] = True
        return context
