export const parseBookIdList = (value: string): Set<string> => {
	return new Set(
		value
			.split(/[,\n，]/)
			.map((item) => item.trim())
			.filter(Boolean)
	);
};
