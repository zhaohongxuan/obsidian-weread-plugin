const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const sveltePreprocess = require('svelte-preprocess');

const isDevMode = process.env.NODE_ENV === 'development';

module.exports = {
	entry: './main.ts',
	output: {
		path: path.resolve(__dirname, './dist'),
		filename: 'main.js',
		libraryTarget: 'commonjs'
	},
	target: 'node',
	mode: isDevMode ? 'development' : 'production',
	...(isDevMode ? { devtool: 'eval' } : {}),
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				loader: 'ts-loader',
				options: {
					transpileOnly: true
				}
			},
			{
				test: /\.(svelte)$/,
				use: [
					{ loader: 'babel-loader' },
					{
						loader: 'svelte-loader',
						options: {
							preprocess: sveltePreprocess({})
						}
					}
				]
			},
			{
				test: /\.(svg|njk|html)$/,
				type: 'asset/source'
			},
			{
				test: /\.css$/,
				use: ['style-loader', 'css-loader']
			}
		]
	},
	plugins: [
		new CopyPlugin({
			patterns: [
				{ from: './manifest.json', to: '.' },
				{ from: './style.css', to: '.' }
			]
		})
	],
	resolve: {
		alias: {
			svelte: path.resolve('node_modules', 'svelte'),
			'~': path.resolve(__dirname, 'src')
		},
		extensions: ['.ts', '.tsx', '.js', '.svelte'],
		mainFields: ['svelte', 'browser', 'module', 'main']
	},
	externals: {
		electron: 'commonjs2 electron',
		obsidian: 'commonjs2 obsidian'
	}
};
