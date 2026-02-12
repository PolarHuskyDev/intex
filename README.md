# ∫TeX - Modern LaTeX Editor

**∫TeX** is a modern, local-first LaTeX extension for VS Code, offering fast builds, integrated PDF preview, SyncTeX, and smart tooling powered by texlab LSP server. It combines advanced visual editing tools with a robust hybrid build system.

## Key Features

### 🚀 Hybrid Build System

- **Zero-Config**: Automatically detects your LaTeX environment, either locally installer texlive or docker.
- **Docker Support**: No local TeX installation? No problem. InTeX can compile your documents using a containerized TeX Live environment.
- **Local Build**: Uses your local `latexmk` or `pdflatex` installation for maximum speed.
- **Caching**: Smart caching for Docker builds ensures fast re-compilation.

### 🖼️ Visual Editors & Previews

- **Table Editor**: Edit LaTeX tables with an Excel-like interface. No more struggling with `&` and `\\`. Live preview as you type.
- **Equation Editor**: Preview and edit complex math equations intuitively.
- **PDF Preview**: Integrated high-performance PDF viewer with **SyncTeX** support. Check the command palette for forward search (.tex to PDF) or Ctrl+Click PDF to jump to code.

### ⚡ Productivity Tools

- **IntelliSense**: Powered by `texlab` for robust auto-completion, citation suggestions, and reference management.

## Getting Started

1.  **Open a .tex file**: InTeX activates automatically.
2.  **Build**: Run the Intex: Build command from the command palette or save your .tex file.
3.  **View**: The PDF preview will open automatically on successful build.

## Configuration

InTeX works out of the box, but you can customize it:

- `intex.buildMethod`: Choose `auto`, `local`, or `docker`.
- `intex.docker.image`: Customize the docker image used to build the documents with containers.
- `intex.outputDirectory`: Choose a directory for output files.
- `intex.latexmk.options`: Customize build arguments.
- `intex.lsp.enabled`: Enable or disable LSP (language server protocol) server whenever you want.

## Gallery

### Integrated PDF viewer with:
- SyncTeX capability (forward and reverse search)
- Search and highlight
- Hyperlinks (To other parts of the document and external lins too)
- Zoom controls, zoom fit to width and fit to page
- Page navigation through buttons, scroll and thumbnails
- Toggle thumbnails to get more space 
![PDF Viewer](screenshots/PDF_Viewer_to_the_side.png)


### Build-in equation editor
- Insert and edit commands in the command palette
- Edit codelens button on top of every equation
- Feature rich editor with preview
- Greek, trigonometric functions, operators all in an easy accessible menu
![Equation editor](screenshots/equation_editor.png) 


### Figure editor
- 

## Contributing
Found a bug or have a feature request? Open an issue on our [GitHub repository](https://github.com/PolarHuskyDev/intex).

## License

MIT
