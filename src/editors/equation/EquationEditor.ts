import * as vscode from "vscode";
import { Logger } from "../../utils/logger";

/**
 * Regex that matches common LaTeX equation environments.
 */
const EQUATION_ENVS = [
	"equation",
	"equation\\*",
	"align",
	"align\\*",
];

const ENV_PATTERN = new RegExp(
	`(\\\\begin\\{(${EQUATION_ENVS.join("|")})\\})[\\s\\S]*?(\\\\end\\{\\2\\})`,
	"g",
);

const DOLLAR_PATTERN = /\$\$[\s\S]*?\$\$/g;
const INLINE_PAREN_PATTERN = /\\\([\s\S]*?\\\)/g;
const INLINE_DOLLAR_PATTERN = /(?<!\$)\$(?!\$)((?:[^$\\]|\\[\s\S])+)\$(?!\$)/g;

interface EquationRange {
	range: vscode.Range;
	content: string;
	fullText: string;
	envType: string;  // "equation", "equation*", "display-dollar", etc.
	label: string;
}

// ────────────────────────────────────────────
// CodeLens Provider
// ────────────────────────────────────────────

export class EquationCodeLensProvider implements vscode.CodeLensProvider {
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
		const equations = findEquations(document);

		for (const eq of equations) {
			lenses.push(
				new vscode.CodeLens(eq.range, {
					title: "✏️ Edit Equation",
					command: "intex.editEquation",
					arguments: [document.uri, eq.range],
				}),
			);
		}

		return lenses;
	}
}

// ────────────────────────────────────────────
// Equation finder helper
// ────────────────────────────────────────────

function findEquations(document: vscode.TextDocument): EquationRange[] {
	const text = document.getText();
	const results: EquationRange[] = [];

	let m: RegExpExecArray | null;

	// \begin{env}...\end{env} style
	ENV_PATTERN.lastIndex = 0;
	while ((m = ENV_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const fullText = m[0];
		const envType = m[2];
		const innerStart = m[1].length;
		const innerEnd = fullText.length - m[3].length;
		let innerContent = fullText.substring(innerStart, innerEnd);

		// Extract \label{...} if present
		const labelMatch = innerContent.match(/\\label\{([^}]*)\}/);
		const label = labelMatch ? labelMatch[1] : "";
		if (labelMatch) {
			innerContent = innerContent.replace(/\\label\{[^}]*\}\s*/, "");
		}
		const content = innerContent.trim();

		results.push({
			range: new vscode.Range(startPos, endPos),
			content,
			fullText,
			envType,
			label,
		});
	}

	// $$...$$ style
	DOLLAR_PATTERN.lastIndex = 0;
	while ((m = DOLLAR_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const content = m[0].slice(2, -2).trim();

		results.push({
			range: new vscode.Range(startPos, endPos),
			content,
			fullText: m[0],
			envType: "display-dollar",
			label: "",
		});
	}

	// \(...\) style
	INLINE_PAREN_PATTERN.lastIndex = 0;
	while ((m = INLINE_PAREN_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const content = m[0].slice(2, -2).trim();

		results.push({
			range: new vscode.Range(startPos, endPos),
			content,
			fullText: m[0],
			envType: "inline-paren",
			label: "",
		});
	}

	// $...$ style (inline)
	INLINE_DOLLAR_PATTERN.lastIndex = 0;
	while ((m = INLINE_DOLLAR_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const content = m[1].trim();

		results.push({
			range: new vscode.Range(startPos, endPos),
			content,
			fullText: m[0],
			envType: "inline-dollar",
			label: "",
		});
	}

	return results;
}

// ────────────────────────────────────────────
// Webview Panel Manager
// ────────────────────────────────────────────

export class EquationEditor {
	private static panel: vscode.WebviewPanel | undefined;
	private static currentDocUri: vscode.Uri | undefined;
	private static currentRange: vscode.Range | undefined;
	private static currentEnvType: string = "equation*";
	private static currentLabel: string = "";
	private static suppressNextSync = false;
	private static logger = Logger.instance;
	private static codeLensProvider: EquationCodeLensProvider;
	private static changeListener: vscode.Disposable | undefined;

	/**
	 * Register commands and CodeLens provider.
	 */
	static register(context: vscode.ExtensionContext): void {
		EquationEditor.codeLensProvider = new EquationCodeLensProvider();

		context.subscriptions.push(
			vscode.languages.registerCodeLensProvider(
				{ language: "latex" },
				EquationEditor.codeLensProvider,
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("intex.insertEquation", () =>
				EquationEditor.insertEquation(context),
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				"intex.editEquation",
				(uri: vscode.Uri, range: vscode.Range) =>
					EquationEditor.editEquation(context, uri, range),
			),
		);
	}

	// ════════════════════════════════════════
	// Insert Equation (command palette)
	// ════════════════════════════════════════

	private static async insertEquation(
		context: vscode.ExtensionContext,
	): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "latex") {
			vscode.window.showWarningMessage(
				"Open a .tex file to insert an equation.",
			);
			return;
		}

		const envType = "equation*";
		const snippet = `\\begin{${envType}}\n\t\n\\end{${envType}}`;
		const pos = editor.selection.active;

		await editor.edit((eb) => {
			eb.insert(pos, snippet);
		});

		// Compute the range of the newly inserted block
		const startLine = pos.line;
		const endLine = startLine + 2;
		const endChar = `\\end{${envType}}`.length;
		const range = new vscode.Range(
			new vscode.Position(startLine, 0),
			new vscode.Position(endLine, endChar),
		);

		// Place cursor inside the equation
		const innerPos = new vscode.Position(startLine + 1, 1);
		editor.selection = new vscode.Selection(innerPos, innerPos);

		await EquationEditor.openPanel(context, editor.document.uri, range, "", envType, "");
	}

	// ════════════════════════════════════════
	// Edit existing equation (CodeLens)
	// ════════════════════════════════════════

	private static async editEquation(
		context: vscode.ExtensionContext,
		uri?: vscode.Uri,
		range?: vscode.Range,
	): Promise<void> {
		// When called from command palette without arguments, find equation at cursor
		if (!uri || !range) {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "latex") {
				vscode.window.showWarningMessage("Open a .tex file to edit an equation.");
				return;
			}
			const doc = editor.document;
			const cursorPos = editor.selection.active;
			const equations = findEquations(doc);
			const match = equations.find((eq) => eq.range.contains(cursorPos));
			if (!match) {
				vscode.window.showWarningMessage("Place the cursor inside an equation to edit it.");
				return;
			}
			uri = doc.uri;
			range = match.range;
		}

		const doc = await vscode.workspace.openTextDocument(uri);
		const text = doc.getText(range);

		let content: string;
		let envType: string = "equation*";
		let label: string = "";

		const envMatch = text.match(
			/\\begin\{([^}]+)\}([\s\S]*?)\\end\{[^}]+\}/,
		);
		if (envMatch) {
			envType = envMatch[1];
			let inner = envMatch[2];
			// Extract \label{...}
			const labelMatch = inner.match(/\\label\{([^}]*)\}/);
			if (labelMatch) {
				label = labelMatch[1];
				inner = inner.replace(/\\label\{[^}]*\}\s*/, "");
			}
			content = inner.trim();
		} else if (text.startsWith("$$") && text.endsWith("$$")) {
			envType = "display-dollar";
			content = text.slice(2, -2).trim();
		} else if (text.startsWith("\\(") && text.endsWith("\\)")) {
			envType = "inline-paren";
			content = text.slice(2, -2).trim();
		} else if (text.startsWith("$") && text.endsWith("$")) {
			envType = "inline-dollar";
			content = text.slice(1, -1).trim();
		} else {
			content = text;
		}

		await EquationEditor.openPanel(context, uri, range, content, envType, label);
	}

	// ════════════════════════════════════════
	// Open / reuse the side panel
	// ════════════════════════════════════════

	private static async openPanel(
		context: vscode.ExtensionContext,
		docUri: vscode.Uri,
		range: vscode.Range,
		initialContent: string,
		envType: string,
		label: string,
	): Promise<void> {
		EquationEditor.currentDocUri = docUri;
		EquationEditor.currentRange = range;
		EquationEditor.currentEnvType = envType;
		EquationEditor.currentLabel = label;

		EquationEditor.changeListener?.dispose();

		if (EquationEditor.panel) {
			EquationEditor.panel.reveal(vscode.ViewColumn.Beside);
			EquationEditor.panel.webview.postMessage({
				type: "setContent",
				content: initialContent,
				envType,
				label,
			});
			EquationEditor.setupDocumentListener();
			return;
		}

		const editorDir = vscode.Uri.joinPath(
			context.extensionUri,
			"dist",
			"equation_editor",
		);

		const panel = vscode.window.createWebviewPanel(
			"intex.equationEditor",
			"Equation Editor",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [editorDir],
			},
		);

		EquationEditor.panel = panel;

		const cssUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "equation_editor.css"),
		);
		const jsUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "equation_editor.js"),
		);
		const katexCssUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "katex", "katex.min.css"),
		);
		const katexJsUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "katex", "katex.min.js"),
		);

		const nonce = getNonce();

		panel.webview.html = buildHTML(
			nonce,
			panel.webview.cspSource,
			cssUri,
			jsUri,
			katexCssUri,
			katexJsUri,
			initialContent,
			envType,
			label,
		);

		panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg.type === "update") {
				if (msg.envType !== undefined) {
					EquationEditor.currentEnvType = msg.envType;
				}
				if (msg.label !== undefined) {
					EquationEditor.currentLabel = msg.label;
				}
				await EquationEditor.syncToDocument(msg.content);
			}
		});

		panel.onDidDispose(() => {
			EquationEditor.panel = undefined;
			EquationEditor.changeListener?.dispose();
			EquationEditor.changeListener = undefined;
		});

		EquationEditor.setupDocumentListener();
		EquationEditor.logger.info("Equation editor panel opened");
	}

	// ────────────────────────────────────────
	// Document change listener (external edits → webview)
	// ────────────────────────────────────────

	private static setupDocumentListener(): void {
		EquationEditor.changeListener?.dispose();

		EquationEditor.changeListener = vscode.workspace.onDidChangeTextDocument(
			(e) => {
				if (
					!EquationEditor.currentDocUri ||
					e.document.uri.toString() !== EquationEditor.currentDocUri.toString()
				) {
					return;
				}

				if (EquationEditor.suppressNextSync) {
					EquationEditor.suppressNextSync = false;
					EquationEditor.refreshRange(e.document);
					return;
				}

				EquationEditor.refreshRange(e.document);
				if (!EquationEditor.currentRange) {
					return;
				}

				const text = e.document.getText(EquationEditor.currentRange);
				let content: string;
				let envType = EquationEditor.currentEnvType;
				let label = EquationEditor.currentLabel;

				const envMatch = text.match(
					/\\begin\{([^}]+)\}([\s\S]*?)\\end\{[^}]+\}/,
				);
				if (envMatch) {
					envType = envMatch[1];
					let inner = envMatch[2];
					const labelMatch = inner.match(/\\label\{([^}]*)\}/);
					if (labelMatch) {
						label = labelMatch[1];
						inner = inner.replace(/\\label\{[^}]*\}\s*/, "");
					}
					content = inner.trim();
				} else if (text.startsWith("$$") && text.endsWith("$$")) {
					envType = "display-dollar";
					content = text.slice(2, -2).trim();
				} else if (text.startsWith("\\(") && text.endsWith("\\)")) {
					envType = "inline-paren";
					content = text.slice(2, -2).trim();
				} else if (text.startsWith("$") && text.endsWith("$")) {
					envType = "inline-dollar";
					content = text.slice(1, -1).trim();
				} else {
					content = text;
				}

				EquationEditor.currentEnvType = envType;
				EquationEditor.currentLabel = label;

				EquationEditor.panel?.webview.postMessage({
					type: "setContent",
					content,
					envType,
					label,
				});
			},
		);
	}

	/**
	 * Re-locate the equation block after the document has been edited.
	 */
	private static refreshRange(doc: vscode.TextDocument): void {
		if (!EquationEditor.currentRange) {
			return;
		}

		const equations = findEquations(doc);
		const startLine = EquationEditor.currentRange.start.line;

		const best = equations.find(
			(eq) => Math.abs(eq.range.start.line - startLine) <= 2,
		);

		if (best) {
			EquationEditor.currentRange = best.range;
			EquationEditor.currentEnvType = best.envType;
			EquationEditor.currentLabel = best.label;
		}
	}

	// ────────────────────────────────────────
	// Push webview changes → .tex file
	// ────────────────────────────────────────

	private static async syncToDocument(content: string): Promise<void> {
		if (!EquationEditor.currentDocUri || !EquationEditor.currentRange) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument(
			EquationEditor.currentDocUri,
		);

		const envType = EquationEditor.currentEnvType;
		const label = EquationEditor.currentLabel;
		const labelStr = label ? `\\label{${label}}\n\t` : "";

		let replacement: string;
		switch (envType) {
			case "inline-paren":
				replacement = `\\( ${content} \\)`;
				break;
			case "inline-dollar":
				replacement = `$ ${content} $`;
				break;
			case "display-dollar":
				replacement = `$$\n\t${content}\n$$`;
				break;
			default:
				// \begin{env}...\end{env}
				replacement = `\\begin{${envType}}${labelStr ? "\n\t" + labelStr : "\n\t"}${content}\n\\end{${envType}}`;
				break;
		}

		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, EquationEditor.currentRange, replacement);

		EquationEditor.suppressNextSync = true;
		await vscode.workspace.applyEdit(edit);

		// Update tracked range, preserving the start column for inline equations
		const startLine = EquationEditor.currentRange.start.line;
		const startChar = EquationEditor.currentRange.start.character;
		const lines = replacement.split("\n");
		const endLine = startLine + lines.length - 1;
		const endChar = lines.length === 1
			? startChar + lines[0].length
			: lines[lines.length - 1].length;
		EquationEditor.currentRange = new vscode.Range(
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
	katexCssUri: vscode.Uri,
	katexJsUri: vscode.Uri,
	initialContent: string,
	envType: string,
	label: string,
): string {
	const escaped = initialContent
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
	const escapedLabel = label
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

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
	<link rel="stylesheet" href="${katexCssUri}">
	<link rel="stylesheet" href="${cssUri}">
</head>
<body>
	<div id="app">
		<div id="toolbar">
			<div class="toolbar-row" id="optionsRow">
				<label class="toolbar-label" for="labelInput">Label</label>
				<input type="text" id="labelInput" placeholder="eq:my-label" value="${escapedLabel}" spellcheck="false">
				<label class="toolbar-label" for="envSelect">Type</label>
				<select id="envSelect">
					<option value="equation">\\begin{equation}</option>
					<option value="equation*">\\begin{equation*}</option>
					<option value="align">\\begin{align}</option>
					<option value="align*">\\begin{align*}</option>
					<option value="display-dollar">$$ $$</option>
					<option value="inline-paren">\\( \\)</option>
					<option value="inline-dollar">$ $</option>
				</select>
			</div>
			<div class="toolbar-row" id="symbolsRow">
				<div id="symbolTabs" class="symbol-tabs"></div>
				<div id="symbolContent" class="symbol-content"></div>
			</div>
		</div>
		<div class="section-label">Input</div>
		<div id="editorArea">
			<textarea id="latexInput" spellcheck="false" placeholder="Type LaTeX here...">${escaped}</textarea>
		</div>

		<div class="section-label">Preview</div>
		<div id="previewArea">
			<div id="katexOutput"></div>
			<div id="errorOutput" class="hidden"></div>
		</div>
	</div>

	<script nonce="${nonce}">
		window.__INITIAL_ENV_TYPE__ = "${envType}";
	</script>
	<script nonce="${nonce}" src="${katexJsUri}"></script>
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

