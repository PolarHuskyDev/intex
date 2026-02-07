# ∫TeX Development Guide

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- VS Code 1.85+
- For testing: TeX Live or Docker

### Setup

```bash
# Install dependencies
npm install

# Compile the extension
npm run compile

# Watch mode for development
npm run watch
```

### Running the Extension

1. Open this folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a `.tex` file to test

### Debugging

- Set breakpoints in TypeScript files
- Use Debug Console in the main VS Code window
- Check Output channel "InTeX" for logs

## Project Architecture

### Key Components

#### Build System (`src/buildSystem/`)

- **builder.ts**: Main orchestrator and interfaces
- **detector.ts**: Detects TeX Live and Docker availability
- **localBuilder.ts**: Executes builds using local TeX installation
- **dockerBuilder.ts**: Executes builds in Docker containers
- **errorParser.ts**: Parses LaTeX log files for errors

#### Preview (`src/preview/`)

- **pdfPreview.ts**: Manages PDF preview in VS Code

#### Utilities (`src/utils/`)

- **config.ts**: Configuration management
- **logger.ts**: Logging utilities

### Build Flow

1. User saves `.tex` file or triggers build command
2. Build system checks configuration for build method
3. Detector validates availability of selected method
4. Appropriate builder (Local/Docker) executes compilation
5. Error parser processes output
6. PDF preview opens if successful

### Adding New Features

#### New Command

1. Add to `package.json` under `contributes.commands`
2. Register in `extension.ts` with `vscode.commands.registerCommand`
3. Implement handler function

#### New Configuration Option

1. Add to `package.json` under `contributes.configuration.properties`
2. Add getter method in `src/utils/config.ts`
3. Use in relevant component

## Testing

### Manual Testing

1. Create test `.tex` files in a workspace
2. Test different scenarios:
   - Local build (with TeX Live installed)
   - Docker build (with Docker installed)
   - Auto-detection
   - Error handling
   - Clean command

### Sample Test Document

Create `test/sample.tex`:

```latex
\\documentclass{article}
\\begin{document}
Hello, ∫TeX!
\\end{document}
```

## Common Issues

### Build Fails

- Check Output channel "InTeX" for detailed logs
- Verify LaTeX installation: `pdflatex --version`
- Verify Docker: `docker --version`
- Check file permissions

### Docker Volume Issues

```bash
# List volumes
docker volume ls

# Remove cache volume to reset
docker volume rm intex-texlive-cache
```

## Code Style

- Follow TypeScript best practices
- Use async/await for asynchronous operations
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Release Process (Future)

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Run `npm run package` to create VSIX
4. Test VSIX installation
5. Publish to marketplace

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
