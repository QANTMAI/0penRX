# Contributing to 0penRX

Thanks for your interest in improving prescription price transparency. This guide explains how to contribute.

## Ways to contribute

- Report bugs or data inaccuracies via Issues.
- Propose new public/open data sources for drug pricing.
- Improve ingestion, normalization, the API, or the UI.
- Improve documentation.

## Development workflow

1. Fork the repo and create a feature branch from `main`:
   `git checkout -b feature/short-description`
2. Make focused commits with clear messages.
3. Run the linter and tests before pushing:
   `make lint && make test` (requires Python 3.12+).
4. Open a pull request against `main` describing the change and why.

CI runs the same `ruff` lint and `pytest` suite on every pull request.

## Commit messages

- Use the imperative mood: "Add NADAC ingestion", not "Added".
- Keep the subject line under ~72 characters.
- Reference related issues (e.g. `Closes #12`).

## Data contributions

- Only use open or public pricing sources. Do not submit scraped data from sources whose terms prohibit it.
- Document the source, retrieval date, and license for any dataset.
- Normalize to the shared schema (drug, NDC, dose, pharmacy, price, source, date).

## Code style

- **Python** (backend + ingestion): follow PEP 8; lint with Ruff
  (`ruff check .`). Target Python 3.12+.
- **Frontend**: the UI is a single static `index.html` at the repo root with no
  build step or framework. Keep it dependency-free and self-contained; test by
  opening it in a browser (`make serve-frontend`).
- Keep functions small and documented.

## Reporting security issues

Do not open public issues for security, data-integrity, or credential-exposure
problems. Use GitHub private vulnerability reporting and follow the process in
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the repository's LICENSE.
