import * as vscode from "vscode";
import * as path from "path";
import { Config } from "../../utils/Config";
import { Logger } from "../../utils/Logger";
import { EnvironmentDetector } from "./detector";
import { LocalBuilder } from "./localBuilder";
import { DockerBuilder } from "./dockerBuilder";
import { PDFViewer } from "../pdf/PDFViewer";


export interface IBuilder {
	build(documentUri: vscode.Uri): Promise<BuildResult>;
	clean(documentUri: vscode.Uri): Promise<void>;
	isAvailable(): Promise<boolean>;
	getName(): string;
}

export interface BuildResult {
	success: boolean;
	output: string;
	errors: BuildError[];
	pdfPath?: string;
}

export interface BuildError {
	file: string;
	line: number;
	message: string;
	severity: "error" | "warning";
}

export class BuildSystem {
	private builder: IBuilder | null = null;
	private detector: EnvironmentDetector;
	private config = Config.instance;
	private logger = Logger.instance;
	private isBuilding = false;
	private diagnosticsCollection: vscode.DiagnosticCollection;

	constructor(private context: vscode.ExtensionContext) {
		this.detector = new EnvironmentDetector();
		this.diagnosticsCollection = vscode.languages.createDiagnosticCollection("latex");
		this.context.subscriptions.push(this.diagnosticsCollection);
	}

	registerCommands() {
		// Build command
		this.context.subscriptions.push(
			vscode.commands.registerCommand('intex.build', async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document.languageId !== 'latex') {
					vscode.window.showWarningMessage('No active LaTeX document');
					return;
				}
				
				await this.buildWithFeedback(editor.document.uri);
			})
		);

		// Clean command
		this.context.subscriptions.push(
			vscode.commands.registerCommand('intex.clean', async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document.languageId !== 'latex') {
					vscode.window.showWarningMessage('No active LaTeX document');
					return;
				}
				
				await this.cleanWithFeedback(editor.document.uri);
			})
		);

		// Document save listener for build-on-save
		this.context.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(async (document) => {
				if (
					document.languageId === 'latex' &&
					this.config.buildOnSave &&
					!this.isBuilding
				) {
					await this.buildWithFeedback(document.uri, true);
				}
			})
		);
	}

	private async buildWithFeedback(
		documentUri: vscode.Uri,
		isSaveTriggered = false
	): Promise<void> {
		if (this.isBuilding) {
			this.logger.warn("Build already in progress");
			return;
		}

		this.isBuilding = true;

		try {
			const result = await this.build(documentUri);
			
			// Publish diagnostics
			this.publishDiagnostics(documentUri, result.errors);
			
			if (result.success) {
				if (!isSaveTriggered) {
					vscode.window.showInformationMessage("✓ Build successful!");
				}
				this.logger.info("Build completed successfully");
				
				// Show PDF: reload existing viewer or open a new one
				if (result.pdfPath) {
					const pdfUri = vscode.Uri.file(result.pdfPath);
					if (PDFViewer.isOpen(pdfUri)) {
						await PDFViewer.reload(pdfUri);
					} else {
						await PDFViewer.open(pdfUri);
					}
				}
			} else {
				const errorCount = result.errors.filter((e) => e.severity === "error").length;
				const warningCount = result.errors.filter((e) => e.severity === "warning").length;
				const message = `✗ Build failed: ${errorCount} errors, ${warningCount} warnings`;
				vscode.window.showErrorMessage(message);
				this.logger.error(`Build failed: ${message}`);
			}

			// Show output channel based on configuration
			if (
				this.config.showOutputChannel === "always" ||
				(this.config.showOutputChannel === "onError" && !result.success)
			) {
				this.logger.show();
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Build error: ${error}`);
			this.logger.error(`Build error: ${error}`);
		} finally {
			this.isBuilding = false;
		}
	}

	private publishDiagnostics(
		documentUri: vscode.Uri,
		errors: BuildError[]
	): void {
		const diagnostics: vscode.Diagnostic[] = [];
		const docDir = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath || "";

		// Group diagnostics by file
		const groupedByFile = new Map<string, vscode.Diagnostic[]>();

		for (const error of errors) {
			const range = new vscode.Range(
				new vscode.Position(Math.max(0, error.line - 1), 0),
				new vscode.Position(Math.max(0, error.line - 1), 999)
			);

			const severity =
				error.severity === "error"
					? vscode.DiagnosticSeverity.Error
					: vscode.DiagnosticSeverity.Warning;

			const diagnostic = new vscode.Diagnostic(
				range,
				error.message,
				severity
			);
			diagnostic.source = "LaTeX";

			const file = error.file;
			if (!groupedByFile.has(file)) {
				groupedByFile.set(file, []);
			}
			groupedByFile.get(file)!.push(diagnostic);
		}

		// Clear previous diagnostics and publish new ones
		this.diagnosticsCollection.clear();
		for (const [file, diags] of groupedByFile) {
			try {
				const fileUri = vscode.Uri.file(`${docDir}/${file}`);
				this.diagnosticsCollection.set(fileUri, diags);
			} catch (error) {
				this.logger.warn(`Failed to publish diagnostics for ${file}: ${error}`);
			}
		}
	}

	private async cleanWithFeedback(documentUri: vscode.Uri): Promise<void> {
		try {
			await this.clean(documentUri);
			vscode.window.showInformationMessage("✓ Auxiliary files cleaned");
			this.logger.info("Clean completed successfully");
		} catch (error) {
			vscode.window.showErrorMessage(`Clean error: ${error}`);
			this.logger.error(`Clean error: ${error}`);
		}
	}

	async activate(): Promise<void> {
		try {
			await this.initialize();
			this.registerCommands();
		} catch (error) {
			this.logger.error(`Failed to initialize build system: ${error}`);
			vscode.window.showErrorMessage(`InTeX: Failed to initialize build system. ${error}`);
		}
	}
	
	async deactivate(): Promise<void> {
		this.logger.info("Build system deactivating...");
		this.builder = null;
	}

	async initialize(): Promise<void> {
		const buildMethod = this.config.buildMethod;
		this.logger.info(`Initializing build system with method: ${buildMethod}`);

		// Handle explicit build method selection
		if (buildMethod === "local") {
			this.builder = new LocalBuilder();
			await this.validateBuilder();
			return;
		}

		if (buildMethod === "docker") {
			this.builder = new DockerBuilder();
			await this.validateBuilder();
			return;
		}

		// Auto-detect build environment
		const hasLocal = await this.detector.hasLocalTexLive();
		if (hasLocal) {
			this.logger.info("Local TeX Live detected, using local builder");
			this.builder = new LocalBuilder();
			await this.validateBuilder();
			return;
		}

		const hasDocker = await this.detector.hasDocker();
		if (hasDocker) {
			this.logger.info("Docker detected, using Docker builder");
			this.builder = new DockerBuilder();
			await this.validateBuilder();
			return;
		}

		// No LaTeX environment found
		this.logger.error("No LaTeX environment found!");
		vscode.window.showErrorMessage(
			"No LaTeX environment detected. Please install TeX Live or Docker.",
		);
	}

	private async validateBuilder(): Promise<void> {
		if (!this.builder) {
			return;
		}

		const available = await this.builder.isAvailable();
		if (!available) {
			this.logger.warn(
				`Selected builder ${this.builder.getName()} is not available`,
			);
			vscode.window.showWarningMessage(
				`Selected build method (${this.builder.getName()}) is not available`,
			);
			return;
		}

		this.logger.info("Build system initialized successfully");
	}

	async build(documentUri: vscode.Uri): Promise<BuildResult> {
		if (!this.builder) {
			throw new Error("Build system not initialized");
		}

		return await this.builder.build(documentUri);
	}

	async clean(documentUri: vscode.Uri): Promise<void> {
		if (!this.builder) {
			throw new Error("Build system not initialized");
		}

		await this.builder.clean(documentUri);
	}

	async getEnvironmentInfo(): Promise<string> {
		const hasLocal = await this.detector.hasLocalTexLive();
		const hasDocker = await this.detector.hasDocker();
		const localVersion = hasLocal
			? await this.detector.getTexLiveVersion()
			: "N/A";
		const dockerVersion = hasDocker
			? await this.detector.getDockerVersion()
			: "N/A";

		const currentBuilder = this.builder ? this.builder.getName() : "None";

		return [
			`Current Builder: ${currentBuilder}`,
			`Local TeX Live: ${hasLocal ? "Yes" : "No"} (${localVersion})`,
			`Docker: ${hasDocker ? "Yes" : "No"} (${dockerVersion})`,
		].join("\n");
	}
}
