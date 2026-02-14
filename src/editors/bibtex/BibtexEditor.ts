import * as vscode from "vscode";
import { Logger } from "../../utils/logger";

// ────────────────────────────────────────────
// BibTeX entry types
// ────────────────────────────────────────────

/** Standard BibTeX entry types. */
export const BIBTEX_ENTRY_TYPES = [
	"article",
	"book",
	"booklet",
	"conference",
	"inbook",
	"incollection",
	"inproceedings",
	"manual",
	"mastersthesis",
	"misc",
	"phdthesis",
	"proceedings",
	"techreport",
	"unpublished",
] as const;

export type BibtexEntryType = (typeof BIBTEX_ENTRY_TYPES)[number];

/** A single parsed BibTeX entry. */
export interface BibtexEntry {
	/** The entry type, e.g. "article", "book". */
	entryType: string;
	/** The citation key, e.g. "knuth1984". */
	citeKey: string;
	/** Field→value pairs (author, title, year, …). */
	fields: Record<string, string>;
	/** The raw text of the entry in the source file. */
	raw: string;
	/** Byte-offset based range in the original document. */
	startOffset: number;
	endOffset: number;
}

// ────────────────────────────────────────────
// BibTeX parser
// ────────────────────────────────────────────

/**
 * Parse all @type{key, ...} entries out of a .bib file.
 * Handles nested braces in field values.
 */
function parseBibtexEntries(text: string): BibtexEntry[] {
	const entries: BibtexEntry[] = [];
	const entryStart = /@(\w+)\s*\{/g;
	let match: RegExpExecArray | null;

	while ((match = entryStart.exec(text)) !== null) {
		const entryType = match[1].toLowerCase();

		// Skip @string, @preamble, @comment
		if (
			entryType === "string" ||
			entryType === "preamble" ||
			entryType === "comment"
		) {
			continue;
		}

		const startOffset = match.index;
		// Find the matching closing brace
		let depth = 1;
		let i = match.index + match[0].length;
		while (i < text.length && depth > 0) {
			if (text[i] === "{") {
				depth++;
			} else if (text[i] === "}") {
				depth--;
			}
			i++;
		}
		if (depth !== 0) {
			continue; // malformed
		}
		const endOffset = i;
		const raw = text.substring(startOffset, endOffset);

		// Inner text between the first { and the last }
		const inner = text.substring(
			match.index + match[0].length,
			endOffset - 1,
		);

		// First token is the cite key, followed by a comma
		const commaIdx = inner.indexOf(",");
		if (commaIdx === -1) {
			continue;
		}
		const citeKey = inner.substring(0, commaIdx).trim();
		const fieldsText = inner.substring(commaIdx + 1);

		const fields = parseFields(fieldsText);

		entries.push({
			entryType,
			citeKey,
			fields,
			raw,
			startOffset,
			endOffset,
		});
	}

	return entries;
}

/**
 * Parse "field = {value}, field2 = {value2}, ..." into a Record.
 * Handles brace-delimited and quote-delimited values.
 */
function parseFields(text: string): Record<string, string> {
	const fields: Record<string, string> = {};
	let pos = 0;

	while (pos < text.length) {
		// Skip whitespace and commas
		while (pos < text.length && /[\s,]/.test(text[pos])) {
			pos++;
		}
		if (pos >= text.length) {
			break;
		}

		// Read field name
		const nameStart = pos;
		while (pos < text.length && /[a-zA-Z0-9_-]/.test(text[pos])) {
			pos++;
		}
		const name = text.substring(nameStart, pos).trim().toLowerCase();
		if (!name) {
			break;
		}

		// Skip whitespace
		while (pos < text.length && /\s/.test(text[pos])) {
			pos++;
		}
		// Expect '='
		if (pos >= text.length || text[pos] !== "=") {
			break;
		}
		pos++; // skip '='

		// Skip whitespace
		while (pos < text.length && /\s/.test(text[pos])) {
			pos++;
		}

		// Read value
		let value = "";
		if (text[pos] === "{") {
			// Brace-delimited value
			let depth = 1;
			pos++; // skip opening brace
			const valStart = pos;
			while (pos < text.length && depth > 0) {
				if (text[pos] === "{") {
					depth++;
				} else if (text[pos] === "}") {
					depth--;
				}
				if (depth > 0) {
					pos++;
				}
			}
			value = text.substring(valStart, pos);
			pos++; // skip closing brace
		} else if (text[pos] === '"') {
			// Quote-delimited value
			pos++; // skip opening quote
			const valStart = pos;
			while (pos < text.length && text[pos] !== '"') {
				pos++;
			}
			value = text.substring(valStart, pos);
			pos++; // skip closing quote
		} else {
			// Bare value (number, macro)
			const valStart = pos;
			while (pos < text.length && text[pos] !== "," && text[pos] !== "}") {
				pos++;
			}
			value = text.substring(valStart, pos).trim();
		}

		if (name) {
			fields[name] = value;
		}
	}

	return fields;
}

/**
 * Re-serialise a BibtexEntry into well-formatted BibTeX text.
 */
function serialiseEntry(entry: BibtexEntry): string {
	const lines: string[] = [];
	lines.push(`@${entry.entryType}{${entry.citeKey},`);
	const keys = Object.keys(entry.fields);
	keys.forEach((key, idx) => {
		const val = entry.fields[key];
		const comma = idx < keys.length - 1 ? "," : "";
		lines.push(`\t${key} = {${val}}${comma}`);
	});
	lines.push("}");
	return lines.join("\n");
}

// ────────────────────────────────────────────
// Webview Panel Manager
// ────────────────────────────────────────────

export class BibtexEditor {
	private static panel: vscode.WebviewPanel | undefined;
	private static currentDocUri: vscode.Uri | undefined;
	private static logger = Logger.instance;
	private static changeListener: vscode.Disposable | undefined;
	private static suppressNextSync = false;

	/**
	 * Register the command and activation hooks.
	 */
	static register(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.commands.registerCommand("intex.openBibtexEditor", () =>
				BibtexEditor.open(context),
			),
		);

		// Auto-open the editor beside when a .bib file becomes active
		context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (
					editor &&
					editor.document.languageId === "bibtex"
				) {
					const autoOpen = vscode.workspace
						.getConfiguration("intex")
						.get<boolean>("bibtexEditor.autoOpen", true);
					if (autoOpen) {
						BibtexEditor.openPanel(context, editor.document.uri);
					} else if (BibtexEditor.panel) {
						BibtexEditor.loadDocument(editor.document.uri);
					}
				}
			}),
		);
	}

	// ════════════════════════════════════════
	// Open the editor
	// ════════════════════════════════════════

	private static async open(
		context: vscode.ExtensionContext,
	): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "bibtex") {
			vscode.window.showWarningMessage(
				"Open a .bib file to use the BibTeX Editor.",
			);
			return;
		}

		const docUri = editor.document.uri;
		await BibtexEditor.openPanel(context, docUri);
	}

	// ════════════════════════════════════════
	// Panel lifecycle
	// ════════════════════════════════════════

	private static async openPanel(
		context: vscode.ExtensionContext,
		docUri: vscode.Uri,
	): Promise<void> {
		BibtexEditor.currentDocUri = docUri;
		BibtexEditor.changeListener?.dispose();

		if (BibtexEditor.panel) {
			BibtexEditor.panel.reveal(vscode.ViewColumn.Beside);
			await BibtexEditor.loadDocument(docUri);
			BibtexEditor.setupDocumentListener();
			return;
		}

		const editorDir = vscode.Uri.joinPath(
			context.extensionUri,
			"dist",
			"bibtex_editor",
		);

		const panel = vscode.window.createWebviewPanel(
			"intex.bibtexEditor",
			"BibTeX Editor",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [editorDir],
			},
		);

		BibtexEditor.panel = panel;

		const cssUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "bibtex_editor.css"),
		);
		const jsUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(editorDir, "bibtex_editor.js"),
		);

		const nonce = getNonce();

		panel.webview.html = buildHTML(nonce, panel.webview.cspSource, cssUri, jsUri);

		panel.webview.onDidReceiveMessage(async (msg) => {
			switch (msg.type) {
				case "ready":
					await BibtexEditor.loadDocument(docUri);
					break;
				case "updateEntry":
					await BibtexEditor.updateEntry(msg.entry);
					break;
				case "createEntry":
					await BibtexEditor.createEntry(msg.entry);
					break;
				case "deleteEntry":
					await BibtexEditor.deleteEntry(msg.citeKey);
					break;
			}
		});

		panel.onDidDispose(() => {
			BibtexEditor.panel = undefined;
			BibtexEditor.changeListener?.dispose();
			BibtexEditor.changeListener = undefined;
		});

		BibtexEditor.setupDocumentListener();
		BibtexEditor.logger.info("BibTeX editor panel opened");
	}

	// ════════════════════════════════════════
	// Read .bib → send entries to webview
	// ════════════════════════════════════════

	private static async loadDocument(docUri: vscode.Uri): Promise<void> {
		BibtexEditor.currentDocUri = docUri;
		const doc = await vscode.workspace.openTextDocument(docUri);
		const text = doc.getText();
		const entries = parseBibtexEntries(text);

		const payload = entries.map((e) => ({
			entryType: e.entryType,
			citeKey: e.citeKey,
			fields: e.fields,
		}));

		BibtexEditor.panel?.webview.postMessage({
			type: "setEntries",
			entries: payload,
			fileName: vscode.workspace.asRelativePath(docUri, false),
		});
	}

	// ════════════════════════════════════════
	// CRUD operations → .bib file
	// ════════════════════════════════════════

	/**
	 * Update an existing entry in the .bib file.
	 * Finds the entry by its original cite key, replaces the raw text.
	 */
	private static async updateEntry(entry: {
		originalCiteKey: string;
		entryType: string;
		citeKey: string;
		fields: Record<string, string>;
	}): Promise<void> {
		if (!BibtexEditor.currentDocUri) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument(
			BibtexEditor.currentDocUri,
		);
		const text = doc.getText();
		const entries = parseBibtexEntries(text);
		const target = entries.find(
			(e) => e.citeKey === entry.originalCiteKey,
		);

		if (!target) {
			vscode.window.showWarningMessage(
				`Could not find entry "${entry.originalCiteKey}" in the file.`,
			);
			return;
		}

		const newEntry: BibtexEntry = {
			entryType: entry.entryType,
			citeKey: entry.citeKey,
			fields: entry.fields,
			raw: "",
			startOffset: target.startOffset,
			endOffset: target.endOffset,
		};

		const serialised = serialiseEntry(newEntry);

		const startPos = doc.positionAt(target.startOffset);
		const endPos = doc.positionAt(target.endOffset);
		const range = new vscode.Range(startPos, endPos);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, range, serialised);

		BibtexEditor.suppressNextSync = true;
		await vscode.workspace.applyEdit(edit);
		await doc.save();

		// Reload to keep webview in sync with new offsets
		await BibtexEditor.loadDocument(BibtexEditor.currentDocUri);
	}

	/**
	 * Create a new entry — appends at the end of the file.
	 */
	private static async createEntry(entry: {
		entryType: string;
		citeKey: string;
		fields: Record<string, string>;
	}): Promise<void> {
		if (!BibtexEditor.currentDocUri) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument(
			BibtexEditor.currentDocUri,
		);

		const newEntry: BibtexEntry = {
			entryType: entry.entryType,
			citeKey: entry.citeKey,
			fields: entry.fields,
			raw: "",
			startOffset: 0,
			endOffset: 0,
		};

		const serialised = serialiseEntry(newEntry);
		const text = doc.getText();
		const insertText = (text.endsWith("\n") ? "\n" : "\n\n") + serialised + "\n";

		const endPos = doc.positionAt(text.length);
		const edit = new vscode.WorkspaceEdit();
		edit.insert(doc.uri, endPos, insertText);

		BibtexEditor.suppressNextSync = true;
		await vscode.workspace.applyEdit(edit);
		await doc.save();

		await BibtexEditor.loadDocument(BibtexEditor.currentDocUri);
	}

	/**
	 * Delete an entry by its cite key.
	 */
	private static async deleteEntry(citeKey: string): Promise<void> {
		if (!BibtexEditor.currentDocUri) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument(
			BibtexEditor.currentDocUri,
		);
		const text = doc.getText();
		const entries = parseBibtexEntries(text);
		const target = entries.find((e) => e.citeKey === citeKey);

		if (!target) {
			vscode.window.showWarningMessage(
				`Could not find entry "${citeKey}" to delete.`,
			);
			return;
		}

		// Delete the entry plus any trailing whitespace/newlines
		let endOffset = target.endOffset;
		while (endOffset < text.length && /[\s]/.test(text[endOffset])) {
			endOffset++;
		}

		const startPos = doc.positionAt(target.startOffset);
		const endPos = doc.positionAt(endOffset);
		const range = new vscode.Range(startPos, endPos);

		const edit = new vscode.WorkspaceEdit();
		edit.delete(doc.uri, range);

		BibtexEditor.suppressNextSync = true;
		await vscode.workspace.applyEdit(edit);
		await doc.save();

		await BibtexEditor.loadDocument(BibtexEditor.currentDocUri);
	}

	// ────────────────────────────────────────
	// Document listener (external edits → webview)
	// ────────────────────────────────────────

	private static setupDocumentListener(): void {
		BibtexEditor.changeListener?.dispose();

		BibtexEditor.changeListener =
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (
					!BibtexEditor.currentDocUri ||
					e.document.uri.toString() !==
						BibtexEditor.currentDocUri.toString()
				) {
					return;
				}

				if (BibtexEditor.suppressNextSync) {
					BibtexEditor.suppressNextSync = false;
					return;
				}

				// External edit detected — reload
				BibtexEditor.loadDocument(BibtexEditor.currentDocUri!);
			});
	}
}

// ────────────────────────────────────────────
// HTML builder
// ────────────────────────────────────────────

function buildHTML(
	nonce: string,
	cspSource: string,
	cssUri: vscode.Uri,
	jsUri: vscode.Uri,
): string {
	return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none';
			script-src 'nonce-${nonce}' ${cspSource};
			style-src ${cspSource} 'unsafe-inline';
			font-src ${cspSource};">
	<link rel="stylesheet" href="${cssUri}">
</head>
<body>
	<div id="app">

		<!-- ══════ Left: Entry list ══════ -->
		<aside id="sidebar">
			<div id="sidebarHeader">
				<span id="fileLabel">BibTeX Editor</span>
				<button id="addBtn" title="New entry">+</button>
			</div>
			<div id="searchRow">
				<input type="text" id="searchInput" placeholder="Search by key, title, author…" spellcheck="false">
			</div>
			<div id="entryList"></div>
			<div id="entryCount"></div>
		</aside>

		<!-- ══════ Right: Detail form ══════ -->
		<main id="detail">
			<div id="emptyState">
				<p>Select an entry from the list or create a new one.</p>
			</div>
			<div id="entryForm" class="hidden">
				<div class="form-header">
					<div class="form-header-row">
						<label class="form-label" for="entryTypeSelect">Type</label>
						<select id="entryTypeSelect"></select>
						<label class="form-label" for="citeKeyInput">Key</label>
						<input type="text" id="citeKeyInput" placeholder="author2024keyword" spellcheck="false">
					</div>
				</div>
				<div class="form-actions-row">
					<button id="saveBtn" class="btn-primary" title="Save changes">Save</button>
					<button id="deleteBtn" class="btn-danger" title="Delete this entry">Delete</button>
				</div>

				<div id="fieldsContainer"></div>

				<div id="addFieldRow">
					<input type="text" id="newFieldName" placeholder="New field name…" spellcheck="false">
					<button id="addFieldBtn" title="Add field">+ Add</button>
				</div>
			</div>
		</main>
	</div>

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
