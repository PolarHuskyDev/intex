import * as vscode from "vscode";
import { Logger } from "../../utils/Logger";

export class PDFViewer implements vscode.CustomReadonlyEditorProvider {
	private logger = Logger.instance;

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

		// Directory containing the wasm assets (copied to dist/pdf_viewer by webpack)
		const pdfViewerDir = vscode.Uri.joinPath(this.extensionUri, "dist", "pdf_viewer");

		webview.options = {
			enableScripts: true,
			localResourceRoots: [pdfViewerDir],
		};

		// Webview-safe URIs for the wasm resources
		const wasmJsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(pdfViewerDir, "PDFViewer.js"),
		);
		const wasmBinUri = webview.asWebviewUri(
			vscode.Uri.joinPath(pdfViewerDir, "PDFViewer_bg.wasm"),
		);

		const nonce = getNonce();

		// Listen for the webview "ready" signal, then send the PDF bytes
		webview.onDidReceiveMessage(async (message) => {
			this.logger.info(`PDF Viewer webview message received: ${message.type}`);
			if (message.type === "ready") {
				try {
					const pdfData = await vscode.workspace.fs.readFile(document.uri);
					const base64 = Buffer.from(pdfData).toString("base64");
					webview.postMessage({ type: "loadPdf", data: base64 });
					this.logger.info(`Sent ${pdfData.byteLength} bytes to PDF viewer`);
				} catch (e) {
					this.logger.error(`Failed to read PDF file: ${e}`);
				}
			}
		});

		webview.html = `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy"
					content="default-src 'none';
						script-src 'nonce-${nonce}' 'wasm-unsafe-eval';
						style-src 'nonce-${nonce}';
						img-src ${webview.cspSource} blob: data:;
						connect-src ${webview.cspSource};
						font-src ${webview.cspSource};">
				<style nonce="${nonce}">
					body, html {
						margin: 0;
						padding: 0;
						width: 100%;
						height: 100%;
						overflow: hidden;
					}
					#canvas {
						width: 100% !important;
						height: 100% !important;
						display: block;
					}
				</style>
			</head>
			<body>
				<canvas id="canvas"></canvas>
				<script type="module" nonce="${nonce}">
					import init, { start_ui, load_pdf } from "${wasmJsUri}";

					// 1. Load the WASM module (does NOT start the UI yet)
					await init("${wasmBinUri}");

					// 2. Set up message listener BEFORE starting the event loop
					const vscodeApi = acquireVsCodeApi();
					window.addEventListener('message', (event) => {
						const message = event.data;
						if (message.type === 'loadPdf') {
							const binaryString = atob(message.data);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							load_pdf(bytes);
						}
					});

					// 3. Signal readiness so the extension sends the PDF data
					vscodeApi.postMessage({ type: 'ready' });

					// 4. Start the Slint UI event loop (may not return)
					start_ui();
				</script>
			</body>
			</html>`;

		this.logger.info(`PDF Viewer webview created for ${document.uri.fsPath}`);
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
