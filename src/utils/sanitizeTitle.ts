import sanitize from 'sanitize-filename';

export const sanitizeTitle = (title: string): string => {
	const santizedTitle = title.replace(/[':#|]/g, '').trim();
	return sanitize(santizedTitle);
};
