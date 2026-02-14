/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

/** @type {import('webpack').Configuration} */
const config = {
	mode: "production",
	target: "node",
	entry: "./src/extension.ts",
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: "extension.js",
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	},
	devtool: "source-map",
	externals: {
		vscode: "commonjs vscode",
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: "ts-loader",
					},
				],
			},
		],
	},
	plugins: [
		new CopyPlugin({
			patterns: [
				{
					from: "src/latex/pdf/viewer/*.{css,js}",
					to: "pdf_viewer/[name][ext]",
				},
				{
					from: "node_modules/pdfjs-dist/build/pdf.min.mjs",
					to: "pdf_viewer/pdfjs/pdf.min.mjs",
				},
				{
					from: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
					to: "pdf_viewer/pdfjs/pdf.worker.min.mjs",
				},
				// Equation editor assets
				{
					from: "src/editors/equation/editor/*.{css,js}",
					to: "equation_editor/[name][ext]",
				},
				// Table editor assets
				{
					from: "src/editors/tables/editor/*.{css,js}",
					to: "table_editor/[name][ext]",
				},
				// Figure editor assets
				{
					from: "src/editors/figures/editor/*.{css,js}",
					to: "figure_editor/[name][ext]",
				},
				// BibTeX editor assets
				{
					from: "src/editors/bibtex/editor/*.{css,js}",
					to: "bibtex_editor/[name][ext]",
				},
				// KaTeX CSS + JS + fonts for equation editor
				{
					from: "node_modules/katex/dist/katex.min.css",
					to: "equation_editor/katex/katex.min.css",
				},
				{
					from: "node_modules/katex/dist/katex.min.js",
					to: "equation_editor/katex/katex.min.js",
				},
				{
					from: "node_modules/katex/dist/fonts/",
					to: "equation_editor/katex/fonts/",
				},
			],
		}),
	],

};

module.exports = config;
