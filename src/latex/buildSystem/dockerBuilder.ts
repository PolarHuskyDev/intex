import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import { Config } from "../../utils/config";
import { Logger } from "../../utils/logger";
import { IBuilder, BuildResult, BuildError } from "./builder";
import { ErrorParser } from "./errorParser";

const execAsync = promisify(exec);

export class DockerBuilder implements IBuilder {
	private errorParser: ErrorParser;
	private volumeName = "intex-texlive-cache";
	private config = Config.instance;
	private logger = Logger.instance;

	constructor() {
		this.errorParser = new ErrorParser();
	}

	getName(): string {
		return "Docker (Containerized)";
	}

	async isAvailable(): Promise<boolean> {
		try {
			await execAsync("docker --version");
			return true;
		} catch {
			return false;
		}
	}

	async build(documentUri: vscode.Uri): Promise<BuildResult> {
		const docPath = documentUri.fsPath;
		const docDir = path.dirname(docPath);
		const docName = path.basename(docPath, ".tex");
		const engine = this.config.buildEngine;
		const dockerImage = this.config.dockerImage;
		const outputDir = await this.getOutputDirectory(docDir);

		this.logger.info(`Building with Docker (${dockerImage}): ${docPath}`);
		this.logger.info(`Output directory: ${outputDir}`);

		// Ensure cache volume exists if enabled
		if (this.config.dockerEnableCache) {
			await this.ensureCacheVolume();
		}

		try {
			let buildCommand: string;
			const outputDirInContainer = "/output";

			if (engine === "latexmk") {
				const options = this.config.latexmkOptions.join(" ");
				buildCommand = `latexmk ${options} -output-directory="${outputDirInContainer}" "${docName}.tex"`;
			} else {
				// Direct engine call - note: not all engines support -output-directory
				buildCommand = `${engine} -interaction=nonstopmode -synctex=1 -file-line-error "${docName}.tex"`;
			}

			// Build Docker command with volume mounts
			const volumeMounts = [
				`-v "${docDir}:/workspace"`,
				`-v "${outputDir}:${outputDirInContainer}"`,
				this.config.dockerEnableCache
					? `-v ${this.volumeName}:/usr/local/texlive`
					: "",
			]
				.filter(Boolean)
				.join(" ");

			// Get user ID mapping for Linux to ensure output files are owned by user
			const userIdString = await this.getUserIdString();
			const userIdPart = userIdString ? `${userIdString}` : "";

			const dockerCommand = `docker run --rm ${userIdPart} ${volumeMounts} -w /workspace ${dockerImage} ${buildCommand}`;

			this.logger.info(`Executing: ${dockerCommand}`);

			const { stdout, stderr } = await execAsync(dockerCommand, {
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			});

			const output = stdout + stderr;
			this.logger.info("Build output:");
			this.logger.info(output);

			// Check if PDF was created
			const pdfPath = path.join(outputDir, `${docName}.pdf`);
			const pdfExists = await this.fileExists(pdfPath);

			const errors = this.errorParser.parse(output);

			return {
				success:
					pdfExists &&
					errors.filter((e) => e.severity === "error").length === 0,
				output,
				errors,
				pdfPath: pdfExists ? pdfPath : undefined,
			};
		} catch (error: any) {
			// latexmk may return non-zero exit code even if PDF was generated
			// (e.g., undefined references, citations, or minor errors)
			this.logger.warn(
				`Build command returned non-zero exit code: ${error.message}`,
			);

			const output =
				(error.stdout || "") + (error.stderr || "") + error.message;
			const errors = this.errorParser.parse(output);

			// Check if PDF was actually generated despite the error
			const pdfPath = path.join(outputDir, `${docName}.pdf`);
			const pdfExists = await this.fileExists(pdfPath);

			if (pdfExists) {
				this.logger.info("PDF was generated despite non-zero exit code");
				// Check if there are any fatal errors (not just warnings)
				const fatalErrors = errors.filter(
					(e) => e.severity === "error" && !this.isNonFatalError(e.message),
				);

				return {
					success: fatalErrors.length === 0,
					output,
					errors,
					pdfPath,
				};
			}

			this.logger.error("Build failed and no PDF was generated");
			return {
				success: false,
				output,
				errors,
			};
		}
	}

	async clean(documentUri: vscode.Uri): Promise<void> {
		const docPath = documentUri.fsPath;
		const docDir = path.dirname(docPath);
		const docName = path.basename(docPath, ".tex");
		const outputDir = await this.getOutputDirectory(docDir);

		const extensions = [
			".aux",
			".log",
			".out",
			".toc",
			".lof",
			".lot",
			".fls",
			".fdb_latexmk",
			".synctex.gz",
			".bbl",
			".blg",
			".nav",
			".snm",
			".vrb",
			".bcf",
			".run.xml",
		];

		this.logger.info(`Cleaning auxiliary files for ${docName}`);

		for (const ext of extensions) {
			const filePath = path.join(outputDir, docName + ext);
			try {
				await fs.unlink(filePath);
				this.logger.info(`Deleted ${filePath}`);
			} catch {
				// File doesn't exist, ignore
			}
		}
	}

	private async getOutputDirectory(docDir: string): Promise<string> {
		const outputDir = this.config.outputDirectory;
		let resolvedDir: string;

		if (path.isAbsolute(outputDir)) {
			resolvedDir = outputDir;
		} else {
			// Resolve relative to workspace root or document directory
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(
				vscode.Uri.file(docDir)
			);
			const baseDir = workspaceFolder?.uri.fsPath || docDir;
			resolvedDir = path.resolve(baseDir, outputDir);
		}

		// Create directory if it doesn't exist
		try {
			await fs.mkdir(resolvedDir, { recursive: true });
		} catch (error) {
			this.logger.warn(`Failed to create output directory ${resolvedDir}: ${error}`);
		}

		return resolvedDir;
	}

	private async getUserIdString(): Promise<string> {
		// Check if user ID shifting is enabled in configuration
		if (!this.config.dockerUserShift) {
			return "";
		}

		// On Linux, get the actual user's UID and GID to ensure output files
		// are owned by the user instead of root
		if (os.platform() !== "linux") {
			return "";
		}

		try {
			const { stdout: uid } = await execAsync("id -u");
			const { stdout: gid } = await execAsync("id -g");
			const uidStr = uid.trim();
			const gidStr = gid.trim();

			if (uidStr && gidStr) {
				this.logger.info(`Using Docker user mapping: ${uidStr}:${gidStr}`);
				return `--user ${uidStr}:${gidStr}`;
			}
		} catch (error) {
			this.logger.warn(
				`Failed to get user ID for Docker mapping: ${error}`,
			);
		}

		return "";
	}

	private async ensureCacheVolume(): Promise<void> {
		try {
			// Check if volume exists
			const { stdout } = await execAsync(
				`docker volume ls -q -f name=${this.volumeName}`,
			);

			if (!stdout.trim()) {
				this.logger.info(`Creating Docker volume: ${this.volumeName}`);
				await execAsync(`docker volume create ${this.volumeName}`);
			}
		} catch (error) {
			this.logger.warn(`Failed to create cache volume: ${error}`);
		}
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if an error message represents a non-fatal error
	 * (e.g., undefined references, citations) that shouldn't prevent PDF display
	 */
	private isNonFatalError(message: string): boolean {
		const nonFatalPatterns = [
			/undefined references/i,
			/undefined citations/i,
			/label.*multiply defined/i,
			/reference.*undefined/i,
			/citation.*undefined/i,
			/there were undefined/i,
			/rerun to get/i,
			/label\(s\) may have changed/i,
		];

		return nonFatalPatterns.some((pattern) => pattern.test(message));
	}
}
