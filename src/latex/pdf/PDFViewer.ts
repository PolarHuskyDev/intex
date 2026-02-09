import * as vscode from "vscode";
import { Logger } from "../../utils/Logger";

interface ActivePanel {
	webview: vscode.Webview;
	documentUri: vscode.Uri;
	currentPage: number;
}

export class PDFViewer implements vscode.CustomReadonlyEditorProvider {
	private logger = Logger.instance;

	/** Track all open PDF viewer panels by their file path */
	private static activePanels = new Map<string, ActivePanel>();

	constructor(private readonly extensionUri: vscode.Uri) {}

	/**
	 * Register this provider with VS Code and return the disposable.
	 */
	static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			"intex.pdfViewer",
			new PDFViewer(context.extensionUri),
			{
				webviewOptions: { retainContextWhenHidden: true },
				supportsMultipleEditorsPerDocument: false,
			},
		);
	}

	/**
	 * Check whether a viewer is already open for a given PDF.
	 */
	static isOpen(pdfUri: vscode.Uri): boolean {
		return PDFViewer.activePanels.has(pdfUri.fsPath);
	}

	/**
	 * Open a new PDF viewer beside the active editor.
	 */
	static async open(pdfUri: vscode.Uri): Promise<void> {
		await vscode.commands.executeCommand(
			"vscode.openWith",
			pdfUri,
			"intex.pdfViewer",
			vscode.ViewColumn.Beside,
		);
	}

	/**
	 * Reload the content of an already-open PDF viewer.
	 */
	static async reload(pdfUri: vscode.Uri): Promise<void> {
		const panel = PDFViewer.activePanels.get(pdfUri.fsPath);
		if (!panel) {
			return;
		}

		const pdfData = await vscode.workspace.fs.readFile(panel.documentUri);
		const base64 = Buffer.from(pdfData).toString("base64");
		panel.webview.postMessage({ type: "loadPdf", data: base64, page: panel.currentPage, isReload: true });
		Logger.instance.info(`PDF reloaded: ${pdfUri.fsPath} (${pdfData.byteLength} bytes)`);
	}

	/**
	 * Scroll an open PDF viewer to a specific page and position (for forward search).
	 */
	static async scrollToPosition(
		pdfUri: vscode.Uri,
		page: number,
		x?: number,
		y?: number,
	): Promise<void> {
		const panel = PDFViewer.activePanels.get(pdfUri.fsPath);
		if (!panel) {
			return;
		}

		panel.webview.postMessage({
			type: "scrollToPosition",
			page,
			x: x ?? 0,
			y: y ?? 0,
		});
		Logger.instance.info(`PDF scroll to page ${page}`);
	}

	openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken,
	): vscode.CustomDocument {
		return { uri, dispose: () => {} };
	}

	resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): void {
		const webview = webviewPanel.webview;
		const key = document.uri.fsPath;

		// Directories with viewer assets
		const viewerDir = vscode.Uri.joinPath(this.extensionUri, "dist", "pdf_viewer");
		const pdfjsDir = vscode.Uri.joinPath(this.extensionUri, "dist", "pdf_viewer", "pdfjs");

		webview.options = {
			enableScripts: true,
			localResourceRoots: [viewerDir, pdfjsDir],
		};

		// Webview-safe URIs
		const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(viewerDir, "viewer.css"));
		const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(viewerDir, "viewer.js"));
		const pdfjsUri = webview.asWebviewUri(vscode.Uri.joinPath(pdfjsDir, "pdf.min.mjs"));
		const pdfjsWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(pdfjsDir, "pdf.worker.min.mjs"));

		const nonce = getNonce();

		// Register this panel for signal-based reloads
		PDFViewer.activePanels.set(key, { webview, documentUri: document.uri, currentPage: 1 });

		// Listen for webview messages
		webview.onDidReceiveMessage(async (message) => {
			if (message.type === "ready") {
				try {
					const pdfData = await vscode.workspace.fs.readFile(document.uri);
					const base64 = Buffer.from(pdfData).toString("base64");
					webview.postMessage({ type: "loadPdf", data: base64 });
					this.logger.info(`Sent ${pdfData.byteLength} bytes to PDF viewer`);
				} catch (e) {
					this.logger.error(`Failed to read PDF file: ${e}`);
				}
			} else if (message.type === "pageChange" && typeof message.page === "number") {
				// Track the current page for reload preservation
				const panel = PDFViewer.activePanels.get(key);
				if (panel) {
					panel.currentPage = message.page;
				}
			} else if (message.type === "openExternal" && message.url) {
				vscode.env.openExternal(vscode.Uri.parse(message.url));
			} else if (message.type === "synctexClick") {
				// Inverse search: PDF → source
				await vscode.commands.executeCommand(
					"intex.inverseSearch",
					document.uri.fsPath,
					message.page,
					message.x,
					message.y,
				);
			}
		});

		// Unregister when the panel is disposed
		webviewPanel.onDidDispose(() => {
			PDFViewer.activePanels.delete(key);
		});

		webview.html = this.buildHTML(nonce, webview.cspSource, cssUri, jsUri, pdfjsUri, pdfjsWorkerUri);
		this.logger.info(`PDF Viewer webview created for ${key}`);
	}

	// ------------------------------------------------------------------
	// HTML builder
	// ------------------------------------------------------------------
	private buildHTML(
		nonce: string,
		cspSource: string,
		cssUri: vscode.Uri,
		jsUri: vscode.Uri,
		pdfjsUri: vscode.Uri,
		pdfjsWorkerUri: vscode.Uri,
	): string {
		return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none';
			script-src 'nonce-${nonce}' ${cspSource};
			style-src ${cspSource};
			img-src ${cspSource} blob: data:;
			connect-src ${cspSource};
			worker-src ${cspSource} blob:;
			font-src ${cspSource};">
	<link rel="stylesheet" href="${cssUri}">
</head>
<body>
	<div id="app">
		<!-- Toolbar -->
		<div id="toolbar">
			<button class="tb-btn" id="prevBtn" title="Previous Page (←)">
				<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
			</button>

			<input type="number" id="pageInput" min="1" value="1">
			<span class="tb-label">of <span id="pageCount">0</span></span>

			<button class="tb-btn" id="nextBtn" title="Next Page (→)">
				<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
			</button>

			<div class="tb-sep"></div>

			<button class="tb-btn" id="zoomOutBtn" title="Zoom Out (-)">
				<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
			</button>

			<span class="tb-label" id="zoomLabel">100%</span>

			<button class="tb-btn" id="zoomInBtn" title="Zoom In (+)">
				<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
			</button>

			<div class="tb-sep"></div>

			<button class="tb-btn active" id="fitWidthBtn" title="Fit to Width">
				<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2"/><polyline points="8 12 6 10 6 14 8 12"/><polyline points="16 12 18 10 18 14 16 12"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
			</button>

			<button class="tb-btn" id="fitPageBtn" title="Fit to Page">
				<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="9 9 7 9 7 7 9 7"/><polyline points="15 9 17 9 17 7 15 7"/><polyline points="9 15 7 15 7 17 9 17"/><polyline points="15 15 17 15 17 17 15 17"/></svg>
			</button>

			<div class="tb-spacer"></div>

			<button class="tb-btn" id="syncSourceBtn" title="Reverse Search (jump to source)">
				<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
			</button>

			<button class="tb-btn" id="searchBtn" title="Search (Ctrl+F)">
				<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
			</button>

			<button class="tb-btn" id="sidebarToggle" title="Toggle Thumbnails">
				<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
			</button>
		</div>

		<!-- Search bar -->
		<div id="searchBar" class="hidden">
			<input type="text" id="searchInput" placeholder="Search in document…">
			<button class="tb-btn" id="searchPrev" title="Previous match">
				<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
			</button>
			<button class="tb-btn" id="searchNext" title="Next match">
				<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
			</button>
			<span id="searchInfo"></span>
			<button class="tb-btn" id="searchClose" title="Close">
				<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		</div>

		<!-- Content: main view + sidebar -->
		<div id="content">
			<div id="mainView">
				<div id="pagesContainer"></div>
			</div>
			<div id="sidebarSep"></div>
			<div id="sidebar"></div>
		</div>
	</div>

	<div id="loadingOverlay">Loading PDF...</div>

	<!-- Config for viewer.js -->
	<script nonce="${nonce}">
		window.__PDFJS_URL__ = "${pdfjsUri}";
		window.__PDFJS_WORKER_URL__ = "${pdfjsWorkerUri}";
	</script>

	<!-- Viewer logic -->
	<script src="${jsUri}" nonce="${nonce}" defer></script>
</body>
</html>`;
	}
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
