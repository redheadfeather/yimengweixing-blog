import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { fetchPost, fetchPosts, fetchTags, formatDate, tagPath } from './content-api';

type Post = Awaited<ReturnType<typeof fetchPosts>>['items'][number];
const slug = decodeURIComponent(location.pathname.replace(/^\/blog\/?/u, '').replace(/\/$/u, ''));
const archive = document.querySelector<HTMLElement>('#archive-view');
const reader = document.querySelector<HTMLElement>('#reader-view');

function el<K extends keyof HTMLElementTagNameMap>(name: K, value = '', className = '') { const node=document.createElement(name);node.textContent=value;if(className)node.className=className;return node; }
function postUrl(post: Post) { return `/blog/${encodeURIComponent(post.slug)}/`; }
function toTagSlug(name: string) { return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/\s+/gu,'-').replace(/[/?#%]+/gu,'-'); }

function renderCard(post: Post, index: number) {
	const card=document.createElement('article');card.append(el('span','','slot'));
	const top=el('div','','card-top');top.append(el('span',`CARTRIDGE / ${String(index+1).padStart(2,'0')}`),el('span',formatDate(post.publishedAt)));card.append(top);
	const link=document.createElement('a');link.className='article-link';link.href=postUrl(post);link.append(el('h2',post.title),el('p',post.description));card.append(link);
	const bottom=el('div','','card-bottom');const tagBox=el('div','','card-tags');post.tags.forEach((name)=>{const a=document.createElement('a');a.href=`/blog/?tag=${encodeURIComponent(toTagSlug(name))}`;a.textContent=`#${name}`;tagBox.append(a);});
	const load=document.createElement('a');load.className='read-link';load.href=postUrl(post);load.textContent='LOAD →';bottom.append(tagBox,load);card.append(bottom);return card;
}

async function bootArchive() {
	archive?.removeAttribute('hidden');reader?.setAttribute('hidden','');
	const input=document.querySelector<HTMLInputElement>('#article-search');const filters=document.querySelector<HTMLElement>('#tags');const grid=document.querySelector<HTMLElement>('#article-grid');const count=document.querySelector<HTMLElement>('#result-count');const empty=document.querySelector<HTMLElement>('#empty-state');
	if(!input||!filters||!grid||!count||!empty)return;
	const params=new URLSearchParams(location.search);input.value=params.get('q')??'';let selected=params.get('tag')??'';let timer=0;let request=0;
	const tags=await fetchTags();
	const makeButton=(label:string,value:string,total:number)=>{const b=document.createElement('button');b.type='button';b.className='tag-filter';b.dataset.tag=value;b.append(document.createTextNode(label+' '),el('small',String(total)));b.addEventListener('click',()=>{selected=value;void search();dispatchEvent(new Event('pixel-lab:search'));});return b;};
	const all=makeButton('全部','',0);filters.append(all,...tags.map((tag)=>makeButton(`#${tag.name}`,tag.slug,tag.count)));
	const sync=()=>filters.querySelectorAll<HTMLButtonElement>('button').forEach((b)=>{const active=b.dataset.tag===selected;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
	const search=async()=>{const version=++request;const q=input.value.trim();sync();count.textContent='正在扫描 D1 档案…';document.querySelector('.search-console')?.setAttribute('aria-busy','true');const next=new URLSearchParams();if(q)next.set('q',q);if(selected)next.set('tag',selected);history.replaceState(null,'',`/blog/${next.size?`?${next}`:''}`);try{const result=await fetchPosts({q,tag:selected,limit:100});if(version!==request)return;all.querySelector('small')!.textContent=String(result.total);grid.replaceChildren(...result.items.map(renderCard));count.textContent=`捕获 ${result.total} 枚卡带`;empty.hidden=result.total!==0;}catch{if(version!==request)return;grid.replaceChildren();count.textContent='扫描失败，请稍后重试';empty.hidden=false;}finally{document.querySelector('.search-console')?.setAttribute('aria-busy','false');}};
	input.addEventListener('input',()=>{clearTimeout(timer);timer=window.setTimeout(()=>void search(),260);});
	void search();
}

function buildToc(content: HTMLElement) {
	const headings=[...content.querySelectorAll<HTMLElement>('h2,h3')];const toc=document.querySelector<HTMLElement>('#toc-nav');const wrapper=document.querySelector<HTMLDetailsElement>('#toc');if(!toc||!wrapper||!headings.length){wrapper?.setAttribute('hidden','');return;}
	const used=new Set<string>();headings.forEach((heading,index)=>{let id=heading.id||`section-${index+1}`;while(used.has(id))id+=`-${index+1}`;used.add(id);heading.id=id;const link=document.createElement('a');link.className=`depth-${heading.tagName==='H2'?2:3}`;link.href=`#${id}`;link.append(el('span',String(index+1).padStart(2,'0')),document.createTextNode(heading.textContent??''));toc.append(link);});
	if(matchMedia('(max-width: 900px)').matches)wrapper.open=false;
}

function enhanceReader() {
	const progress=document.querySelector<HTMLElement>('.reading-progress span');const backTop=document.querySelector<HTMLButtonElement>('.back-top');const links=[...document.querySelectorAll<HTMLAnchorElement>('#toc-nav a')];const headings=links.map((link)=>document.getElementById(decodeURIComponent(link.hash.slice(1)))).filter(Boolean) as HTMLElement[];
	const update=()=>{const max=document.documentElement.scrollHeight-innerHeight;progress?.style.setProperty('transform',`scaleX(${max>0?Math.min(scrollY/max,1):0})`);backTop?.classList.toggle('visible',scrollY>520);let active=headings[0]?.id;for(const heading of headings)if(heading.getBoundingClientRect().top<=150)active=heading.id;links.forEach((link)=>link.classList.toggle('active',decodeURIComponent(link.hash.slice(1))===active));};addEventListener('scroll',update,{passive:true});update();backTop?.addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));
	document.querySelectorAll<HTMLElement>('#article-content pre').forEach((pre)=>{const code=pre.querySelector('code');if(!code)return;const frame=el('div','','code-frame');const bar=el('div','','code-bar');const language=[...code.classList].find((name)=>name.startsWith('language-'))?.replace('language-','')||'CODE';const button=el('button','COPY') as HTMLButtonElement;button.type='button';bar.append(el('span',language),button);pre.before(frame);frame.append(bar,pre);button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(code.textContent??'');button.textContent='COPIED';}catch{button.textContent='FAILED';}setTimeout(()=>button.textContent='COPY',1600);});});
}

async function bootReader() {
	archive?.setAttribute('hidden','');reader?.removeAttribute('hidden');
	const content=document.querySelector<HTMLElement>('#article-content');const title=document.querySelector<HTMLElement>('#post-title');const description=document.querySelector<HTMLElement>('#post-description');const meta=document.querySelector<HTMLElement>('#post-meta');const related=document.querySelector<HTMLElement>('#related-grid');if(!content||!title||!description||!meta||!related)return;
	try{const post=await fetchPost(slug);title.textContent=post.title;description.textContent=post.description;meta.append(el('span',formatDate(post.publishedAt)),el('span','·'));const tags=el('div','','post-tags');post.tags.forEach((name)=>{const a=document.createElement('a');a.href=`/blog/?tag=${encodeURIComponent(toTagSlug(name))}`;a.textContent=`#${name}`;tags.append(a);});meta.append(tags);content.innerHTML=DOMPurify.sanitize(await marked.parse(post.content));buildToc(content);related.replaceChildren(...post.relatedPosts.map((item)=>{const a=document.createElement('a');a.href=postUrl(item);a.append(el('span',item.tags.slice(0,2).map((tag)=>`#${tag}`).join(' · ')),el('strong',item.title),el('small',item.description));return a;}));document.querySelector('#related')?.toggleAttribute('hidden',post.relatedPosts.length===0);document.title=`${post.title} · 一梦未醒`;document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content',post.description);document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href',location.href);enhanceReader();}catch{title.textContent='档案读取失败';description.textContent='这枚卡带不存在，或内容服务暂时无法连接。';content.replaceChildren(el('p','请返回档案柜后重试。'));document.querySelector('#toc')?.setAttribute('hidden','');document.querySelector('#related')?.setAttribute('hidden','');}
}

void (slug ? bootReader() : bootArchive());
