FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app
COPY simulator ./simulator
COPY tools ./tools
COPY tests ./tests
COPY devices.json .
USER app
CMD ["python", "-m", "simulator.main"]
