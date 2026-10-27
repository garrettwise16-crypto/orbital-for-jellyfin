FROM python:3.12-slim
# The container and guided installer run the same public implementation.
WORKDIR /app
COPY setup/sports_service/app/ /app/
RUN useradd --uid 10001 --no-create-home sports && mkdir -p /preferences && chown sports /preferences
USER sports
ENV PORT=8080 SPORTS_BIND=0.0.0.0 SPORTS_STANDALONE=1 SPORTS_DATA_DIR=/preferences TEAM_PREFERENCES_DB=/preferences/teams.sqlite3 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=4)"
CMD ["python", "/app/service.py"]
