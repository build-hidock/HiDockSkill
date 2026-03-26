# Contributing to HiDockSkill

Thanks for your interest in contributing. Here's how to get involved.

## Bug Reports

[Open an issue](https://github.com/build-hidock/HiDockSkill/issues/new?template=bug_report.md) with:
- What you expected vs. what happened
- Steps to reproduce
- Your OS, Node.js version, and HiDock model (H1E, P1, etc.)

## Feature Requests

[Open an issue](https://github.com/build-hidock/HiDockSkill/issues/new?template=feature_request.md) describing the use case and your proposed solution.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Install dependencies: `npm install`
3. Make your changes
4. Run tests: `npm test`
5. Run type checks: `npm run typecheck`
6. Open a PR with a clear description of what changed and why

## Development Setup

```bash
git clone https://github.com/build-hidock/HiDockSkill.git
cd HiDockSkill
npm install
npm run build
npm test
```

**Prerequisites:** Node.js 20+, ffmpeg, Python 3 with moonshine_voice, Ollama

## Code Style

- TypeScript with strict mode
- ESM modules (`import`/`export`, not `require`)
- Tests in `tests/` using Vitest

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
