FROM python:3.12-slim

WORKDIR /srv/profit-compass

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

ENV PC_FRONTEND_DIR=/srv/profit-compass/frontend \
    PC_DATA_DIR=/srv/profit-compass/backend/data \
    PC_DB_PATH=/tmp/profit-compass.db \
    PYTHONUNBUFFERED=1

EXPOSE 8000
WORKDIR /srv/profit-compass/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
