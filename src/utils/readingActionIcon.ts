/** Draw the compact book-and-arrow action used for returning to a reading location. */
export function setOriginalReadingIcon(element: HTMLElement): void {
	const namespace = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(namespace, 'svg');
	svg.classList.add('svg-icon');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.7');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('data-weread-icon', 'book-arrow-up-right');
	for (const d of [
		'M12 7v14M12 7C9 5 6 5 3 6v13c3-1 6-1 9 2 3-3 6-3 9-2v-6',
		'M16 3h5v5M21 3l-6 6'
	]) {
		const path = document.createElementNS(namespace, 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	element.replaceChildren(svg);
}
