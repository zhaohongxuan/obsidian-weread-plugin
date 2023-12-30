export const formatTimeDuration = (durationInSeconds: number): string => {
	const hours: number = Math.floor(durationInSeconds / 3600);
	const minutes: number = Math.floor((durationInSeconds % 3600) / 60);
	const formattedDuration = `${hours}小时${minutes}分钟`;

	return formattedDuration;
};

export const formatTimestampToDate = (readingBookDate: number): string => {
	return window.moment(readingBookDate * 1000).format('YYYY-MM-DD');
};