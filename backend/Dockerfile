FROM condaforge/miniforge3:latest

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    postgresql-client \
    postgis \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install PDAL, Entwine, and Python 3.11 from conda-forge in a dedicated environment
RUN mamba create -n app_env -y -c conda-forge python=3.11 pdal entwine && \
    mamba clean -ya

ENV PATH=/opt/conda/envs/app_env/bin:$PATH

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user (matching host UID/GID dynamically)
ARG USER_ID=1000
ARG GROUP_ID=1000

RUN userdel -f ubuntu || true && \
    (groupadd -g ${GROUP_ID} appgroup 2>/dev/null || true) && \
    (useradd -m -u ${USER_ID} -g ${GROUP_ID} -s /bin/bash appuser 2>/dev/null || useradd -m -u ${USER_ID} -s /bin/bash appuser)

# Copy backend app and change ownership
COPY --chown=appuser:appuser . .

# Make the startup script executable
RUN chmod +x start.sh

# Switch to the non-root user
USER appuser

EXPOSE 8000

CMD ["bash", "./start.sh"]
