import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { Config } from "../../utils/Config";
import { Logger } from "../../utils/Logger";
import { IBuilder, BuildResult, BuildError } from "./builder";
import { ErrorParser } from "./errorParser";

const execAsync = promisify(exec);

export class LocalBuilder implements IBuilder {
	private errorParser: ErrorParser;
	private config = Config.instance;
	private logger = Logger.instance;

	constructor() {
		this.errorParser = new ErrorParser();
	}

	getName(): string {
		return "Local TeX Live";
	}

	async isAvailable(): Promise<boolean> {
		try {
			const engine = this.config.buildEngine;
			await execAsync(`${engine} --version`);
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

		this.logger.info(`Building with local ${engine}: ${docPath}`);

		try {
			let command: string;
			const cwd = docDir;

			if (engine === "latexmk") {
				const options = this.config.latexmkOptions.join(" ");
				command = `latexmk ${options} -output-directory=. "${docName}.tex"`;
			} else {
				// Direct engine call
				command = `${engine} -interaction=nonstopmode -synctex=1 -file-line-error "${docName}.tex"`;
			}

			this.logger.info(`Executing: ${command}`);
			this.logger.info(`Working directory: ${cwd}`);

			const { stdout, stderr } = await execAsync(command, {
				cwd,
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			});

			const output = stdout + stderr;
			this.logger.info("Build output:");
			this.logger.info(output);

			// Check if PDF was created
			const pdfPath = path.join(docDir, `${docName}.pdf`);
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
			const pdfPath = path.join(docDir, `${docName}.pdf`);
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
			const filePath = path.join(docDir, docName + ext);
			try {
				await fs.unlink(filePath);
				this.logger.info(`Deleted ${filePath}`);
			} catch {
				// File doesn't exist, ignore
			}
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
