import * as vscode from "vscode";
import { Logger } from "../../utils/Logger";

/**
 * Regex patterns for detecting LaTeX table environments.
 */
const TABLE_WRAPPER_PATTERN =
	/\\begin\{(table\*?)\}(\[[^\]]*\])?\s*([\s\S]*?)\\end\{\1\}/g;

const TABULAR_PATTERN =
	/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g;

interface TableRange {
	range: vscode.Range;
	content: string;
	hasWrapper: boolean;
	wrapperType: string;
	position: string;
	caption: string;
	label: string;
	centering: boolean;
	colSpec: string;
	tabularContent: string;
}

// ────────────────────────────────────────────
// CodeLens Provider
// ────────────────────────────────────────────

export class TableCodeLensProvider implements vscode.CodeLensProvider {
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
		const tables = findTables(document);

		for (const t of tables) {
			lenses.push(
				new vscode.CodeLens(t.range, {
					title: "✏️ Edit Table",
					command: "intex.editTable",
					arguments: [document.uri, t.range],
				}),
			);
		}

		return lenses;
	}
}

// ────────────────────────────────────────────
// Table finder helper
// ────────────────────────────────────────────

function findTables(document: vscode.TextDocument): TableRange[] {
	const text = document.getText();
	const results: TableRange[] = [];
	const coveredRanges: vscode.Range[] = [];

	let m: RegExpExecArray | null;

	// First pass: \begin{table}...\end{table} wrappers
	TABLE_WRAPPER_PATTERN.lastIndex = 0;
	while ((m = TABLE_WRAPPER_PATTERN.exec(text)) !== null) {
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

		const tabMatch = innerContent.match(
			/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/,
		);
		if (!tabMatch) {
			continue;
		}

		results.push({
			range,
			content: fullText,
			hasWrapper: true,
			wrapperType,
			position,
			caption,
			label,
			centering,
			colSpec: tabMatch[1],
			tabularContent: tabMatch[2],
		});

		coveredRanges.push(range);
	}

	// Second pass: standalone \begin{tabular} not inside a table wrapper
	TABULAR_PATTERN.lastIndex = 0;
	while ((m = TABULAR_PATTERN.exec(text)) !== null) {
		const startPos = document.positionAt(m.index);
		const endPos = document.positionAt(m.index + m[0].length);
		const range = new vscode.Range(startPos, endPos);

		if (coveredRanges.some((r) => r.contains(range))) {
			continue;
		}

		results.push({
			range,
			content: m[0],
			hasWrapper: false,
			wrapperType: "",
			position: "",
			caption: "",
			label: "",
			centering: false,
			colSpec: m[1],
			tabularContent: m[2],
		});
	}

	return results;
}

// ────────────────────────────────────────────
// Webview Panel Manager
// ────────────────────────────────────────────

export class TableEditor {
	private static panel: vscode.WebviewPanel | undefined;
	private static currentDocUri: vscode.Uri | undefined;
	private static currentRange: vscode.Range | undefined;
	private static suppressNextSync = false;
	private static logger = Logger.instance;
	private static codeLensProvider: TableCodeLensProvider;
	private static changeListener: vscode.Disposable | undefined;

	/**
	 * Register commands and CodeLens provider.
	 */
	static register(context: vscode.ExtensionContext): void {
		TableEditor.codeLensProvider = new TableCodeLensProvider();

		context.subscriptions.push(
			vscode.languages.registerCodeLensProvider(
				{ language: "latex" },
				TableEditor.codeLensProvider,
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand("intex.insertTable", () =>
				TableEditor.insertTable(context),
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				"intex.editTable",
				(uri: vscode.Uri, range: vscode.Range) =>
					TableEditor.editTable(context, uri, range),
			),
		);
	}

	// ════════════════════════════════════════
	// Insert Table (command palette)
	// ════════════════════════════════════════

	private static async insertTable(
		context: vscode.ExtensionContext,
	): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "latex") {
			vscode.window.showWarningMessage(
				"Open a .tex file to insert a table.",
			);
			return;
		}

		const stub = [
			"\\begin{table}[h]",
			"\\centering",
			"\\begin{tabular}{|c|c|c|}",
			"\\hline",
			" &  &  \\\\",
			"\\hline",
			" &  &  \\\\",
			"\\hline",
			" &  &  \\\\",
			"\\hline",
			"\\end{tabular}",
			"\\caption{}",
			"\\label{tab:}",
			"\\end{table}",
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

		await TableEditor.openPanel(context, editor.document.uri, range, {
			hasWrapper: true,
			wrapperType: "table",
			position: "h",
			caption: "",
			label: "tab:",
			centering: true,
			colSpec: "|c|c|c|",
			tabularContent:
				"\n\\hline\n &  &  \\\\\n\\hline\n &  &  \\\\\n\\hline\n &  &  \\\\\n\\hline\n",
		});
	}

	// ════════════════════════════════════════
	// Edit existing table (CodeLens)
	// ════════════════════════════════════════

	private static async editTable(
		context: vscode.ExtensionContext,
		uri?: vscode.Uri,
		range?: vscode.Range,
	): Promise<void> {
		if (!uri || !range) {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "latex") {
				vscode.window.showWarningMessage(
					"Open a .tex file to edit a table.",
				);
				return;
			}
			const doc = editor.document;
			const cursorPos = editor.selection.active;
			const tables = findTables(doc);
			const match = tables.find((t) => t.range.contains(cursorPos));
			if (!match) {
				vscode.window.showWarningMessage(
					"Place the cursor inside a table to edit it.",
				);
				return;
			}
			uri = doc.uri;
			range = match.range;
		}

		const doc = await vscode.workspace.openTextDocument(uri);
		const text = doc.getText(range);

		// Try to find the table info from full parse
		const tables = findTables(doc);
		const tableInfo = tables.find(
			(t) =>
				t.range.start.line === range!.start.line &&
				t.range.end.line === range!.end.line,
		);

		if (tableInfo) {
			await TableEditor.openPanel(context, uri, range, tableInfo);
			return;
		}

		// Fallback: parse directly
		const tabMatch = text.match(
			/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/,
		);
		if (!tabMatch) {
			vscode.window.showWarningMessage("Could not parse table content.");
			return;
		}

		await TableEditor.openPanel(context, uri, range, {
			hasWrapper: false,
			wrapperType: "",
			position: "",
			caption: "",
			label: "",
			centering: false,
			colSpec: tabMatch[1],
			tabularContent: tabMatch[2],
		});
	}

	// ════════════════════════════════════════
	// Open / reuse the side panel
	// ════════════════════════════════════════

	private static async openPanel(
		context: vscode.ExtensionContext,
		docUri: vscode.Uri,
		range: vscode.Range,
		tableData: {
			hasWrapper: boolean;
			wrapperType: string;
			position: string;
			caption: string;
			label: string;
			centering: boolean;
			colSpec: string;
			tabularContent: string;
		},
	): Promise<void> {
		TableEditor.currentDocUri = docUri;
		TableEditor.currentRange = range;
		TableEditor.changeListener?.dispose();

		const msgData = {
			type: "setTable",
			wrapper: tableData.hasWrapper
				? tableData.wrapperType
				: "tabular",
			position: tableData.position,
			caption: tableData.caption,
			label: tableData.label,
			centering: tableData.centering,
			colSpec: tableData.colSpec,
			tabularContent: tableData.tabularContent,
		};

		if (TableEditor.panel) {
			TableEditor.panel.reveal(vscode.ViewColumn.Beside);
			TableEditor.panel.webview.postMessage(msgData);
			TableEditor.setupDocumentListener();
			return;
		}

		const editorDir = vscode.Uri.joinPath(
			context.extensionUri,
			"dist",
			"table_editor",
		);

		const panel = vscode.window.createWebviewPanel(
			"intex.tableEditor",
			"Table Editor",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [editorDir],
			},
		);

		TableEditor.panel = panel;

		const cssUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "table_editor.css"),
		);
		const jsUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "table_editor.js"),
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
				await TableEditor.syncToDocument(msg.latex);
			}
		});

		panel.onDidDispose(() => {
			TableEditor.panel = undefined;
			TableEditor.changeListener?.dispose();
			TableEditor.changeListener = undefined;
		});

		TableEditor.setupDocumentListener();
		TableEditor.logger.info("Table editor panel opened");
	}

	// ────────────────────────────────────────
	// Document change listener
	// ────────────────────────────────────────

	private static setupDocumentListener(): void {
		TableEditor.changeListener?.dispose();

		TableEditor.changeListener =
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (
					!TableEditor.currentDocUri ||
					e.document.uri.toString() !==
						TableEditor.currentDocUri.toString()
				) {
					return;
				}

				if (TableEditor.suppressNextSync) {
					TableEditor.suppressNextSync = false;
					TableEditor.refreshRange(e.document);
					return;
				}

				TableEditor.refreshRange(e.document);

				if (!TableEditor.currentRange) {
					return;
				}

				const text = e.document.getText(TableEditor.currentRange);

				// Extract table data from the changed text
				let wrapper = "tabular";
				let position = "";
				let caption = "";
				let label = "";
				let centering = false;
				let colSpec = "";
				let tabularContent = "";

				const wrapperMatch = text.match(
					/\\begin\{(table\*?)\}(\[[^\]]*\])?\s*([\s\S]*?)\\end\{\1\}/,
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
				}

				const tabMatch = text.match(
					/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/,
				);
				if (tabMatch) {
					colSpec = tabMatch[1];
					tabularContent = tabMatch[2];
				}

				TableEditor.panel?.webview.postMessage({
					type: "setTable",
					wrapper,
					position,
					caption,
					label,
					centering,
					colSpec,
					tabularContent,
				});
			});
	}

	/**
	 * Re-locate the table block after the document has been edited.
	 */
	private static refreshRange(doc: vscode.TextDocument): void {
		if (!TableEditor.currentRange) {
			return;
		}

		const tables = findTables(doc);
		const startLine = TableEditor.currentRange.start.line;

		const best = tables.find(
			(t) => Math.abs(t.range.start.line - startLine) <= 3,
		);

		if (best) {
			TableEditor.currentRange = best.range;
		}
	}

	// ────────────────────────────────────────
	// Push webview changes → .tex file
	// ────────────────────────────────────────

	private static async syncToDocument(latex: string): Promise<void> {
		if (!TableEditor.currentDocUri || !TableEditor.currentRange) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument(
			TableEditor.currentDocUri,
		);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, TableEditor.currentRange, latex);

		TableEditor.suppressNextSync = true;
		await vscode.workspace.applyEdit(edit);

		// Update tracked range
		const startLine = TableEditor.currentRange.start.line;
		const startChar = TableEditor.currentRange.start.character;
		const lines = latex.split("\n");
		const endLine = startLine + lines.length - 1;
		const endChar =
			lines.length === 1
				? startChar + lines[0].length
				: lines[lines.length - 1].length;
		TableEditor.currentRange = new vscode.Range(
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
	tableData: Record<string, unknown>,
): string {
	const dataJson = JSON.stringify(tableData).replace(/<\//g, "<\\/");

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
			<!-- Row 1: Table wrapper options -->
			<div class="toolbar-row" id="tableOptionsRow">
				<label class="toolbar-label" for="labelInput">Label</label>
				<input type="text" id="labelInput" placeholder="tab:my-table" spellcheck="false">
				<label class="toolbar-label" for="wrapperSelect">Env</label>
				<select id="wrapperSelect">
					<option value="tabular">tabular</option>
					<option value="table">table</option>
					<option value="table*">table*</option>
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
				<label class="toolbar-label" for="captionInput">Caption</label>
				<input type="text" id="captionInput" placeholder="Table caption..." spellcheck="false">
				<select id="captionPosSelect" title="Caption position">
					<option value="top">top</option>
					<option value="bottom">bottom</option>
				</select>
			</div>

			<!-- Row 2: Formatting toolbar -->
			<div class="toolbar-row" id="formattingRow">
				<div class="toolbar-group">
					<span class="toolbar-group-label">Align</span>
					<button class="tool-btn" id="alignLeft" title="Left align (l)">L</button>
					<button class="tool-btn active" id="alignCenter" title="Center align (c)">C</button>
					<button class="tool-btn" id="alignRight" title="Right align (r)">R</button>
				</div>
				<div class="toolbar-sep"></div>
				<div class="toolbar-group">
					<span class="toolbar-group-label">Borders</span>
					<button class="tool-btn" id="borderTop" title="Toggle top border (\\hline / \\cline)">━ top</button>
					<button class="tool-btn" id="borderBottom" title="Toggle bottom border">━ btm</button>
					<button class="tool-btn" id="borderLeft" title="Toggle left border (|)">┃ left</button>
					<button class="tool-btn" id="borderRight" title="Toggle right border (|)">┃ right</button>
					<button class="tool-btn" id="borderAll" title="Add all borders">▣</button>
					<button class="tool-btn" id="borderNone" title="Remove all borders">▢</button>
				</div>
				<div class="toolbar-sep"></div>
				<div class="toolbar-group">
					<span class="toolbar-group-label">Merge</span>
					<button class="tool-btn" id="mergeCells" title="Merge selected cells (\\multicolumn / \\multirow)">⊞ Merge</button>
					<button class="tool-btn" id="splitCells" title="Split merged cell">⊟ Split</button>
				</div>
				<div class="toolbar-sep"></div>
				<div class="toolbar-group">
					<span class="toolbar-group-label">Structure</span>
					<button class="tool-btn" id="addRowAbove" title="Insert row above">↑+</button>
					<button class="tool-btn" id="addRowBelow" title="Insert row below">↓+</button>
					<button class="tool-btn" id="addColLeft" title="Insert column left">←+</button>
					<button class="tool-btn" id="addColRight" title="Insert column right">→+</button>
					<button class="tool-btn danger" id="deleteRow" title="Delete selected row">↕−</button>
					<button class="tool-btn danger" id="deleteCol" title="Delete selected column">↔−</button>
				</div>
			</div>
		</div>

		<!-- Spreadsheet grid -->
		<div class="section-label">Table</div>
		<div id="gridArea">
			<div id="gridWrapper">
				<table id="gridTable"></table>
			</div>
		</div>

	</div>

	<script nonce="${nonce}">
		window.__INITIAL_TABLE_DATA__ = ${dataJson};
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
