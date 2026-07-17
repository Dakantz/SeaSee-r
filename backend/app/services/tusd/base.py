from pydantic import BaseModel
from typing import Dict, Any

class WebhookPayload(BaseModel):
    event_name: str
    file_id: str
    upload_type: str
    filename: str
    safe_filename: str
    total_bytes: int
    original_file_path: str
    metadata: Dict[str, Any]
    upload_data: Dict[str, Any]
