.PHONY: install dev test lint serve-frontend

install:
	pip install -r backend/requirements.txt
	pip install ruff pytest

dev:
	uvicorn app:app --reload --app-dir backend

test:
	pytest -q

lint:
	ruff check .

serve-frontend:
	python -m http.server 8080
