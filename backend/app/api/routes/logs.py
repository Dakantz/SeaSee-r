import uuid
from typing import List, Optional, Union
from datetime import datetime, timezone
from dateutil import parser as date_parser

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db_session
from app.models.log_data import LogData
from app.schemas.log_data import LogDataResponse

router = APIRouter(
    prefix="/logs",
    tags=["Logs"]
)


def parse_timestamp_to_ms(val: Optional[Union[str, int, float, datetime]]) -> Optional[int]:
    """Helper to convert various timestamp representations (ms, seconds, ISO string, datetime) to epoch ms."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        # If value is less than 1e11 (Sat Mar 03 1973 in ms), it's in seconds (e.g. 1777974510.472)
        if val < 1e11:
            return int(val * 1000)
        return int(val)
    if isinstance(val, datetime):
        return int(val.timestamp() * 1000)
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # Try numeric parse first
        try:
            num = float(val)
            if num < 1e11:
                return int(num * 1000)
            return int(num)
        except ValueError:
            pass
        # Try datetime string parse
        try:
            dt = date_parser.parse(val)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except Exception:
            return None
    return None


@router.get("", response_model=List[LogDataResponse])
@router.get("/", response_model=List[LogDataResponse], include_in_schema=False)
async def get_logs(
    batch_id: Optional[uuid.UUID] = Query(None, description="Batch UUID to filter log data"),
    start_time: Optional[str] = Query(None, description="Start of timerange (ms, s, or ISO datetime string)"),
    end_time: Optional[str] = Query(None, description="End of timerange (ms, s, or ISO datetime string)"),
    start_ts: Optional[Union[int, float]] = Query(None, description="Start timestamp (ms or s)"),
    end_ts: Optional[Union[int, float]] = Query(None, description="End timestamp (ms or s)"),
    min_timestamp: Optional[Union[int, float]] = Query(None, description="Min timestamp (ms or s)"),
    max_timestamp: Optional[Union[int, float]] = Query(None, description="Max timestamp (ms or s)"),
    limit: Optional[int] = Query(None, ge=1, le=100000, description="Max records to return"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get log_data for a specific timerange and/or a specific batch_id.
    """
    start_ms = parse_timestamp_to_ms(start_ts if start_ts is not None else (min_timestamp if min_timestamp is not None else start_time))
    end_ms = parse_timestamp_to_ms(end_ts if end_ts is not None else (max_timestamp if max_timestamp is not None else end_time))

    stmt = select(LogData)
    if batch_id is not None:
        stmt = stmt.where(LogData.batch_id == batch_id)
    if start_ms is not None:
        stmt = stmt.where(LogData.timestamp >= start_ms)
    if end_ms is not None:
        stmt = stmt.where(LogData.timestamp <= end_ms)

    stmt = stmt.order_by(LogData.timestamp.asc())
    if limit is not None and limit > 0:
        stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{batch_id}", response_model=List[LogDataResponse])
async def get_logs_by_batch(
    batch_id: uuid.UUID,
    start_time: Optional[str] = Query(None, description="Start of timerange (ms, s, or ISO datetime string)"),
    end_time: Optional[str] = Query(None, description="End of timerange (ms, s, or ISO datetime string)"),
    start_ts: Optional[Union[int, float]] = Query(None, description="Start timestamp (ms or s)"),
    end_ts: Optional[Union[int, float]] = Query(None, description="End timestamp (ms or s)"),
    min_timestamp: Optional[Union[int, float]] = Query(None, description="Min timestamp (ms or s)"),
    max_timestamp: Optional[Union[int, float]] = Query(None, description="Max timestamp (ms or s)"),
    limit: Optional[int] = Query(None, ge=1, le=100000, description="Max records to return"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get log_data for a specific batch_id and optional timerange.
    """
    return await get_logs(
        batch_id=batch_id,
        start_time=start_time,
        end_time=end_time,
        start_ts=start_ts,
        end_ts=end_ts,
        min_timestamp=min_timestamp,
        max_timestamp=max_timestamp,
        limit=limit,
        db=db,
    )
