import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select

from app.core.database import async_session
from app.models.log_data import LogData


@pytest.mark.anyio
async def test_get_batch_logs_routes(client):
    batch_uuid = uuid.uuid4()
    log_id1 = uuid.uuid4()
    log_id2 = uuid.uuid4()
    log_id3 = uuid.uuid4()

    # Insert sample log rows
    async with async_session() as db:
        rows = [
            LogData(
                id=log_id1,
                batch_id=batch_uuid,
                timestamp=1777974510000,
                time_recorded=datetime.fromtimestamp(1777974510.0, tz=timezone.utc),
                payload={"depth": 1.25, "temperature": 21.5, "yaw": 100.0}
            ),
            LogData(
                id=log_id2,
                batch_id=batch_uuid,
                timestamp=1777974515000,
                time_recorded=datetime.fromtimestamp(1777974515.0, tz=timezone.utc),
                payload={"depth": 3.5, "temperature": 20.8, "yaw": 105.0}
            ),
            LogData(
                id=log_id3,
                batch_id=batch_uuid,
                timestamp=1777974520000,
                time_recorded=datetime.fromtimestamp(1777974520.0, tz=timezone.utc),
                payload={"depth": 5.0, "temperature": 19.9, "yaw": 110.0}
            )
        ]
        db.add_all(rows)
        await db.commit()

    # 1. Test GET /videos/batches/{batch_id}/logs
    res1 = client.get(f"/videos/batches/{batch_uuid}/logs")
    assert res1.status_code == 200
    data1 = res1.json()
    assert len(data1) == 3
    assert data1[0]["id"] == str(log_id1)
    assert data1[0]["timestamp"] == 1777974510000
    assert data1[0]["batch_id"] == str(batch_uuid)
    assert data1[0]["payload"]["depth"] == 1.25
    assert data1[0]["payload"]["temperature"] == 21.5

    # 2. Test GET /videos/batches/{batch_id}/logs with timerange filter (ms)
    res2 = client.get(f"/videos/batches/{batch_uuid}/logs?start_time=1777974512000&end_time=1777974518000")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2) == 1
    assert data2[0]["id"] == str(log_id2)

    # 3. Test GET /logs?batch_id=... with ISO datetime strings
    res3 = client.get(f"/logs?batch_id={batch_uuid}&start_time=2026-05-05T00:00:00Z&end_time=2030-01-01T00:00:00Z")
    assert res3.status_code == 200
    data3 = res3.json()
    assert len(data3) == 3

    # 4. Test GET /logs/{batch_id}
    res4 = client.get(f"/logs/{batch_uuid}")
    assert res4.status_code == 200
    data4 = res4.json()
    assert len(data4) == 3
