import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as child_process from "child_process";
import AdmZip = require("adm-zip");
import { TexlabManager } from "./texlabManager";
import { Logger } from "../../utils/logger";

export class TexlabInstaller {
	private manager: TexlabManager;
	private logger = Logger.instance;

	constructor(
		context: vscode.ExtensionContext
	) {
		this.manager = new TexlabManager(context);
	}

	public async isInstalled(): Promise<boolean> {
		return this.manager.isInstalled();
	}

	public async getInstalledVersion(): Promise<string | null> {
		return this.manager.getInstalledVersion();
	}

	/**
	 * Get the latest texlab version from GitHub
	 */
	private async getLatestVersion(): Promise<string | null> {
		return new Promise((resolve) => {
			https
				.get(
					"https://api.github.com/repos/latex-lsp/texlab/releases/latest",
					{
						headers: { "User-Agent": "InTeX-VSCode-Extension" },
					},
					(res) => {
						let data = "";
						res.on("data", (chunk) => (data += chunk));
						res.on("end", () => {
							try {
								const json = JSON.parse(data);
								const version = json.tag_name?.replace(/^v/, "");
								resolve(version);
							} catch {
								resolve(null);
							}
						});
					},
				)
				.on("error", () => resolve(null));
		});
	}

	/**
	 * Download and install texlab
	 */
	public async installOrUpdate(): Promise<boolean> {
		try {
			return await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Installing texlab LSP server",
					cancellable: false,
				},
				async (progress) => {
					progress.report({ message: "Checking latest version..." });

					const latestVersion = await this.getLatestVersion();
					if (!latestVersion) {
						throw new Error("Could not determine latest texlab version");
					}

					progress.report({
						message: `Downloading texlab v${latestVersion}...`,
					});

					// Ensure global storage directory exists
					const installDir = this.manager.getGlobalStoragePath();
					if (!fs.existsSync(installDir)) {
						fs.mkdirSync(installDir, { recursive: true });
					}

					// Determine platform-specific download URL
					const platform = process.platform as string;
					let downloadUrl: string;
					const isWindows = platform === "win32";

					if (platform === "linux") {
						downloadUrl = `https://github.com/latex-lsp/texlab/releases/latest/download/texlab-x86_64-linux.tar.gz`;
					} else if (platform === "darwin") {
						downloadUrl = `https://github.com/latex-lsp/texlab/releases/latest/download/texlab-x86_64-macos.tar.gz`;
					} else if (isWindows) {
						downloadUrl = `https://github.com/latex-lsp/texlab/releases/latest/download/texlab-x86_64-windows.zip`;
					} else {
						throw new Error(`Unsupported platform: ${platform}`);
					}

					// Download to temp location
					const tempFile = path.join(
						installDir,
						isWindows ? "texlab_download.zip" : "texlab_download.tar.gz",
					);

					// Clean up previous temp file if exists
					if (fs.existsSync(tempFile)) {
						fs.unlinkSync(tempFile);
					}

					await this.downloadFile(downloadUrl, tempFile);

					progress.report({ message: "Extracting..." });

					// Extract based on platform
					if (isWindows) {
						try {
							const zip = new AdmZip(tempFile);
							zip.extractAllTo(installDir, true);
						} catch (e) {
							throw new Error(`Failed to extract zip file: ${e}`);
						}
					} else {
						// Unix-like systems: extract tar.gz
						await this.extractTarGz(tempFile, installDir);
					}

					// Clean up temp file
					if (fs.existsSync(tempFile)) {
						fs.unlinkSync(tempFile);
					}

					// Make executable (Unix-like only)
					if (!isWindows) {
						const binaryPath = this.manager.getDownloadTarget();
						if (fs.existsSync(binaryPath)) {
							fs.chmodSync(binaryPath, 0o755);
						}
					}

					this.logger?.info(`texlab installed successfully to: ${installDir}`);
					progress.report({ message: "Installation complete!" });
					return true;
				},
			);
		} catch (error) {
			const errorMessage = `Failed to install texlab: ${error instanceof Error ? error.message : String(error)}`;
			this.logger?.error(errorMessage);
			vscode.window.showErrorMessage(errorMessage);
			return false;
		}
	}

	/**
	 * Download a file from a URL
	 */
	private downloadFile(url: string, destination: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const file = fs.createWriteStream(destination);

			https
				.get(
					url,
					{
						headers: { "User-Agent": "InTeX-VSCode-Extension" },
					},
					(response) => {
						// Follow redirects
						if (response.statusCode === 301 || response.statusCode === 302) {
							const redirectUrl = response.headers.location;
							if (redirectUrl) {
								file.close();
								fs.unlinkSync(destination);
								return this.downloadFile(redirectUrl, destination)
									.then(resolve)
									.catch(reject);
							}
						}

						if (response.statusCode !== 200) {
							reject(
								new Error(`Download failed with status ${response.statusCode}`),
							);
							return;
						}

						response.pipe(file);

						file.on("finish", () => {
							file.close();
							resolve();
						});
					},
				)
				.on("error", (err) => {
					fs.unlinkSync(destination);
					reject(err);
				});

			file.on("error", (err) => {
				// Ensure file is closed and removed on error
				file.close();
				if (fs.existsSync(destination)) {
					fs.unlinkSync(destination);
				}
				reject(err);
			});
		});
	}

	/**
	 * Extract a tar.gz file
	 */
	private extractTarGz(tarPath: string, destDir: string): Promise<void> {
		return new Promise((resolve, reject) => {
			child_process.exec(`tar -xzf "${tarPath}" -C "${destDir}"`, (error) => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
	}

	/**
	 * Prompt user to install texlab if not already installed
	 */
	public async promptInstallIfNeeded(): Promise<void> {
		try {
			if (await this.isInstalled()) {
				return;
			}

			const config = vscode.workspace.getConfiguration("intex");
			const lspEnabled = config.get<boolean>("lsp.enabled", true);

			if (!lspEnabled) {
				return; // User has disabled LSP
			}

			const choice = await vscode.window.showInformationMessage(
				"InTeX: texlab LSP server is not installed. Would you like to download it for enhanced editing features?",
				"Install",
				"Not Now",
				"Don't Ask Again",
			);

			if (choice === "Install") {
				const success = await this.installOrUpdate();
				if (success) {
					vscode.window
						.showInformationMessage(
							"texlab installed successfully! Please reload the window to activate LSP features.",
							"Reload Window",
						)
						.then((action) => {
							if (action === "Reload Window") {
								vscode.commands.executeCommand("workbench.action.reloadWindow");
							}
						});
				}
			} else if (choice === "Don't Ask Again") {
				await config.update(
					"lsp.enabled",
					false,
					vscode.ConfigurationTarget.Global,
				);
			}
		} catch (error) {
			this.logger?.error(`Error in install prompt: ${error}`);
		}
	}
}
