FROM condaforge/miniforge3:latest

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install PDAL, Entwine, and Python 3.11 from conda-forge
RUN mamba install -y -c conda-forge pdal entwine python=3.11 && \
    mamba clean -ya

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user (matching host UID 1000)
RUN userdel -f ubuntu || true && useradd -m -u 1000 -s /bin/bash appuser

# Copy backend app and change ownership
COPY --chown=appuser:appuser . .

# Make the startup script executable
RUN chmod +x start.sh

# Switch to the non-root user
USER appuser

EXPOSE 8000

CMD ["bash", "./start.sh"]
