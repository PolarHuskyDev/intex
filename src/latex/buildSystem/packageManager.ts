import * as vscode from "vscode";
import { Logger } from "../../utils/Logger";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface MissingPackage {
	name: string;
	context: string; // Line from log where package was mentioned
}

export class PackageManager {
	private logger = Logger.instance;

	constructor() {}

	/**
	 * Parse LaTeX log output to detect missing packages
	 */
	detectMissingPackages(logOutput: string): MissingPackage[] {
		const packages: MissingPackage[] = [];
		const lines = logOutput.split("\n");

		// Common patterns for missing packages
		const patterns = [
			/LaTeX Error: File `(.+?)\.sty' not found/i,
			/! LaTeX Error: File `(.+?)\.cls' not found/i,
			/Package .+ Error: File `(.+?)' not found/i,
			/! I can't find file `(.+?)'/i,
			/File `(.+?)' not found/i,
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			for (const pattern of patterns) {
				const match = line.match(pattern);
				if (match) {
					const fileName = match[1];
					// Extract package name (remove extension)
					const packageName = fileName.replace(/\.(sty|cls)$/, "");

					packages.push({
						name: packageName,
						context: line.trim(),
					});
					break;
				}
			}

			// Check for undefined control sequences that might indicate missing packages
			if (line.includes("Undefined control sequence")) {
				// Look for the command in the next few lines
				for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
					const cmdMatch = lines[j].match(/\\([a-zA-Z]+)/);
					if (cmdMatch) {
						const command = cmdMatch[1];
						const suggestedPackage = this.suggestPackageForCommand(command);
						if (suggestedPackage) {
							packages.push({
								name: suggestedPackage,
								context: `Undefined command \\${command} (might need package: ${suggestedPackage})`,
							});
						}
						break;
					}
				}
			}
		}

		// Remove duplicates
		const unique = packages.filter(
			(pkg, index, self) =>
				index === self.findIndex((p) => p.name === pkg.name),
		);

		return unique;
	}

	/**
	 * Suggest package for a command
	 */
	private suggestPackageForCommand(command: string): string | null {
		const commandPackageMap: { [key: string]: string } = {
			// Math packages
			mathbb: "amsfonts",
			mathcal: "amsfonts",
			mathfrak: "amsfonts",
			boldsymbol: "amsmath",
			bm: "bm",
			text: "amsmath",

			// Graphics
			includegraphics: "graphicx",
			rotatebox: "graphicx",
			scalebox: "graphicx",

			// Colors
			textcolor: "xcolor",
			color: "color",
			definecolor: "xcolor",

			// Hyperlinks
			href: "hyperref",
			url: "url",
			hypersetup: "hyperref",

			// Lists
			setlist: "enumitem",
			newlist: "enumitem",

			// Tables
			multirow: "multirow",
			multicolumn: "multicol",
			toprule: "booktabs",
			midrule: "booktabs",
			bottomrule: "booktabs",

			// Bibliography
			cite: "cite",
			citep: "natbib",
			citet: "natbib",
			autocite: "biblatex",

			// Misc
			SI: "siunitx",
			num: "siunitx",
			unit: "siunitx",
		};

		return commandPackageMap[command] || null;
	}

	/**
	 * Check if tlmgr is available (for local installations)
	 */
	async isTlmgrAvailable(): Promise<boolean> {
		try {
			await execAsync("tlmgr --version");
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Install a package using tlmgr
	 */
	async installPackage(packageName: string): Promise<boolean> {
		try {
			this.logger.info(`Installing package: ${packageName}`);

			// Check if running with sudo is needed
			try {
				await execAsync(`tlmgr install ${packageName}`);
			} catch (error: any) {
				// If permission denied, try with sudo
				if (
					error.message.includes("permission") ||
					error.message.includes("root")
				) {
					this.logger.info("Permission denied, trying with sudo...");
					await execAsync(`sudo tlmgr install ${packageName}`);
				} else {
					throw error;
				}
			}

			this.logger.info(`Package ${packageName} installed successfully`);
			return true;
		} catch (error: any) {
			this.logger.error(
				`Failed to install package ${packageName}: ${error.message}`,
			);
			return false;
		}
	}

	/**
	 * Install multiple packages
	 */
	async installPackages(
		packageNames: string[],
	): Promise<{ [key: string]: boolean }> {
		const results: { [key: string]: boolean } = {};

		for (const pkg of packageNames) {
			results[pkg] = await this.installPackage(pkg);
		}

		return results;
	}

	/**
	 * Show quick fix for missing packages
	 */
	async offerPackageInstallation(packages: MissingPackage[]): Promise<void> {
		if (packages.length === 0) {
			return;
		}

		const tlmgrAvailable = await this.isTlmgrAvailable();

		if (packages.length === 1) {
			const pkg = packages[0];
			const message = `Missing LaTeX package: ${pkg.name}`;

			if (tlmgrAvailable) {
				const action = await vscode.window.showErrorMessage(
					message,
					"Install Package",
					"Ignore",
				);

				if (action === "Install Package") {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Installing ${pkg.name}...`,
							cancellable: false,
						},
						async () => {
							await this.installPackage(pkg.name);
						},
					);
				}
			} else {
				vscode.window.showErrorMessage(
					`${message}. Install it manually using your TeX distribution's package manager.`,
				);
			}
		} else {
			const packageList = packages.map((p) => p.name).join(", ");
			const message = `Missing LaTeX packages: ${packageList}`;

			if (tlmgrAvailable) {
				const action = await vscode.window.showErrorMessage(
					message,
					"Install All",
					"Ignore",
				);

				if (action === "Install All") {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: "Installing packages...",
							cancellable: false,
						},
						async (progress) => {
							for (let i = 0; i < packages.length; i++) {
								const pkg = packages[i];
								progress.report({
									message: `${pkg.name} (${i + 1}/${packages.length})`,
									increment: 100 / packages.length,
								});
								await this.installPackage(pkg.name);
							}
						},
					);
				}
			} else {
				vscode.window.showErrorMessage(
					`${message}. Install them manually using your TeX distribution's package manager.`,
				);
			}
		}
	}

	/**
	 * Get package documentation URL
	 */
	getPackageDocumentationUrl(packageName: string): string {
		return `https://ctan.org/pkg/${packageName}`;
	}

	/**
	 * Search for package on CTAN
	 */
	async openPackageDocumentation(packageName: string): Promise<void> {
		const url = this.getPackageDocumentationUrl(packageName);
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}
}
