FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /srv/backend
COPY pyproject.toml ./
RUN uv sync --no-dev
COPY app ./app
COPY mcp_server.py ./
ENV LOKHAND_LOG_DATA_DIR=/srv/data
EXPOSE 8000 8765
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
