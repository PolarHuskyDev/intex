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
			{
				test: /\.wasm$/,
				type: "asset/resource",
				generator: {
					filename: "[name][ext]",
				},
			},
		],
	},
	plugins: [
		new CopyPlugin({
			patterns: [
				{
					from: "src/latex/pdf/viewer/pkg",
					to: "pdf_viewer",
				}
			],
		}),
	],
	experiments: {
		asyncWebAssembly: true,
	},
};

module.exports = config;
