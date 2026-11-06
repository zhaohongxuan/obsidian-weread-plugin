export interface ReadingDay {
	date: Date;
	seconds: number;
}

export interface DailyReadingInsights {
	days: ReadingDay[];
	hasData: boolean;
	activeDays: number;
	elapsedDays: number;
	longestStreak: number;
	peakDay: ReadingDay | null;
}

/** Daily API buckets only; local calendar steps keep DST transitions within the same day. */
export function getDailyReadingInsights(
	readTimes: Record<string, number> | undefined,
	mode: 'weekly' | 'monthly',
	baseTime: number,
	today = new Date()
): DailyReadingInsights {
	const start = new Date(baseTime * 1000);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	if (mode === 'weekly') end.setDate(end.getDate() + 7);
	else end.setMonth(end.getMonth() + 1, 1);
	const cutoff = new Date(today);
	cutoff.setHours(0, 0, 0, 0);
	const result: DailyReadingInsights = {
		days: [], hasData: false, activeDays: 0, elapsedDays: 0, longestStreak: 0, peakDay: null
	};
	if (!Number.isFinite(start.getTime()) || !Number.isFinite(cutoff.getTime())) return result;
	const totals = new Map<number, number>();
	for (const [timestamp, seconds] of Object.entries(readTimes ?? {})) {
		if (!timestamp.trim() || !Number.isFinite(Number(timestamp)) ||
			!Number.isFinite(seconds) || seconds < 0) continue;
		const date = new Date(Number(timestamp) * 1000);
		if (!Number.isFinite(date.getTime())) continue;
		date.setHours(0, 0, 0, 0);
		if (date < start || date >= end || date > cutoff) continue;
		const sum = (totals.get(date.getTime()) ?? 0) + seconds;
		if (!Number.isFinite(sum)) continue;
		totals.set(date.getTime(), sum);
		result.hasData = true;
	}
	let streak = 0;
	for (const date = new Date(start); date < end && date <= cutoff; date.setDate(date.getDate() + 1)) {
		const day = { date: new Date(date), seconds: totals.get(date.getTime()) ?? 0 };
		result.days.push(day);
		if (day.seconds > 0) {
			result.activeDays++;
			streak++;
			result.longestStreak = Math.max(result.longestStreak, streak);
			if (!result.peakDay || day.seconds > result.peakDay.seconds) result.peakDay = day;
		} else streak = 0;
	}
	result.elapsedDays = result.days.length;
	return result;
}

export function niceTickLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '0';
	const mins = Math.round(seconds / 60);
	if (mins < 60) return `${mins}分钟`;
	const hours = Math.floor(mins / 60);
	const remainder = mins % 60;
	return remainder === 0 ? `${hours}小时` : `${hours}小时${remainder}分`;
}
