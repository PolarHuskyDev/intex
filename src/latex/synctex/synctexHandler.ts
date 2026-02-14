import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import { Logger } from "../../utils/logger";
import { Config } from "../../utils/config";
import { PDFViewer } from "../pdf/PDFViewer";

export interface SyncTexPosition {
	page: number;
	x: number;
	y: number;
}

/**
 * Handles SyncTeX forward and inverse search between editor and PDF.
 * Output-directory aware and build-method (local / docker) aware.
 */
export class SyncTexHandler {
	private logger = Logger.instance;
	private config = Config.instance;

	/**
	 * Callback that returns the *actual* build method in use after
	 * auto-detection ("local" | "docker" | "none").
	 * When not set, falls back to the raw config value.
	 */
	private buildMethodResolver?: () => "local" | "docker" | "none";

	constructor(private context: vscode.ExtensionContext) {}

	/**
	 * Wire up the resolver so SyncTeX uses the runtime build method,
	 * not the raw config value (which may be "auto").
	 */
	public setBuildMethodResolver(
		resolver: () => "local" | "docker" | "none",
	): void {
		this.buildMethodResolver = resolver;
	}

	/**
	 * Register all SyncTeX-related commands with VS Code.
	 */
	public registerCommands(): void {
		// Open PDF (output-directory & rootFile aware)
		this.context.subscriptions.push(
			vscode.commands.registerCommand("intex.openPdf", async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document.languageId !== "latex") {
					vscode.window.showWarningMessage("No active LaTeX document");
					return;
				}

				const pdfPath = this.getPdfPath(editor.document.uri.fsPath);
				const pdfUri = vscode.Uri.file(pdfPath);

				if (PDFViewer.isOpen(pdfUri)) {
					await PDFViewer.reload(pdfUri);
				} else {
					await PDFViewer.open(pdfUri);
				}
			}),
		);

		// Forward search (source → PDF)
		this.context.subscriptions.push(
			vscode.commands.registerCommand("intex.forwardSearch", async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document.languageId !== "latex") {
					vscode.window.showWarningMessage("No active LaTeX document");
					return;
				}

				const position = await this.forwardSearch(
					editor.document,
					editor.selection.active.line,
				);

				if (position) {
					const pdfPath = this.getPdfPath(editor.document.uri.fsPath);
					const pdfUri = vscode.Uri.file(pdfPath);

					if (!PDFViewer.isOpen(pdfUri)) {
						await PDFViewer.open(pdfUri);
						await new Promise((r) => setTimeout(r, 1500));
					}

					await PDFViewer.scrollToPosition(
						pdfUri,
						position.page,
						position.x,
						position.y,
					);
				}
			}),
		);

		// Inverse search (PDF → source) — called by PDF viewer
		this.context.subscriptions.push(
			vscode.commands.registerCommand(
				"intex.inverseSearch",
				async (pdfPath: string, page: number, x: number, y: number) => {
					await this.inverseSearch(pdfPath, page, x, y);
				},
			),
		);
	}

	/** Whether the active build method is Docker. */
	private get isDocker(): boolean {
		if (this.buildMethodResolver) {
			return this.buildMethodResolver() === "docker";
		}
		// Fallback: only explicit "docker" setting
		return this.config.buildMethod === "docker";
	}

	// ----------------------------------------------------------------
	// Forward search  (source → PDF)
	// ----------------------------------------------------------------

	/**
	 * Forward search: given a document and line, return the PDF page and
	 * coordinates where that line appears.
	 */
	public async forwardSearch(
		document: vscode.TextDocument,
		line: number,
	): Promise<SyncTexPosition | null> {
		try {
			const texPath = document.uri.fsPath;
			const { pdfPath } = this.resolveMainPaths(texPath);
			const synctexPath = this.getSynctexPath(pdfPath);

			if (!fs.existsSync(pdfPath)) {
				vscode.window.showWarningMessage(
					"PDF not found. Build the document first.",
				);
				return null;
			}

			if (!fs.existsSync(synctexPath)) {
				vscode.window.showWarningMessage(
					"SyncTeX data not found. Ensure -synctex=1 is enabled.",
				);
				return null;
			}

			const synctexLine = line + 1; // editor 0-based → SyncTeX 1-based

			const result = await this.querySyncTeX("view", {
				line: synctexLine,
				input: texPath,
				output: pdfPath,
			});

			if (result && result.page) {
				this.logger.info(
					`Forward search: ${path.basename(texPath)}:${synctexLine} → page ${result.page}`,
				);
				return {
					page: result.page,
					x: result.x ?? result.h ?? 0,
					y: result.y ?? result.v ?? 0,
				};
			}

			this.logger.warn("Forward search: no SyncTeX result");
			return null;
		} catch (error) {
			this.logger.error(`Forward search failed: ${error}`);
			vscode.window.showErrorMessage(`Forward search failed: ${error}`);
			return null;
		}
	}

	// ----------------------------------------------------------------
	// Inverse search  (PDF → source)
	// ----------------------------------------------------------------

	/**
	 * Inverse search: given a PDF position, navigate the editor to the
	 * corresponding source location.
	 */
	public async inverseSearch(
		pdfPath: string,
		page: number,
		x: number,
		y: number,
	): Promise<void> {
		try {
			const synctexPath = this.getSynctexPath(pdfPath);

			if (!fs.existsSync(synctexPath)) {
				vscode.window.showWarningMessage(
					"SyncTeX data not found. Build with -synctex=1 enabled.",
				);
				return;
			}

			const result = await this.querySyncTeX("edit", {
				page,
				x,
				y,
				output: pdfPath,
			});

			if (result && result.input) {
				await this.navigateToSource(result, pdfPath);
			} else {
				this.logger.warn("Inverse search: no SyncTeX result");
				vscode.window.showInformationMessage(
					"SyncTeX could not find a source location for this position.",
				);
			}
		} catch (error) {
			this.logger.error(`Inverse search failed: ${error}`);
			vscode.window.showErrorMessage(`Inverse search failed: ${error}`);
		}
	}

	/**
	 * Open the editor at the source location returned by inverse search.
	 */
	private async navigateToSource(
		result: Record<string, any>,
		pdfPath: string,
	): Promise<void> {
		let inputPath: string = result.input;
		this.logger.info(`SyncTeX returned input path: ${inputPath}`);

		// Docker builds record container paths — translate back to host
		if (this.isDocker) {
			inputPath = this.containerToHostPath(inputPath);
		}

		// Resolve relative paths
		if (!path.isAbsolute(inputPath)) {
			const workspaceRoot = this.getWorkspaceRoot();
			if (workspaceRoot) {
				const wsResolved = path.resolve(workspaceRoot, inputPath);
				if (fs.existsSync(wsResolved)) {
					inputPath = wsResolved;
				} else {
					inputPath = path.resolve(path.dirname(pdfPath), inputPath);
				}
			} else {
				inputPath = path.resolve(path.dirname(pdfPath), inputPath);
			}
		}

		inputPath = path.normalize(inputPath);
		this.logger.info(`Resolved source path: ${inputPath}`);

		// Try workspace file search first (handles WSL / remote scenarios)
		let uri: vscode.Uri | undefined;
		const fileName = path.basename(inputPath);
		const files = await vscode.workspace.findFiles(
			`**/${fileName}`,
			null,
			10,
		);

		if (files.length > 0) {
			uri =
				files.find((f) => path.normalize(f.fsPath) === inputPath) ||
				files[0];
		}

		if (!uri) {
			uri = vscode.Uri.file(inputPath);
		}

		const doc = await vscode.workspace.openTextDocument(uri);
		let editor = vscode.window.visibleTextEditors.find(
			(e) => e.document.uri.toString() === uri!.toString(),
		);

		if (editor) {
			await vscode.window.showTextDocument(doc, editor.viewColumn, false);
		} else {
			editor = await vscode.window.showTextDocument(
				doc,
				vscode.ViewColumn.One,
				false,
			);
		}

		const line = Math.max(0, (result.line || 1) - 1);
		const column = Math.max(0, result.column || 0);
		const position = new vscode.Position(line, column);

		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(
			new vscode.Range(position, position),
			vscode.TextEditorRevealType.InCenter,
		);

		this.logger.info(
			`Inverse search → ${path.basename(inputPath)}:${result.line}`,
		);
	}

	// ----------------------------------------------------------------
	// Path helpers  (output-directory & rootFile aware)
	// ----------------------------------------------------------------

	/**
	 * Resolve the main TeX file, PDF path, and output directory for a
	 * given .tex file — taking rootFile and outputDirectory into account.
	 */
	public resolveMainPaths(currentTexPath: string): {
		mainTexPath: string;
		pdfPath: string;
		outputDir: string;
	} {
		const rootFile = this.config.rootFile;
		let mainTexPath = currentTexPath;

		if (rootFile) {
			const workspaceRoot = this.getWorkspaceRoot();
			if (workspaceRoot) {
				mainTexPath = path.isAbsolute(rootFile)
					? rootFile
					: path.join(workspaceRoot, rootFile);
			}
		}

		const mainName = path.basename(mainTexPath, ".tex");
		const outputDir = this.getOutputDirectory(path.dirname(mainTexPath));
		const pdfPath = path.join(outputDir, `${mainName}.pdf`);

		return { mainTexPath, pdfPath, outputDir };
	}

	/** Convenience: get only the PDF path. */
	public getPdfPath(texPath: string): string {
		return this.resolveMainPaths(texPath).pdfPath;
	}

	// ----------------------------------------------------------------
	// SyncTeX CLI interaction
	// ----------------------------------------------------------------

	/**
	 * Run the synctex command-line tool.
	 * When the build method is "docker", runs inside the same container image.
	 */
	private async querySyncTeX(
		mode: "view" | "edit",
		params: {
			line?: number;
			input?: string;
			page?: number;
			x?: number;
			y?: number;
			output: string;
		},
	): Promise<Record<string, any> | null> {
		const useDocker = this.isDocker;

		return new Promise((resolve, reject) => {
			let baseCommand: string;

			if (mode === "view") {
				const inputArg = useDocker
					? this.hostToContainerPath(params.input!)
					: params.input;
				const outputArg = useDocker
					? this.hostToContainerPath(params.output)
					: params.output;
				baseCommand = `synctex view -i "${params.line}:0:${inputArg}" -o "${outputArg}"`;
			} else {
				const outputArg = useDocker
					? this.hostToContainerPath(params.output)
					: params.output;
				baseCommand = `synctex edit -o "${params.page}:${params.x}:${params.y}:${outputArg}"`;
			}

			let command: string;
			if (useDocker) {
				const workspaceRoot =
					this.getWorkspaceRoot() || path.dirname(params.output);
				const outputDir = this.getOutputDirectory(workspaceRoot);
				const dockerImage = this.config.dockerImage;
				command =
					`docker run --rm` +
					` -v "${workspaceRoot}:/workspace"` +
					` -v "${outputDir}:/output"` +
					` -w /workspace ${dockerImage} ${baseCommand}`;
			} else {
				command = baseCommand;
			}

			this.logger.info(`SyncTeX: ${command}`);

			child_process.exec(
				command,
				{ timeout: 10000 },
				(error, stdout, stderr) => {
					if (error) {
						this.logger.error(`SyncTeX error: ${error.message}`);
						reject(error);
						return;
					}

					if (stderr) {
						this.logger.warn(`SyncTeX stderr: ${stderr}`);
					}

					resolve(this.parseSyncTexOutput(stdout));
				},
			);
		});
	}

	/** Parse the key: value output produced by the synctex CLI. */
	private parseSyncTexOutput(output: string): Record<string, any> | null {
		const lines = output.split("\n");
		const result: Record<string, any> = {};

		for (const line of lines) {
			if (line.startsWith("Page:")) {
				result.page = parseInt(line.substring(5).trim(), 10);
			} else if (line.startsWith("x:")) {
				result.x = parseFloat(line.substring(2).trim());
			} else if (line.startsWith("y:")) {
				result.y = parseFloat(line.substring(2).trim());
			} else if (line.startsWith("h:")) {
				result.h = parseFloat(line.substring(2).trim());
			} else if (line.startsWith("v:")) {
				result.v = parseFloat(line.substring(2).trim());
			} else if (line.startsWith("W:")) {
				result.W = parseFloat(line.substring(2).trim());
			} else if (line.startsWith("H:")) {
				result.H = parseFloat(line.substring(2).trim());
			} else if (line.startsWith("Input:")) {
				// Value may contain colons (Windows paths C:\…)
				result.input = line.substring(6).trim();
			} else if (line.startsWith("Line:")) {
				result.line = parseInt(line.substring(5).trim(), 10);
			} else if (line.startsWith("Column:")) {
				result.column = parseInt(line.substring(7).trim(), 10);
			}
		}

		return Object.keys(result).length > 0 ? result : null;
	}

	// ----------------------------------------------------------------
	// Docker path translation
	// ----------------------------------------------------------------

	/** Translate a host filesystem path to its container-mount equivalent. */
	private hostToContainerPath(hostPath: string): string {
		const workspaceRoot = this.getWorkspaceRoot();
		if (workspaceRoot) {
			const outputDir = this.getOutputDirectory(workspaceRoot);
			const normHost = path.normalize(hostPath);
			const normOut = path.normalize(outputDir);
			const normWs = path.normalize(workspaceRoot);

			// Check output dir first (it may be inside the workspace)
			if (normHost.startsWith(normOut + path.sep) || normHost === normOut) {
				return (
					"/output" +
					normHost.substring(normOut.length).replace(/\\/g, "/")
				);
			}
			if (normHost.startsWith(normWs + path.sep) || normHost === normWs) {
				return (
					"/workspace" +
					normHost.substring(normWs.length).replace(/\\/g, "/")
				);
			}
		}
		return hostPath;
	}

	/** Translate a container path back to the host filesystem. */
	private containerToHostPath(containerPath: string): string {
		const workspaceRoot = this.getWorkspaceRoot();
		if (workspaceRoot) {
			const outputDir = this.getOutputDirectory(workspaceRoot);
			if (containerPath.startsWith("/output/")) {
				return path.join(outputDir, containerPath.substring(8));
			}
			if (containerPath === "/output") {
				return outputDir;
			}
			if (containerPath.startsWith("/workspace/")) {
				return path.join(workspaceRoot, containerPath.substring(11));
			}
			if (containerPath === "/workspace") {
				return workspaceRoot;
			}
		}
		return containerPath;
	}

	// ----------------------------------------------------------------
	// Utility
	// ----------------------------------------------------------------

	/**
	 * Resolve the output directory — mirrors the logic in
	 * LocalBuilder / DockerBuilder.
	 */
	private getOutputDirectory(docDir: string): string {
		const outputDir = this.config.outputDirectory;
		if (path.isAbsolute(outputDir)) {
			return outputDir;
		}
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(
			vscode.Uri.file(docDir),
		);
		const baseDir = workspaceFolder?.uri.fsPath || docDir;
		return path.resolve(baseDir, outputDir);
	}

	/** First workspace folder root path. */
	private getWorkspaceRoot(): string | undefined {
		const folders = vscode.workspace.workspaceFolders;
		return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
	}

	/** SyncTeX data file path derived from the PDF path. */
	private getSynctexPath(pdfPath: string): string {
		return pdfPath.replace(/\.pdf$/, ".synctex.gz");
	}

	/** Check whether the synctex CLI is reachable. */
	public async isSyncTexAvailable(): Promise<boolean> {
		const useDocker = this.isDocker;
		return new Promise((resolve) => {
			const cmd = useDocker
				? `docker run --rm ${this.config.dockerImage} synctex --version`
				: "synctex --version";

			child_process.exec(cmd, { timeout: 10000 }, (error) => {
				resolve(!error);
			});
		});
	}
}
