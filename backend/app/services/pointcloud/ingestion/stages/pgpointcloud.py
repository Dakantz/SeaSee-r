import logging
from typing import Dict, Any
from app.services.pointcloud.ingestion.base import BaseIngestionStage
from app.services.pointcloud.pdal import ingest_pgpointcloud, format_libpq_connection_string
from app.core.config import settings

logger = logging.getLogger(__name__)

class PgPointCloudIngestStage(BaseIngestionStage):
    name = "PgPointCloudIngestStage"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        file_path = context.get("file_path")
        file_id = context.get("file_id")
        connection_str = format_libpq_connection_string(settings.database_url)
        
        await ingest_pgpointcloud(file_path, file_id, connection_str, lod=0)
        context["base_ingested"] = True
        return context
