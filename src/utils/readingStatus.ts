export const hasPositiveReadingTime = (value?: string | number | null): boolean => {
	if (value === undefined || value === null) {
		return false;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) && value > 0;
	}

	const trimmedValue = value.trim();
	if (trimmedValue === '') {
		return false;
	}

	const numericValue = Number(trimmedValue);
	if (!Number.isNaN(numericValue)) {
		return numericValue > 0;
	}

	return trimmedValue.match(/\d+(?:\.\d+)?/g)?.some((match) => Number(match) > 0) ?? false;
};

export const hasFinishedDate = (value?: string | number | null): boolean => {
	if (value === undefined || value === null) {
		return false;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) && value > 0;
	}
	return value.trim() !== '';
};
