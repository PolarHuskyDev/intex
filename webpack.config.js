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
			],
		}),
	],

};

module.exports = config;
