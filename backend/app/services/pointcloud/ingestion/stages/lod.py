import logging
from typing import Dict, Any
from app.services.pointcloud.ingestion.base import BaseIngestionStage
from app.services.pointcloud.pdal import ingest_pgpointcloud, format_libpq_connection_string
from app.core.config import settings

logger = logging.getLogger(__name__)

class LODGenerationStage(BaseIngestionStage):
    name = "LODGenerationStage"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        file_path = context.get("file_path")
        file_id = context.get("file_id")
        connection_str = format_libpq_connection_string(settings.database_url)
        lods = context.get("lods", [1, 2, 3])

        for lod in lods:
            logger.info(f"Generating LOD {lod} for {file_id}")
            await ingest_pgpointcloud(file_path, file_id, connection_str, lod=lod)
            
        context["lods_generated"] = lods
        return context
