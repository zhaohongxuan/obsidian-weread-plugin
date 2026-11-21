import * as obsidian from 'obsidian';

/**
 * Attach a tooltip to an element while preserving compatibility with the
 * plugin's minimum supported Obsidian version.
 *
 * The global `setTooltip()` helper was only added in Obsidian 1.4.4, while this
 * plugin supports 1.1.9. On older versions we fall back to native `title` /
 * `aria-label` attributes so the hint is still available.
 *
 * The helper is resolved dynamically so this module keeps working in the
 * headless test harness, whose Obsidian fixture only stubs a subset of exports.
 */
export function applyTooltip(el: HTMLElement, tooltip: string): void {
	const setTooltip = (obsidian as { setTooltip?: (el: HTMLElement, tooltip: string) => void })
		.setTooltip;
	if (typeof setTooltip === 'function') {
		setTooltip(el, tooltip);
		return;
	}
	el.setAttribute('aria-label', tooltip);
	el.setAttribute('title', tooltip);
}
