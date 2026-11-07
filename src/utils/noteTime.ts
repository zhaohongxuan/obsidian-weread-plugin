/** Note creation timestamps are milliseconds; keep the local calendar date and minute precision. */
const noteTimestampFormat = new Intl.DateTimeFormat('zh-CN', {
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

export function formatNoteTimestamp(timestampMs: number): string {
	const date = new Date(timestampMs);
	return Number.isFinite(date.getTime()) ? noteTimestampFormat.format(date) : '';
}
