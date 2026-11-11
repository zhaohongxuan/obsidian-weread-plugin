/** Share controls read the current visible content at click time and own no note storage. */
import { setIcon } from 'obsidian';
import type { QuoteShareContent } from '../quoteShareCard';

export interface QuoteShareButtonOptions {
	getContent: () => QuoteShareContent | undefined;
	onShare: (content: QuoteShareContent) => void;
	isActive: () => boolean;
	cls?: string;
}

export function createQuoteShareButton(
	parent: HTMLElement,
	options: QuoteShareButtonOptions
): HTMLButtonElement {
	const button = parent.createEl('button', {
		cls: `clickable-icon weread-share-button ${options.cls || ''}`.trim(),
		attr: { type: 'button', title: '分享卡片', 'aria-label': '分享卡片' }
	});
	setIcon(button, 'share-2');
	button.onclick = (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (!button.isConnected || !options.isActive()) return;
		const content = options.getContent();
		if (typeof content?.text !== 'string' || !content.text.trim()) return;
		options.onShare({ ...content });
	};
	return button;
}
