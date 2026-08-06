import asyncio
import logging
from typing import Dict, Any
from app.services.worker.handlers.base import BaseTaskHandler

logger = logging.getLogger(__name__)

class VideoTaskHandler(BaseTaskHandler):
    task_types = ["video_upload", "video_reconstruction"]

    async def execute(self, job_id: str, payload: Dict[str, Any], name: str = "") -> Dict[str, Any]:
        filename = payload.get("filename", "video")
        await self.update_job_status(job_id, "RUNNING", 10.0)
        await asyncio.sleep(1)
        await self.update_job_status(job_id, "RUNNING", 50.0)
        await asyncio.sleep(1)
        res_data = {
            "status": "success",
            "job_id": job_id,
            "message": f"Video processing completed for {filename}",
            "video_id": payload.get("file_id"),
            "batch_id": payload.get("batch_id")
        }
        await self.update_job_status(job_id, "COMPLETED", 100.0, result=res_data)
        return res_data
