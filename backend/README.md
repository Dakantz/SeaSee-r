# SeaSee-r Backend

This directory contains the FastAPI backend for the SeaSee-r project. It is structured to provide a robust, type-safe API using Pydantic, and is designed to integrate seamlessly with the frontend via auto-generated TypeScript clients.

## Infrastructure

- **Framework**: FastAPI
- **Server**: Uvicorn
- **Data Validation**: Pydantic
- **Future Integration**: Prepared for `pgPointcloud` database separation.

---

## Startup Instructions

### 1. Activate conda environment
```powershell
conda activate base
```

### 2. Install backend dependencies

Install packages via `requirements.txt`:

```powershell
pip install -r requirements.txt
```

### 3. Run the backend

```powershell
uvicorn main:app --reload
```

The backend should then be available at `http://127.0.0.1:8000`.

You can also open the interactive API docs at `http://127.0.0.1:8000/docs`.

### 4. Testing

The backend includes a `pytest` suite configured to use `httpx` and FastAPI's `TestClient` for isolated endpoint testing.

**Install development dependencies:**
```bash
pip install -r requirements-dev.txt
```

**Run the test suite:**
```bash
pytest -v
```

Tests are located in the `tests/` directory, structured to mirror the `routes/` module layout.
