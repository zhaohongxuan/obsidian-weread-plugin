// Minimal browser-global polyfills for tests that run production code in plain
// Node (no DOM). Obsidian exposes `window`/`activeDocument`/`createEl` etc. at
// runtime; production code now references them, so tests that exercise those
// code paths need stand-ins.
if (typeof globalThis.window === 'undefined') {
	globalThis.window = globalThis;
}
if (typeof globalThis.activeWindow === 'undefined') {
	globalThis.activeWindow = globalThis;
}
if (typeof globalThis.document === 'undefined') {
	// Only what the tested pure-data paths touch; not a full DOM.
	globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, append() {} }) };
}
if (typeof globalThis.activeDocument === 'undefined') {
	globalThis.activeDocument = globalThis.document;
}
if (typeof globalThis.createFragment === 'undefined') {
	globalThis.createFragment = () => ({ append() {} });
}
if (typeof globalThis.createEl === 'undefined') {
	globalThis.createEl = () => ({ style: {}, setAttribute() {}, append() {} });
}
