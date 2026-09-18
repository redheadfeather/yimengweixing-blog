import { fetchPosts, fetchTags, formatDate, tagPath } from './content-api';

const tagSlug = decodeURIComponent(location.pathname.replace(/^\/tags\/?/u, '').replace(/\/$/u, ''));
const heading = document.querySelector<HTMLElement>('#tag-title');
const intro = document.querySelector<HTMLElement>('#tag-intro');
const serial = document.querySelector<HTMLElement>('#tag-serial');
const grid = document.querySelector<HTMLElement>('#tag-grid');
document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', location.href);

function el<K extends keyof HTMLElementTagNameMap>(name: K, value: string, className?: string) { const n=document.createElement(name); n.textContent=value; if(className)n.className=className; return n; }

async function renderIndex() {
	const tags = await fetchTags();
	if (serial) serial.textContent = `${String(tags.length).padStart(2,'0')} CHANNELS ONLINE`;
	const cards = tags.map((tag,index)=>{const link=document.createElement('a');link.href=tagPath(tag.slug);link.style.setProperty('--i',String(index));link.append(el('span',`CH / ${String(index+1).padStart(2,'0')}`,'index'),el('h2',`#${tag.name}`),el('span',`${tag.count} 枚卡带`,'count'),el('span','TUNE →','arrow'));return link;});
	grid?.replaceChildren(...cards);
}

async function renderTag() {
	const [tags, result] = await Promise.all([fetchTags(), fetchPosts({tag:tagSlug,limit:100})]);
	const current = tags.find((tag)=>tag.slug===tagSlug);
	if (!current) throw new Error('Tag not found');
	if (heading) heading.textContent = `#${current.name}`;
	if (intro) intro.textContent = `当前频段捕获 ${result.total} 枚数据卡带。`;
	if (serial) serial.textContent = 'FILTER CHANNEL';
	const cards=result.items.map((post,index)=>{const link=document.createElement('a');link.href=`/blog/${encodeURIComponent(post.slug)}/`;link.style.setProperty('--i',String(index));link.append(el('span',formatDate(post.publishedAt),'index'),el('h2',post.title),el('span',post.description,'count'),el('span','LOAD →','arrow'));return link;});
	grid?.replaceChildren(...cards);
	document.title=`#${current.name} · 一梦未醒`;
}

(tagSlug ? renderTag() : renderIndex()).catch(()=>{if(grid)grid.replaceChildren(el('p','信号索引暂时无法读取，请稍后重试。'));});
