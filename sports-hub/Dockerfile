FROM python:3.12-slim
# Standard library only: no pip install, nothing to audit beyond this folder.
WORKDIR /app
COPY app/ /app/
RUN useradd --uid 10001 --no-create-home sports && mkdir -p /preferences && chown sports /preferences
USER sports
ENV PORT=8080 TEAM_PREFERENCES_DB=/preferences/teams.sqlite3 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=4)"
CMD ["python", "/app/server.py"]
