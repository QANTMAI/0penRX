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
3. Run any relevant tests/linters before pushing.
4. Open a pull request against `main` describing the change and why.

## Commit messages

- Use the imperative mood: "Add NADAC ingestion", not "Added".
- Keep the subject line under ~72 characters.
- Reference related issues (e.g. `Closes #12`).

## Data contributions

- Only use open or public pricing sources. Do not submit scraped data from sources whose terms prohibit it.
- Document the source, retrieval date, and license for any dataset.
- Normalize to the shared schema (drug, NDC, dose, pharmacy, price, source, date).

## Code style

- Python: follow PEP 8; format with Black and lint with Ruff.
- JavaScript/React: follow the project ESLint/Prettier config.
- Keep functions small and documented.

## Reporting security issues

Do not open public issues for security or credential-exposure problems. Contact the maintainers privately.

## License

By contributing, you agree that your contributions are licensed under the repository's LICENSE.
