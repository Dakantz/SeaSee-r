import logging
from typing import List, Dict, Any
from app.services.pointcloud.ingestion.base import BaseIngestionStage

logger = logging.getLogger(__name__)

class IngestionPipeline:
    """
    Pipeline orchestrator that executes a series of ingestion stages sequentially.
    """
    def __init__(self, stages: List[BaseIngestionStage] = None):
        self.stages: List[BaseIngestionStage] = stages or []

    def add_stage(self, stage: BaseIngestionStage) -> "IngestionPipeline":
        self.stages.append(stage)
        return self

    async def run(self, initial_context: Dict[str, Any]) -> Dict[str, Any]:
        context = dict(initial_context)
        for stage in self.stages:
            stage_name = getattr(stage, "name", stage.__class__.__name__)
            logger.info(f"Executing ingestion pipeline stage: {stage_name}")
            context = await stage.process(context)
        return context
