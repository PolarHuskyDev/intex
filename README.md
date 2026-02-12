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
- SyncTeX forward and reverse search (Ctrl+Click on PDF to jump to source)
- Text search with match highlighting (Ctrl+F)
- Clickable hyperlinks — internal and external links
- Zoom controls, fit to width, fit to page, and Ctrl+Wheel zoom
- Page navigation via buttons, scroll, page input, and thumbnails
- Keyboard shortcuts for navigation and zoom
- Continuous scroll with lazy rendering for performance
- Toggle thumbnail sidebar for more space 
![PDF Viewer](screenshots/PDF_Viewer_to_the_side.png)


### Built-in equation editor
- Insert and edit commands in the command palette
- CodeLens "Edit Equation" button on top of every equation
- Live KaTeX preview as you type
- Symbol palette with tabs: Greek, operators, relations, arrows, structures, functions, matrices
- Switch between equation environments (equation, align, \$\$, inline, etc.)
- Label editing for numbered equations
- Real-time sync — changes update your .tex file directly
![Equation editor](screenshots/equation_editor.png) 


### Table editor
- Excel-like editing with a near-WYSIWYG interface
- Multi-column and multi-row support (merge & split)
- Apply borders to single or multiple cells at once
- Column alignment (left, center, right) visually reflected in the editor
- Caption (top or bottom), labels, and positioning in a single interface
- CodeLens "Edit Table" button for quick access on existing tables
- Real-time sync — changes update your .tex file directly
![Table editor](screenshots/table_editor.png)

### Figure editor


### BibTeX editor


## Contributing
Found a bug or have a feature request? Open an issue on our [GitHub repository](https://github.com/PolarHuskyDev/intex).

## License

MIT
