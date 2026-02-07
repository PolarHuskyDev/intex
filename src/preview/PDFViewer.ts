import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "../utils/Logger";

export class PDFViewer implements vscode.CustomReadonlyEditorProvider {
	private panels: Map<string, vscode.WebviewPanel> = new Map();
	private panelDocuments: Map<string, vscode.Uri> = new Map();
	private zoomLevels: Map<string, number> = new Map(); // Track zoom per PDF
	private fitModes: Map<string, string | null> = new Map(); // Track fit mode per PDF
	private currentPages: Map<string, number> = new Map(); // Track current page per PDF
	private inverseSearchCallback?: (
		pdfPath: string,
		page: number,
		x: number,
		y: number,
	) => Promise<void>;

	constructor(
		private context: vscode.ExtensionContext,
		private logger: Logger,
	) {}

	/**
	 * CustomReadonlyEditorProvider implementation
	 */
	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => {} };
	}

	async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
	): Promise<void> {
		this.logger.info(`Opening PDF as custom editor: ${document.uri.fsPath}`);

		const pdfPath = document.uri.fsPath;
		const panelKey = pdfPath;

		// Store panel
		this.panels.set(panelKey, webviewPanel);

		// Configure webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};

		// Load PDF content
		await this.updatePDFContent(webviewPanel, pdfPath);

		// Handle cleanup
		webviewPanel.onDidDispose(() => {
			this.panels.delete(panelKey);
			this.panelDocuments.delete(panelKey);
		});

		// Handle messages from webview
		webviewPanel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === "click" && this.inverseSearchCallback) {
				try {
					await this.inverseSearchCallback(
						pdfPath,
						message.page,
						message.x,
						message.y,
					);
				} catch (error: any) {
					this.logger.error(`Inverse search failed: ${error.message}`);
				}
			} else if (message.type === "zoomChange") {
				// Save zoom level for this PDF
				this.zoomLevels.set(pdfPath, message.zoom);
				this.logger.info(`Saved zoom level ${message.zoom} for ${pdfPath}`);
			} else if (message.type === "fitModeChange") {
				// Save fit mode for this PDF
				this.fitModes.set(pdfPath, message.fitMode);
				this.logger.info(`Saved fit mode ${message.fitMode} for ${pdfPath}`);
			} else if (message.type === "pageChange") {
				// Save current page for this PDF
				this.currentPages.set(pdfPath, message.page);
				this.logger.info(`Saved page ${message.page} for ${pdfPath}`);
			}
		});
	}

	/**
	 * Set callback for inverse search (PDF → editor)
	 */
	public setInverseSearchCallback(
		callback: (
			pdfPath: string,
			page: number,
			x: number,
			y: number,
		) => Promise<void>,
	): void {
		this.inverseSearchCallback = callback;
	}

	async showPDF(
		documentUri: vscode.Uri,
		position?: { page: number; x: number; y: number },
	): Promise<void> {
		const docPath = documentUri.fsPath;
		const docDir = path.dirname(docPath);
		const docName = path.basename(docPath, ".tex");
		const pdfPath = path.join(docDir, `${docName}.pdf`);

		this.logger.info(`Opening PDF: ${pdfPath}`);

		try {
			// Check if PDF exists
			if (!fs.existsSync(pdfPath)) {
				vscode.window.showErrorMessage(`PDF not found: ${pdfPath}`);
				return;
			}

			// Get or create panel for this PDF
			const panelKey = pdfPath;
			let panel = this.panels.get(panelKey);

			// Store the document URI for this panel (for forward search)
			this.panelDocuments.set(panelKey, documentUri);

			if (panel) {
				// Panel exists, reveal it and update content (without stealing focus)
				panel.reveal(vscode.ViewColumn.Beside, true);
				this.updatePDFContent(panel, pdfPath);
			} else {
				// Create new panel (without stealing focus)
				panel = vscode.window.createWebviewPanel(
					"intexPdfPreview",
					`PDF: ${docName}`,
					{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
					{
						enableScripts: true,
						retainContextWhenHidden: true,
						localResourceRoots: [vscode.Uri.file(docDir)],
					},
				);

				this.panels.set(panelKey, panel);

				// Clean up when panel is disposed
				panel.onDidDispose(() => {
					this.panels.delete(panelKey);
					this.panelDocuments.delete(panelKey);
				});

				// Set initial content
				this.updatePDFContent(panel, pdfPath);
			}

			// Handle messages from webview (for inverse search)
			// Register this every time to ensure it works with reused panels
			panel.webview.onDidReceiveMessage(
				async (message) => {
					if (message.type === "inverseSearch" && this.inverseSearchCallback) {
						await this.inverseSearchCallback(
							pdfPath,
							message.page,
							message.x,
							message.y,
						);
					} else if (message.type === "zoomChange") {
						// Save zoom level for this PDF
						this.zoomLevels.set(pdfPath, message.zoom);
						this.logger.info(`Saved zoom level ${message.zoom} for ${pdfPath}`);
					} else if (message.type === "fitModeChange") {
						// Save fit mode for this PDF
						this.fitModes.set(pdfPath, message.fitMode);
						this.logger.info(
							`Saved fit mode ${message.fitMode} for ${pdfPath}`,
						);
					} else if (message.type === "pageChange") {
						// Save current page for this PDF
						this.currentPages.set(pdfPath, message.page);
						this.logger.info(`Saved page ${message.page} for ${pdfPath}`);
					} else if (message.type === "triggerForwardSearch") {
						// Get the document associated with this PDF panel
						const docUri = this.panelDocuments.get(panelKey);
						if (docUri) {
							// Open the document and trigger forward search
							const document = await vscode.workspace.openTextDocument(docUri);
							const editor = await vscode.window.showTextDocument(
								document,
								vscode.ViewColumn.One,
								true,
							);
							const line = editor.selection.active.line;
							await vscode.commands.executeCommand(
								"intex.synctex.forwardSearch",
							);
						}
					}
				},
				undefined,
				this.context.subscriptions,
			);

			// If position provided, send it to webview after content loads
			if (position && panel) {
				setTimeout(() => {
					panel.webview.postMessage({
						type: "scrollToPosition",
						page: position.page,
						x: position.x,
						y: position.y,
					});
				}, 500); // Small delay to ensure PDF is loaded
			}

			this.logger.info("PDF opened successfully");
		} catch (error) {
			this.logger.error(`Failed to open PDF: ${error}`);
			vscode.window.showErrorMessage(`Failed to open PDF: ${error}`);
		}
	}

	private updatePDFContent(panel: vscode.WebviewPanel, pdfPath: string): void {
		try {
			// Read PDF file as base64 to work with WSL and cross-platform scenarios
			const pdfBuffer = fs.readFileSync(pdfPath);
			const pdfBase64 = pdfBuffer.toString("base64");
			const pdfDataUri = `data:application/pdf;base64,${pdfBase64}`;

			// Get saved zoom level, fit mode, and page for this PDF
			const savedZoom = this.zoomLevels.get(pdfPath) || 1.5;
			const savedFitMode = this.fitModes.get(pdfPath) || null;
			const savedPage = this.currentPages.get(pdfPath) || 1;

			panel.webview.html = this.getWebviewContent(
				pdfDataUri,
				savedZoom,
				savedFitMode,
				savedPage,
			);
			this.logger.info(
				`PDF loaded: ${pdfPath} (${pdfBuffer.length} bytes), zoom: ${savedZoom}, fitMode: ${savedFitMode}, page: ${savedPage}`,
			);
		} catch (error) {
			this.logger.error(`Failed to read PDF file: ${error}`);
			panel.webview.html = this.getErrorContent(`Failed to read PDF: ${error}`);
		}
	}

	private getWebviewContent(
		pdfDataUri: string,
		initialZoom: number = 1.5,
		initialFitMode: string | null = null,
		initialPage: number = 1,
	): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; worker-src blob:; img-src data:; connect-src data:;">
    <title>PDF Preview</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <style>
        * {
            box-sizing: border-box;
        }
        
        body {
            margin: 0;
            padding: 0;
            background-color: var(--vscode-editor-background);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
            font-family: var(--vscode-font-family);
        }
        
        #toolbar {
            background-color: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
            padding: 10px 20px;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 10;
            min-height: 52px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .toolbar-button {
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-widget-border);
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
            min-width: 36px;
            justify-content: center;
        }
        
        .toolbar-button:hover:not(:disabled) {
            background-color: var(--vscode-toolbar-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }
        
        .toolbar-button:active:not(:disabled) {
            background-color: var(--vscode-button-secondaryBackground);
        }
        
        .toolbar-button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        .toolbar-button svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }
        
        .toolbar-separator {
            width: 1px;
            height: 24px;
            background-color: var(--vscode-widget-border);
            margin: 0 6px;
        }
        
        #pageIndicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 10px;
            color: var(--vscode-foreground);
            font-size: 14px;
        }
        
        #pageNum {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            padding: 6px 12px;
            border-radius: 4px;
            width: 60px;
            text-align: center;
            font-size: 14px;
            outline: none;
            -moz-appearance: textfield;
        }
        
        /* Hide number input spinners */
        #pageNum::-webkit-outer-spin-button,
        #pageNum::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        
        #pageNum:focus {
            border-color: var(--vscode-focusBorder);
            background-color: var(--vscode-input-background);
        }
        
        #zoomLevel {
            background-color: var(--vscode-badge-background);
            border: 1px solid var(--vscode-widget-border);
            color: var(--vscode-badge-foreground);
            padding: 6px 12px;
            border-radius: 4px;
            min-width: 65px;
            text-align: center;
            font-size: 14px;
            font-weight: 500;
        }
        
        .spacer {
            flex-grow: 1;
        }
        
        #pdfContainer {
            flex: 1;
            overflow: auto;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 20px;
            background-color: var(--vscode-editor-background);
        }
        
        #pdfCanvas {
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            background: white;
            display: block;
        }
        
        .loading {
            color: var(--vscode-foreground);
            text-align: center;
            padding: 50px;
            font-size: 18px;
        }
        
        .error {
            color: var(--vscode-errorForeground);
            text-align: center;
            padding: 50px;
            font-size: 16px;
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button class="toolbar-button" id="prevPage" title="Previous Page (←)">
            <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        
        <div id="pageIndicator">
            <input type="number" id="pageNum" min="1" value="1">
            <span>/ <span id="pageCount">0</span></span>
        </div>
        
        <button class="toolbar-button" id="nextPage" title="Next Page (→)">
            <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
        
        <div class="toolbar-separator"></div>
        
        <button class="toolbar-button" id="zoomOut" title="Zoom Out (-)">
            <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z"/></svg>
        </button>
        
        <div id="zoomLevel">100%</div>
        
        <button class="toolbar-button" id="zoomIn" title="Zoom In (+)">
            <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm.5-7h-1v2H7v1h2v2h1v-2h2V9h-2z"/></svg>
        </button>
        
        <div class="toolbar-separator"></div>
        
        <button class="toolbar-button" id="fitWidth" title="Fit Width">
            <svg viewBox="0 0 16 16"><path d="M8 15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 1 0v13a.5.5 0 0 1-.5.5M.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8"/></svg>
        </button>
        
        <button class="toolbar-button" id="fitPage" title="Fit Page">
            <svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707m4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707"/></svg>
        </button>
        
        <div class="spacer"></div>
        
        <button class="toolbar-button" id="refresh" title="Refresh PDF">
            <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
    </div>
    
    <div id="pdfContainer">
        <canvas id="pdfCanvas"></canvas>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const pdfUrl = '${pdfDataUri}';
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        
        let pdfDoc = null;
        let currentPage = ${initialPage};
        let scale = ${initialZoom};
        let rendering = false;
        let fitMode = ${initialFitMode ? `'${initialFitMode}'` : "null"}; // null, 'width', or 'page'
        
        const canvas = document.getElementById('pdfCanvas');
        const ctx = canvas.getContext('2d');
        const container = document.getElementById('pdfContainer');
        
        // Load PDF
        async function loadPDF() {
            try {
                container.innerHTML = '<div class="loading">Loading PDF...</div>';
                pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
                document.getElementById('pageCount').textContent = pdfDoc.numPages;
                
                // Restore canvas
                container.innerHTML = '';
                container.appendChild(canvas);
                
                renderPage(currentPage);
                updateControls();
            } catch (error) {
                container.innerHTML = '<div class="error">Failed to load PDF: ' + error.message + '</div>';
                console.error('Error loading PDF:', error);
            }
        }
        
        // Render page
        async function renderPage(pageNum) {
            if (rendering || !pdfDoc) return;
            rendering = true;
            
            try {
                const page = await pdfDoc.getPage(pageNum);
                
                // Calculate scale based on fit mode
                if (fitMode === 'width') {
                    const containerWidth = container.clientWidth - 40;
                    const viewport = page.getViewport({ scale: 1.0 });
                    scale = containerWidth / viewport.width;
                } else if (fitMode === 'page') {
                    const containerWidth = container.clientWidth - 40;
                    const containerHeight = container.clientHeight - 40;
                    const viewport = page.getViewport({ scale: 1.0 });
                    const scaleX = containerWidth / viewport.width;
                    const scaleY = containerHeight / viewport.height;
                    scale = Math.min(scaleX, scaleY);
                }
                
                const viewport = page.getViewport({ scale: scale });
                
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };
                
                await page.render(renderContext).promise;
                
                currentPage = pageNum;
                updateControls();
                
                // Scroll to top of page
                container.scrollTop = 0;
                
                // Notify extension of page change
                vscode.postMessage({ type: 'pageChange', page: currentPage });
            } catch (error) {
                console.error('Error rendering page:', error);
            } finally {
                rendering = false;
            }
        }
        
        function updateControls() {
            document.getElementById('prevPage').disabled = currentPage <= 1;
            document.getElementById('nextPage').disabled = currentPage >= pdfDoc.numPages;
            document.getElementById('zoomLevel').textContent = Math.round(scale * 100) + '%';
            document.getElementById('pageNum').value = currentPage;
            document.getElementById('pageNum').max = pdfDoc.numPages;
        }
        
        // Navigation
        document.getElementById('prevPage').addEventListener('click', () => {
            if (currentPage > 1) {
                renderPage(currentPage - 1);
            }
        });
        
        document.getElementById('nextPage').addEventListener('click', () => {
            if (currentPage < pdfDoc.numPages) {
                renderPage(currentPage + 1);
            }
        });

        // Page number input
        document.getElementById('pageNum').addEventListener('change', (e) => {
            let pageNum = parseInt(e.target.value);
            if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
            if (pageNum > pdfDoc.numPages) pageNum = pdfDoc.numPages;
            renderPage(pageNum);
        });

        document.getElementById('pageNum').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
        });
        
        // Zoom controls
        document.getElementById('zoomIn').addEventListener('click', () => {
            fitMode = null;
            scale *= 1.25;
            if (scale > 5.0) scale = 5.0;
            renderPage(currentPage);
            vscode.postMessage({ type: 'zoomChange', zoom: scale });
            vscode.postMessage({ type: 'fitModeChange', fitMode: null });
        });
        
        document.getElementById('zoomOut').addEventListener('click', () => {
            fitMode = null;
            scale /= 1.25;
            if (scale < 0.25) scale = 0.25;
            renderPage(currentPage);
            vscode.postMessage({ type: 'zoomChange', zoom: scale });
            vscode.postMessage({ type: 'fitModeChange', fitMode: null });
        });
        
        document.getElementById('fitWidth').addEventListener('click', () => {
            fitMode = 'width';
            renderPage(currentPage);
            vscode.postMessage({ type: 'fitModeChange', fitMode: fitMode });
        });
        
        document.getElementById('fitPage').addEventListener('click', () => {
            fitMode = 'page';
            renderPage(currentPage);
            vscode.postMessage({ type: 'fitModeChange', fitMode: fitMode });
        });
        
        // Refresh
        document.getElementById('refresh').addEventListener('click', () => {
            loadPDF();
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts if input is focused
            if (document.activeElement.tagName === 'INPUT') return;
            
            if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                e.preventDefault();
                document.getElementById('prevPage').click();
            } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
                e.preventDefault();
                document.getElementById('nextPage').click();
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                document.getElementById('zoomIn').click();
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                document.getElementById('zoomOut').click();
            } else if (e.key === '0') {
                e.preventDefault();
                fitMode = null;
                scale = 1.0;
                renderPage(currentPage);
            }
        });
        
        // Mouse wheel zoom (with Ctrl)
        container.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                fitMode = null;
                
                if (e.deltaY < 0) {
                    scale *= 1.1;
                    if (scale > 5.0) scale = 5.0;
                } else {
                    scale /= 1.1;
                    if (scale < 0.25) scale = 0.25;
                }
                
                renderPage(currentPage);
            }
        });
        
        // Listen for SyncTeX position messages
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'scrollToPosition') {
                if (message.page && message.page !== currentPage) {
                    renderPage(message.page);
                }
            }
        });

        // Inverse search: Ctrl+Click on PDF → jump to source
        canvas.addEventListener('click', async (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const page = await pdfDoc.getPage(currentPage);
                const viewport = page.getViewport({ scale: scale });
                
                // PDF.js uses bottom-left origin, so we need to flip Y
                const pdfX = x / scale;
                const pdfY = viewport.height / scale - (y / scale);
                
                // Send inverse search request to extension
                vscode.postMessage({
                    type: 'inverseSearch',
                    page: currentPage,
                    x: pdfX,
                    y: pdfY
                });
            }
        });

        // Initial load
        loadPDF();
    </script>
</body>
</html>`;
	}

	private getErrorContent(errorMessage: string): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Preview Error</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: #1e1e1e;
            color: #cccccc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }
        
        .error-container {
            text-align: center;
            padding: 40px;
            max-width: 600px;
        }
        
        .error-icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        
        h1 {
            color: #f48771;
            margin-bottom: 20px;
        }
        
        p {
            line-height: 1.6;
            margin-bottom: 10px;
        }
        
        .error-message {
            background-color: #2d2d2d;
            padding: 15px;
            border-radius: 5px;
            margin-top: 20px;
            font-family: monospace;
            font-size: 14px;
            word-break: break-word;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">📄❌</div>
        <h1>Failed to Load PDF</h1>
        <p>The PDF file could not be loaded.</p>
        <div class="error-message">${errorMessage}</div>
        <p style="margin-top: 30px;">
            Make sure the LaTeX document compiled successfully and try building again.
        </p>
    </div>
</body>
</html>`;
	}
}
