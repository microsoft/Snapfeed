# Contributing to Snapfeed

Thank you for your interest in contributing to Snapfeed! This document provides
guidelines and information about contributing to this project.

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Build all packages: `npm run build`
4. Run tests: `npm test`

## Repository Structure

```
packages/
  client/     @microsoft/snapfeed         — browser client library
  server/     @microsoft/snapfeed-server  — Hono + SQLite backend
examples/
  python/     FastAPI + SQLite example
```

## Development

This is an npm workspaces monorepo. Common commands:

```bash
# Build everything
npm run build

# Build a specific package
npm run build --workspace=packages/client
npm run build --workspace=packages/server

# Run tests
npm test

# Lint & format
npx biome check --write .

# Start the dev server
npm run dev --workspace=packages/server
```

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run build` and `npm test` pass
4. Run `npx biome ci .` to check formatting and linting
5. Submit a pull request

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if your changes affect the public API
- Follow existing code style (enforced by Biome)

## Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for ideas
- Check existing issues before creating a new one

## Code of Conduct

This project has adopted the
[Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
