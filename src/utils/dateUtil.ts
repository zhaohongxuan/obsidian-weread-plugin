export const formatTimeDuration = (duration: number): string => {
	const hours = Math.floor(duration / 60);
	const minutes = duration % 60;

	const formattedDuration = `${hours}小时${minutes}分钟`;

	return formattedDuration;
};

export const formatTimestampToDate = (readingBookDate: number): string => {
	return window.moment(readingBookDate * 1000).format('YYYY-MM-DD');
};
