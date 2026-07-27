export function toTagSlug(tag: string) {
	return tag
		.normalize('NFKC')
		.trim()
		.toLocaleLowerCase('zh-CN')
		.replace(/\s+/g, '-')
		.replace(/[/?#%]+/g, '-');
}

export function getTagPath(tag: string) {
	return `/tags/${encodeURIComponent(toTagSlug(tag))}/`;
}
