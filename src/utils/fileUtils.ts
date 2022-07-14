export const getLinesInString = (input: string) => {
	const lines: string[] = [];
	let tempString = input;

	while (tempString.contains('\n')) {
		const lineEndIndex = tempString.indexOf('\n');
		lines.push(tempString.slice(0, lineEndIndex));
		tempString = tempString.slice(lineEndIndex + 1);
	}

	lines.push(tempString);

	return lines;
};

export const escapeRegExp = (text) => {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};
