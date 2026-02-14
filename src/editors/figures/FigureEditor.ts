import * as vscode from "vscode";
import { Logger } from "../../utils/Logger";

/**
 * Supported figure content types.
 * Currently only "includegraphics" is implemented, but this type
 * is designed to be extended with tikz, pgfplots, etc.
 */
export type FigureContentType = "includegraphics";

/**
 * Regex that matches \begin{figure}...\end{figure} (and figure*).
 */
const FIGURE_WRAPPER_PATTERN =
	/\\begin\{(figure\*?)\}(\[[^\]]*\])?\s*([\s\S]*?)\\end\{\1\}/g;

/**
 * Matches a standalone \includegraphics (not inside a figure env).
 */
const STANDALONE_INCLUDEGRAPHICS_PATTERN =
	/\\includegraphics(\[[^\]]*\])?\{([^}]*)\}/g;

/** Image extensions to search for in the workspace. */
const IMAGE_EXTENSIONS = "png,jpg,jpeg,gif,svg,bmp,webp,pdf,eps,tiff";
const PREVIEWABLE_RE = /\.(png|jpe?g|gif|svg|bmp|webp)$/i;

interface FigureRange {
	range: vscode.Range;
	content: string;
	hasWrapper: boolean;
	wrapperType: string;     // "figure" | "figure*"
	position: string;        // float specifier
	caption: string;
	captionPosition: "top" | "bottom";
	label: string;
	centering: boolean;
	/** The content type inside the figure */
	contentType: FigureContentType;
	/** \includegraphics option string, e.g. "width=0.8\\textwidth" */
	graphicsOptions: string;
	/** The image path argument */
	graphicsPath: string;
}

// ────────────────────────────────────────────
// CodeLens Provider
// ────────────────────────────────────────────

export class FigureCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChange.event;

	refresh(): void {
		this._onDidChange.fire();
	}

	provideCodeLenses(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken,
	): vscode.CodeLens[] {
		if (document.languageId !== "latex") {
			return [];
		}

		const lenses: vscode.CodeLens[] = [];
		const figures = findFigures(document);

		for (const fig of figures) {
			lenses.push(
				new vscode.CodeLens(fig.range, {
					title: "✏️ Edit Figure",
					command: "intex.editFigure",
					arguments: [document.uri, fig.range],
				}),
			);
		}

		return lenses;
	}
}

// ────────────────────────────────────────────
// Figure finder helper
// ────────────────────────────────────────────

function findFigures(document: vscode.TextDocument): FigureRange[] {
	const text = document.getText();
	const results: FigureRange[] = [];
	const coveredRanges: vscode.Range[] = [];

	let m: RegExpExecArray | null;

	// First pass: \begin{figure}...\end{figure} wrappers
	FIGURE_WRAPPER_PATTERN.lastIndex = 0;
	while ((m = FIGURE_WRAPPER_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const range = new vscode.Range(startPos, endPos);
		const fullText = m[0];
		const wrapperType = m[1];
		const posMatch = m[2];
		const innerContent = m[3];

		const position = posMatch ? posMatch.slice(1, -1) : "h";

		const captionMatch = fullText.match(/\\caption\{([^}]*)\}/);
		const caption = captionMatch ? captionMatch[1] : "";

		const labelMatch = fullText.match(/\\label\{([^}]*)\}/);
		const label = labelMatch ? labelMatch[1] : "";

		const centering = /\\centering/.test(fullText);

		// Detect caption position relative to \includegraphics
		const captionIdx = innerContent.indexOf("\\caption");
		const gfxIdx = innerContent.indexOf("\\includegraphics");
		const captionPosition: "top" | "bottom" =
			captionIdx !== -1 && gfxIdx !== -1 && captionIdx < gfxIdx
				? "top"
				: "bottom";

		// Try to find \includegraphics inside
		const gfxMatch = innerContent.match(
			/\\includegraphics(\[[^\]]*\])?\{([^}]*)\}/,
		);

		if (!gfxMatch) {
			// Figure without includegraphics — skip for now (future: tikz, etc.)
			continue;
		}

		const graphicsOptions = gfxMatch[1] ? gfxMatch[1].slice(1, -1) : "";
		const graphicsPath = gfxMatch[2];

		results.push({
			range,
			content: fullText,
			hasWrapper: true,
			wrapperType,
			position,
			caption,
			captionPosition,
			label,
			centering,
			contentType: "includegraphics",
			graphicsOptions,
			graphicsPath,
		});

		coveredRanges.push(range);
	}

	// Second pass: standalone \includegraphics not inside a figure wrapper
	STANDALONE_INCLUDEGRAPHICS_PATTERN.lastIndex = 0;
	while ((m = STANDALONE_INCLUDEGRAPHICS_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const range = new vscode.Range(startPos, endPos);

		if (coveredRanges.some((r) => r.contains(range))) {
			continue;
		}

		const graphicsOptions = m[1] ? m[1].slice(1, -1) : "";
		const graphicsPath = m[2];

		results.push({
			range,
			content: m[0],
			hasWrapper: false,
			wrapperType: "",
			position: "",
			caption: "",
			captionPosition: "bottom",
			label: "",
			centering: false,
			contentType: "includegraphics",
			graphicsOptions,
			graphicsPath,
		});
	}

	return results;
}

// ────────────────────────────────────────────
// Webview Panel Manager
// ────────────────────────────────────────────

export class FigureEditor {
	private static panel: vscode.WebviewPanel | undefined;
	private static currentDocUri: vscode.Uri | undefined;
	private static currentRange: vscode.Range | undefined;
	private static suppressNextSync = false;
	private static logger = Logger.instance;
	private static codeLensProvider: FigureCodeLensProvider;
	private static changeListener: vscode.Disposable | undefined;

	/**
	 * Register commands, CodeLens provider, and file watchers.
	 */
	static register(context: vscode.ExtensionContext): void {
		FigureEditor.codeLensProvider = new FigureCodeLensProvider();

		context.subscriptions.push(
			vscode.languages.registerCodeLensProvider(
				{ language: "latex" },
				FigureEditor.codeLensProvider,
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("intex.insertFigure", () =>
				FigureEditor.insertFigure(context),
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				"intex.editFigure",
				(uri: vscode.Uri, range: vscode.Range) =>
					FigureEditor.editFigure(context, uri, range),
			),
		);

		// Watch for image file additions/deletions to refresh carousel
		const watcher = vscode.workspace.createFileSystemWatcher(
			`**/*.{${IMAGE_EXTENSIONS}}`,
		);
		watcher.onDidCreate(() => FigureEditor.sendImageList());
		watcher.onDidDelete(() => FigureEditor.sendImageList());
		context.subscriptions.push(watcher);
	}

	// ────────────────────────────────────────
	// Image scanning
	// ────────────────────────────────────────

	private static async scanWorkspaceImages(): Promise<vscode.Uri[]> {
		return vscode.workspace.findFiles(
			`**/*.{${IMAGE_EXTENSIONS}}`,
			"{**/node_modules/**,**/out/**,**/dist/**,**/.git/**}",
			1000,
		);
	}

	private static async sendImageList(): Promise<void> {
		if (!FigureEditor.panel) {
			return;
		}
		const uris = await FigureEditor.scanWorkspaceImages();
		const images = uris.map((uri) => ({
			relativePath: vscode.workspace.asRelativePath(uri, false),
			webviewUri: FigureEditor.panel!.webview
				.asWebviewUri(uri)
				.toString(),
			previewable: PREVIEWABLE_RE.test(uri.fsPath),
		}));
		images.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
		FigureEditor.panel.webview.postMessage({
			type: "imageList",
			images,
		});
	}

	// ════════════════════════════════════════
	// Insert Figure (command palette)
	// ════════════════════════════════════════

	private static async insertFigure(
		context: vscode.ExtensionContext,
	): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "latex") {
			vscode.window.showWarningMessage(
				"Open a .tex file to insert a figure.",
			);
			return;
		}

		const stub = [
			"\\begin{figure}[h]",
			"\\centering",
			"\\includegraphics[width=0.8\\textwidth]{}",
			"\\caption{}",
			"\\label{fig:}",
			"\\end{figure}",
		].join("\n");

		const pos = editor.selection.active;
		await editor.edit((eb) => {
			eb.insert(pos, stub);
		});

		const startLine = pos.line;
		const lines = stub.split("\n");
		const endLine = startLine + lines.length - 1;
		const endChar = lines[lines.length - 1].length;
		const range = new vscode.Range(
			new vscode.Position(startLine, 0),
			new vscode.Position(endLine, endChar),
		);

		await FigureEditor.openPanel(context, editor.document.uri, range, {
			hasWrapper: true,
			wrapperType: "figure",
			position: "h",
			caption: "",
			captionPosition: "bottom",
			label: "fig:",
			centering: true,
			contentType: "includegraphics",
			graphicsOptions: "width=0.8\\textwidth",
			graphicsPath: "",
		});
	}

	// ════════════════════════════════════════
	// Edit existing figure (CodeLens)
	// ════════════════════════════════════════

	private static async editFigure(
		context: vscode.ExtensionContext,
		uri?: vscode.Uri,
		range?: vscode.Range,
	): Promise<void> {
		if (!uri || !range) {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "latex") {
				vscode.window.showWarningMessage(
					"Open a .tex file to edit a figure.",
				);
				return;
			}
			const doc = editor.document;
			const cursorPos = editor.selection.active;
			const figures = findFigures(doc);
			const match = figures.find((f) => f.range.contains(cursorPos));
			if (!match) {
				vscode.window.showWarningMessage(
					"Place the cursor inside a figure to edit it.",
				);
				return;
			}
			uri = doc.uri;
			range = match.range;
		}

		const doc = await vscode.workspace.openTextDocument(uri);

		// Try to find the figure info from full parse
		const figures = findFigures(doc);
		const figureInfo = figures.find(
			(f) =>
				f.range.start.line === range!.start.line &&
				f.range.end.line === range!.end.line,
		);

		if (figureInfo) {
			await FigureEditor.openPanel(context, uri, range, figureInfo);
			return;
		}

		// Fallback: parse the selected text directly
		const text = doc.getText(range);
		const gfxMatch = text.match(
			/\\includegraphics(\[[^\]]*\])?\{([^}]*)\}/,
		);
		if (!gfxMatch) {
			vscode.window.showWarningMessage("Could not parse figure content.");
			return;
		}

		await FigureEditor.openPanel(context, uri, range, {
			hasWrapper: false,
			wrapperType: "",
			position: "",
			caption: "",
			captionPosition: "bottom",
			label: "",
			centering: false,
			contentType: "includegraphics",
			graphicsOptions: gfxMatch[1] ? gfxMatch[1].slice(1, -1) : "",
			graphicsPath: gfxMatch[2],
		});
	}

	// ════════════════════════════════════════
	// Open / reuse the side panel
	// ════════════════════════════════════════

	private static async openPanel(
		context: vscode.ExtensionContext,
		docUri: vscode.Uri,
		range: vscode.Range,
		figureData: {
			hasWrapper: boolean;
			wrapperType: string;
			position: string;
			caption: string;
			captionPosition: "top" | "bottom";
			label: string;
			centering: boolean;
			contentType: FigureContentType;
			graphicsOptions: string;
			graphicsPath: string;
		},
	): Promise<void> {
		FigureEditor.currentDocUri = docUri;
		FigureEditor.currentRange = range;
		FigureEditor.changeListener?.dispose();

		const msgData = {
			type: "setFigure",
			wrapper: figureData.hasWrapper
				? figureData.wrapperType
				: "includegraphics",
			position: figureData.position,
			caption: figureData.caption,
			captionPosition: figureData.captionPosition,
			label: figureData.label,
			centering: figureData.centering,
			contentType: figureData.contentType,
			graphicsOptions: figureData.graphicsOptions,
			graphicsPath: figureData.graphicsPath,
		};

		if (FigureEditor.panel) {
			FigureEditor.panel.reveal(vscode.ViewColumn.Beside);
			FigureEditor.panel.webview.postMessage(msgData);
			FigureEditor.setupDocumentListener();
			FigureEditor.sendImageList();
			return;
		}

		const editorDir = vscode.Uri.joinPath(
			context.extensionUri,
			"dist",
			"figure_editor",
		);

		const workspaceRoots =
			vscode.workspace.workspaceFolders?.map((f) => f.uri) || [];

		const panel = vscode.window.createWebviewPanel(
			"intex.figureEditor",
			"Figure Editor",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [editorDir, ...workspaceRoots],
			},
		);

		FigureEditor.panel = panel;

		const cssUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "figure_editor.css"),
		);
		const jsUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "figure_editor.js"),
		);

		const nonce = getNonce();

		panel.webview.html = buildHTML(
			nonce,
			panel.webview.cspSource,
			cssUri,
			jsUri,
			msgData,
		);

		panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg.type === "update") {
				await FigureEditor.syncToDocument(msg.latex);
			} else if (msg.type === "requestImages") {
				await FigureEditor.sendImageList();
			}
		});

		panel.onDidDispose(() => {
			FigureEditor.panel = undefined;
			FigureEditor.changeListener?.dispose();
			FigureEditor.changeListener = undefined;
		});

		FigureEditor.setupDocumentListener();

		// Send initial image list
		FigureEditor.sendImageList();

		FigureEditor.logger.info("Figure editor panel opened");
	}

	// ────────────────────────────────────────
	// Document change listener (external edits → webview)
	// ────────────────────────────────────────

	private static setupDocumentListener(): void {
		FigureEditor.changeListener?.dispose();

		FigureEditor.changeListener =
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (
					!FigureEditor.currentDocUri ||
					e.document.uri.toString() !==
						FigureEditor.currentDocUri.toString()
				) {
					return;
				}

				if (FigureEditor.suppressNextSync) {
					FigureEditor.suppressNextSync = false;
					FigureEditor.refreshRange(e.document);
					return;
				}

				FigureEditor.refreshRange(e.document);

				if (!FigureEditor.currentRange) {
					return;
				}

				const text = e.document.getText(FigureEditor.currentRange);

				let wrapper = "includegraphics";
				let position = "";
				let caption = "";
				let captionPosition: "top" | "bottom" = "bottom";
				let label = "";
				let centering = false;
				let graphicsOptions = "";
				let graphicsPath = "";

				const wrapperMatch = text.match(
					/\\begin\{(figure\*?)\}(\[[^\]]*\])?\s*([\s\S]*?)\\end\{\1\}/,
				);
				if (wrapperMatch) {
					wrapper = wrapperMatch[1];
					position = wrapperMatch[2]
						? wrapperMatch[2].slice(1, -1)
						: "h";
					const capMatch = text.match(/\\caption\{([^}]*)\}/);
					caption = capMatch ? capMatch[1] : "";
					const labMatch = text.match(/\\label\{([^}]*)\}/);
					label = labMatch ? labMatch[1] : "";
					centering = /\\centering/.test(text);

					// Detect caption position
					const innerContent = wrapperMatch[3];
					const capIdx = innerContent.indexOf("\\caption");
					const gfxIdx = innerContent.indexOf("\\includegraphics");
					if (capIdx !== -1 && gfxIdx !== -1 && capIdx < gfxIdx) {
						captionPosition = "top";
					}
				}

				const gfxMatch = text.match(
					/\\includegraphics(\[[^\]]*\])?\{([^}]*)\}/,
				);
				if (gfxMatch) {
					graphicsOptions = gfxMatch[1]
						? gfxMatch[1].slice(1, -1)
						: "";
					graphicsPath = gfxMatch[2];
				}

				FigureEditor.panel?.webview.postMessage({
					type: "setFigure",
					wrapper,
					position,
					caption,
					captionPosition,
					label,
					centering,
					contentType: "includegraphics",
					graphicsOptions,
					graphicsPath,
				});
			});
	}

	/**
	 * Re-locate the figure block after the document has been edited.
	 */
	private static refreshRange(doc: vscode.TextDocument): void {
		if (!FigureEditor.currentRange) {
			return;
		}

		const figures = findFigures(doc);
		const startLine = FigureEditor.currentRange.start.line;

		const best = figures.find(
			(f) => Math.abs(f.range.start.line - startLine) <= 3,
		);

		if (best) {
			FigureEditor.currentRange = best.range;
		}
	}

	// ────────────────────────────────────────
	// Push webview changes → .tex file
	// ────────────────────────────────────────

	private static async syncToDocument(latex: string): Promise<void> {
		if (!FigureEditor.currentDocUri || !FigureEditor.currentRange) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument(
			FigureEditor.currentDocUri,
		);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, FigureEditor.currentRange, latex);

		FigureEditor.suppressNextSync = true;
		await vscode.workspace.applyEdit(edit);

		// Update tracked range
		const startLine = FigureEditor.currentRange.start.line;
		const startChar = FigureEditor.currentRange.start.character;
		const lines = latex.split("\n");
		const endLine = startLine + lines.length - 1;
		const endChar =
			lines.length === 1
				? startChar + lines[0].length
				: lines[lines.length - 1].length;
		FigureEditor.currentRange = new vscode.Range(
			new vscode.Position(startLine, startChar),
			new vscode.Position(endLine, endChar),
		);
	}
}

// ────────────────────────────────────────────
// HTML Builder
// ────────────────────────────────────────────

function buildHTML(
	nonce: string,
	cspSource: string,
	cssUri: vscode.Uri,
	jsUri: vscode.Uri,
	figureData: Record<string, unknown>,
): string {
	const dataJson = JSON.stringify(figureData).replace(/<\//g, "<\\/");

	return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none';
			script-src 'nonce-${nonce}' ${cspSource};
			style-src ${cspSource} 'unsafe-inline';
			img-src ${cspSource} data:;
			font-src ${cspSource};
			connect-src ${cspSource};">
	<link rel="stylesheet" href="${cssUri}">
</head>
<body>
	<div id="app">
		<div id="toolbar">
			<!-- Row 1: Figure wrapper options -->
			<div class="toolbar-row">
				<label class="toolbar-label" for="labelInput">Label</label>
				<input type="text" id="labelInput" placeholder="fig:my-figure" spellcheck="false">
				<label class="toolbar-label" for="wrapperSelect">Env</label>
				<select id="wrapperSelect">
					<option value="includegraphics">includegraphics</option>
					<option value="figure">figure</option>
					<option value="figure*">figure*</option>
				</select>
				<label class="toolbar-label" for="positionSelect">Pos</label>
				<select id="positionSelect">
					<option value="h">h</option>
					<option value="t">t</option>
					<option value="b">b</option>
					<option value="H">H</option>
					<option value="ht">ht</option>
					<option value="htbp">htbp</option>
				</select>
			</div>

			<!-- Row 2: Caption options -->
			<div class="toolbar-row">
				<label class="toolbar-label" for="captionInput">Caption</label>
				<input type="text" id="captionInput" placeholder="Figure caption..." spellcheck="false">
				<select id="captionPosSelect" title="Caption position">
					<option value="bottom">bottom</option>
					<option value="top">top</option>
				</select>
			</div>

			<!-- Row 3: Image sizing options -->
			<div class="toolbar-row">
				<label class="toolbar-label" for="widthInput">Width</label>
				<input type="text" id="widthInput" placeholder="0.8\\textwidth" spellcheck="false">
				<label class="toolbar-label" for="heightInput">Height</label>
				<input type="text" id="heightInput" placeholder="auto" spellcheck="false">
				<label class="toolbar-label" for="scaleInput">Scale</label>
				<input type="text" id="scaleInput" placeholder="e.g. 0.5" spellcheck="false">
				<label class="toolbar-label" for="angleInput">Angle</label>
				<input type="text" id="angleInput" placeholder="e.g. 90" spellcheck="false">
			</div>
		</div>

		<!-- Image selection -->
		<div class="section-label">Image</div>
		<div id="imageSection">
			<div id="pathRow">
				<label class="toolbar-label" for="pathInput">Path</label>
				<input type="text" id="pathInput" placeholder="images/my-image.png" spellcheck="false">
			</div>
			<div id="searchRow">
				<input type="text" id="searchInput" placeholder="Search images in workspace..." spellcheck="false">
				<button id="refreshBtn" title="Refresh image list">&#x21bb;</button>
			</div>
			<div id="imageGrid"></div>
			<div id="emptyMessage" class="hidden">No images found in workspace</div>
		</div>
	</div>

	<script nonce="${nonce}">
		window.__INITIAL_FIGURE_DATA__ = ${dataJson};
	</script>
	<script nonce="${nonce}" src="${jsUri}" defer></script>
</body>
</html>`;
}

function getNonce(): string {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
