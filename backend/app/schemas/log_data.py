import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from pydantic import BaseModel, ConfigDict


class LogDataResponse(BaseModel):
    id: uuid.UUID
    timestamp: int
    time_recorded: Optional[datetime] = None
    payload: Dict[str, Any]
    batch_id: Optional[uuid.UUID] = None

    model_config = ConfigDict(from_attributes=True)
