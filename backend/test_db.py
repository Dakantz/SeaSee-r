import asyncio
from app.core.database import async_session
from app.models.video import Video
from app.schemas.video import VideoResponse
from sqlalchemy import select

async def main():
    async with async_session() as db:
        stmt = select(Video).limit(10)
        result = await db.execute(stmt)
        videos = result.scalars().all()
        for v in videos:
            print("DB Video:", v.__dict__)
            try:
                vr = VideoResponse.model_validate(v)
                print("Validated:", vr)
            except Exception as e:
                print("Validation Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
