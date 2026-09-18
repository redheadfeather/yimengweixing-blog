import { fetchPosts, fetchTags, formatDate, tagPath } from './content-api';

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string) {
	const node = document.createElement(tag);
	node.textContent = value;
	if (className) node.className = className;
	return node;
}

function renderPost(post: Awaited<ReturnType<typeof fetchPosts>>['items'][number], index: number) {
	const article = document.createElement('article');
	article.append(text('span', '', 'slot'), text('div', `CARTRIDGE / ${String(index + 1).padStart(2, '0')}`, 'card-code'));
	const link = document.createElement('a');
	link.className = 'card-main'; link.href = `/blog/${encodeURIComponent(post.slug)}/`;
	link.append(text('h3', post.title), text('p', post.description));
	const foot = document.createElement('div'); foot.className = 'card-foot';
	foot.append(text('span', formatDate(post.publishedAt)), text('span', post.tags.slice(0, 2).join(' / ')));
	article.append(link, foot); return article;
}

async function boot() {
	const grid = document.querySelector<HTMLElement>('#home-posts');
	const tagsNode = document.querySelector<HTMLElement>('#home-tags');
	const count = document.querySelector<HTMLElement>('#archive-count');
	if (!grid || !tagsNode || !count) return;
	try {
		const [featured, recent, tags] = await Promise.all([fetchPosts({ featured: true, limit: 3 }), fetchPosts({ limit: 3 }), fetchTags()]);
		const posts = featured.items.length ? featured.items : recent.items;
		grid.replaceChildren(...posts.map(renderPost));
		count.textContent = `${recent.total} 枚数据卡带`;
		const links = tags.slice(0, 12).map((tag, index) => {
			const link = document.createElement('a'); link.href = tagPath(tag.slug); link.style.setProperty('--delay', `${index * 35}ms`);
			link.append(document.createTextNode(`#${tag.name}`), text('span', '↗')); return link;
		});
		tagsNode.replaceChildren(...links);
	} catch {
		grid.replaceChildren(text('p', '档案信号暂时中断，请稍后重试。', 'load-error'));
		count.textContent = '连接中断';
	}
}

void boot();
