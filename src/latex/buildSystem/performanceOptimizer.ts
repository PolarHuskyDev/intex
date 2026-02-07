import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { Logger } from "../../utils/Logger";

interface FileHash {
	path: string;
	hash: string;
	lastModified: number;
}

interface BuildCache {
	files: Map<string, FileHash>;
	dependencies: Map<string, string[]>;
	lastBuildTime: number;
}

/**
 * Performance optimization manager for incremental compilation
 */
export class PerformanceOptimizer {
	private cacheDir: string;
	private buildCaches: Map<string, BuildCache> = new Map();
	private logger = Logger.instance;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.cacheDir = path.join(context.globalStorageUri.fsPath, "build-cache");
		if (!fs.existsSync(this.cacheDir)) {
			fs.mkdirSync(this.cacheDir, { recursive: true });
		}
		this.loadCaches();
	}

	/**
	 * Check if incremental build is possible
	 */
	public canUseIncrementalBuild(mainFile: string): boolean {
		const cache = this.buildCaches.get(mainFile);
		if (!cache) {
			return false;
		}

		// Check if any dependencies have changed
		const changedFiles = this.getChangedFiles(mainFile);
		return changedFiles.length < 3; // Threshold for incremental build
	}

	/**
	 * Get list of files that have changed since last build
	 */
	public getChangedFiles(mainFile: string): string[] {
		const cache = this.buildCaches.get(mainFile);
		if (!cache) {
			return [mainFile];
		}

		const changedFiles: string[] = [];
		const dependencies = this.getDependencies(mainFile);

		for (const file of [mainFile, ...dependencies]) {
			if (!fs.existsSync(file)) {
				continue;
			}

			const currentHash = this.calculateFileHash(file);
			const cachedFile = cache.files.get(file);

			if (!cachedFile || cachedFile.hash !== currentHash) {
				changedFiles.push(file);
			}
		}

		return changedFiles;
	}

	/**
	 * Update build cache after successful compilation
	 */
	public updateCache(mainFile: string): void {
		const dependencies = this.getDependencies(mainFile);
		const files = new Map<string, FileHash>();

		for (const file of [mainFile, ...dependencies]) {
			if (!fs.existsSync(file)) {
				continue;
			}

			const stats = fs.statSync(file);
			files.set(file, {
				path: file,
				hash: this.calculateFileHash(file),
				lastModified: stats.mtimeMs,
			});
		}

		this.buildCaches.set(mainFile, {
			files,
			dependencies: new Map([[mainFile, dependencies]]),
			lastBuildTime: Date.now(),
		});

		this.saveCaches();
	}

	/**
	 * Get dependencies for a LaTeX file
	 */
	private getDependencies(mainFile: string): string[] {
		const dependencies: Set<string> = new Set();
		const baseDir = path.dirname(mainFile);

		try {
			this.collectDependencies(mainFile, baseDir, dependencies);
		} catch (error) {
			this.logger.error(`Error collecting dependencies: ${error}`);
		}

		return Array.from(dependencies);
	}

	/**
	 * Recursively collect file dependencies
	 */
	private collectDependencies(
		file: string,
		baseDir: string,
		dependencies: Set<string>,
	): void {
		if (!fs.existsSync(file)) {
			return;
		}

		const content = fs.readFileSync(file, "utf-8");
		const inputRegex = /\\input\{([^}]+)\}|\\include\{([^}]+)\}/g;
		const graphicsRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
		const bibRegex = /\\bibliography\{([^}]+)\}/g;

		// Find \input and \include
		let match;
		while ((match = inputRegex.exec(content)) !== null) {
			const includedFile = match[1] || match[2];
			let fullPath = path.resolve(baseDir, includedFile);

			// Add .tex extension if not present
			if (!fs.existsSync(fullPath) && !fullPath.endsWith(".tex")) {
				fullPath += ".tex";
			}

			if (fs.existsSync(fullPath) && !dependencies.has(fullPath)) {
				dependencies.add(fullPath);
				this.collectDependencies(
					fullPath,
					path.dirname(fullPath),
					dependencies,
				);
			}
		}

		// Find graphics
		while ((match = graphicsRegex.exec(content)) !== null) {
			const imagePath = match[1];
			const extensions = ["", ".png", ".jpg", ".jpeg", ".pdf", ".eps"];

			for (const ext of extensions) {
				const fullPath = path.resolve(baseDir, imagePath + ext);
				if (fs.existsSync(fullPath)) {
					dependencies.add(fullPath);
					break;
				}
			}
		}

		// Find bibliography files
		while ((match = bibRegex.exec(content)) !== null) {
			const bibFiles = match[1].split(",").map((f) => f.trim());
			for (const bibFile of bibFiles) {
				let fullPath = path.resolve(baseDir, bibFile);
				if (!fullPath.endsWith(".bib")) {
					fullPath += ".bib";
				}
				if (fs.existsSync(fullPath)) {
					dependencies.add(fullPath);
				}
			}
		}
	}

	/**
	 * Calculate hash of file content
	 */
	private calculateFileHash(file: string): string {
		const content = fs.readFileSync(file);
		return crypto.createHash("md5").update(content).digest("hex");
	}

	/**
	 * Determine if partial build is possible
	 */
	public canUsePartialBuild(mainFile: string): {
		canUse: boolean;
		targetFiles?: string[];
	} {
		const changedFiles = this.getChangedFiles(mainFile);

		if (changedFiles.length === 0) {
			return { canUse: false };
		}

		// Check if changes are isolated to specific chapters/sections
		const isolatedSections = this.findIsolatedSections(mainFile, changedFiles);

		if (isolatedSections.length > 0) {
			return {
				canUse: true,
				targetFiles: isolatedSections,
			};
		}

		return { canUse: false };
	}

	/**
	 * Find sections that can be built independently
	 */
	private findIsolatedSections(
		mainFile: string,
		changedFiles: string[],
	): string[] {
		// Simple heuristic: if only \include files changed (not \input)
		// and main file hasn't changed, those can be built partially

		if (changedFiles.includes(mainFile)) {
			return [];
		}

		const mainContent = fs.readFileSync(mainFile, "utf-8");
		const includedFiles: string[] = [];
		const includeRegex = /\\include\{([^}]+)\}/g;
		let match;

		while ((match = includeRegex.exec(mainContent)) !== null) {
			let includedFile = match[1];
			if (!includedFile.endsWith(".tex")) {
				includedFile += ".tex";
			}
			const fullPath = path.resolve(path.dirname(mainFile), includedFile);

			if (changedFiles.includes(fullPath)) {
				includedFiles.push(fullPath);
			}
		}

		return includedFiles;
	}

	/**
	 * Load caches from disk
	 */
	private loadCaches(): void {
		try {
			const cacheFile = path.join(this.cacheDir, "build-cache.json");
			if (fs.existsSync(cacheFile)) {
				const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));

				for (const [key, value] of Object.entries(data)) {
					const cache = value as any;
					this.buildCaches.set(key, {
						files: new Map(cache.files),
						dependencies: new Map(cache.dependencies),
						lastBuildTime: cache.lastBuildTime,
					});
				}
			}
		} catch (error) {
			this.logger.error(`Error loading build cache: ${error}`);
		}
	}

	/**
	 * Save caches to disk
	 */
	private saveCaches(): void {
		try {
			const cacheFile = path.join(this.cacheDir, "build-cache.json");
			const data: any = {};

			for (const [key, cache] of this.buildCaches) {
				data[key] = {
					files: Array.from(cache.files.entries()),
					dependencies: Array.from(cache.dependencies.entries()),
					lastBuildTime: cache.lastBuildTime,
				};
			}

			fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
		} catch (error) {
			this.logger.error(`Error saving build cache: ${error}`);
		}
	}

	/**
	 * Clear cache for a file
	 */
	public clearCache(mainFile: string): void {
		this.buildCaches.delete(mainFile);
		this.saveCaches();
	}

	/**
	 * Clear all caches
	 */
	public clearAllCaches(): void {
		this.buildCaches.clear();
		this.saveCaches();
		vscode.window.showInformationMessage("Build cache cleared");
	}

	/**
	 * Get cache statistics
	 */
	public getCacheStats(): { totalFiles: number; totalSize: number } {
		let totalFiles = 0;
		let totalSize = 0;

		for (const cache of this.buildCaches.values()) {
			totalFiles += cache.files.size;
		}

		try {
			const cacheFile = path.join(this.cacheDir, "build-cache.json");
			if (fs.existsSync(cacheFile)) {
				totalSize = fs.statSync(cacheFile).size;
			}
		} catch (error) {
			// Ignore
		}

		return { totalFiles, totalSize };
	}

	/**
	 * Register performance commands
	 */
	public registerCommands(): vscode.Disposable[] {
		return [
			vscode.commands.registerCommand("intex.clearBuildCache", () =>
				this.clearAllCaches(),
			),
			vscode.commands.registerCommand("intex.showCacheStats", () =>
				this.showCacheStats(),
			),
			vscode.commands.registerCommand("intex.toggleIncrementalBuild", () =>
				this.toggleIncrementalBuild(),
			),
		];
	}

	/**
	 * Show cache statistics
	 */
	private showCacheStats(): void {
		const stats = this.getCacheStats();
		const sizeKB = (stats.totalSize / 1024).toFixed(2);

		vscode.window.showInformationMessage(
			`Build Cache: ${this.buildCaches.size} document(s), ${stats.totalFiles} file(s), ${sizeKB} KB`,
		);
	}

	/**
	 * Toggle incremental build feature
	 */
	private async toggleIncrementalBuild(): Promise<void> {
		const config = vscode.workspace.getConfiguration("intex");
		const current = config.get("enableIncrementalBuild", true);
		await config.update(
			"enableIncrementalBuild",
			!current,
			vscode.ConfigurationTarget.Global,
		);

		if (!current) {
			vscode.window.showInformationMessage("Incremental build enabled");
		} else {
			vscode.window.showInformationMessage("Incremental build disabled");
		}
	}

	public dispose(): void {
		this.saveCaches();
	}
}
