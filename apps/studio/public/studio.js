const elements = {
  form: document.querySelector('#editor-form'),
  heading: document.querySelector('#editor-heading'),
  list: document.querySelector('#post-list'),
  count: document.querySelector('#post-count'),
  search: document.querySelector('#post-search'),
  newPost: document.querySelector('#new-post'),
  title: document.querySelector('#title'),
  slug: document.querySelector('#slug'),
  description: document.querySelector('#description'),
  descriptionCount: document.querySelector('#description-count'),
  tags: document.querySelector('#tags'),
  publishedAt: document.querySelector('#published-at'),
  featured: document.querySelector('#featured'),
  content: document.querySelector('#content'),
  preview: document.querySelector('#markdown-preview'),
  wordCount: document.querySelector('#word-count'),
  saveState: document.querySelector('#save-state'),
  publish: document.querySelector('#publish-post'),
  archive: document.querySelector('#archive-post'),
  delete: document.querySelector('#delete-post'),
  viewLive: document.querySelector('#view-live'),
  upload: document.querySelector('#upload-image'),
  imageInput: document.querySelector('#image-input'),
  loadingMask: document.querySelector('#loading-mask'),
  loadingText: document.querySelector('#loading-text'),
  toastRegion: document.querySelector('#toast-region'),
};

const state = {
  posts: [],
  status: 'all',
  currentSlug: null,
  dirty: false,
  loading: false,
  slugManuallyEdited: false,
  renderTimer: 0,
};

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.valueOf() - offset).toISOString().slice(0, 10);
}

function dateOnly(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : today();
}

function tagsFromInput() {
  return [...new Set(elements.tags.value.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean))];
}

function slugify(value) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 100);
}

function setBusy(busy, label = '正在同步…') {
  state.loading = busy;
  elements.loadingMask.hidden = !busy;
  elements.loadingText.textContent = label;
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(`/studio-api${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `请求失败（${response.status}）`);
  return body.data;
}

function setDirty(dirty) {
  state.dirty = dirty;
  elements.saveState.textContent = dirty ? '有未发布修改' : state.currentSlug ? '已与线上同步' : '尚未修改';
  elements.saveState.className = `save-state ${dirty ? 'dirty' : state.currentSlug ? 'saved' : ''}`;
}

function setEditorMode(post = null) {
  state.currentSlug = post?.slug ?? null;
  state.slugManuallyEdited = Boolean(post);
  elements.heading.textContent = post?.title ?? '新建日志';
  elements.title.value = post?.title ?? '';
  elements.slug.value = post?.slug ?? '';
  elements.slug.readOnly = Boolean(post);
  elements.description.value = post?.description ?? '';
  elements.tags.value = post?.tags?.join(', ') ?? '';
  elements.publishedAt.value = dateOnly(post?.publishedAt);
  elements.featured.checked = post?.featured ?? false;
  elements.content.value = post?.content ?? '';
  elements.publish.innerHTML = `<span class="button-light"></span>${post ? (post.status === 'archived' ? '重新发布' : '更新日志') : '发布日志'}`;
  elements.archive.hidden = !post || post.status === 'archived';
  elements.delete.hidden = !post;
  elements.viewLive.hidden = !post || post.status !== 'published';
  elements.viewLive.href = post ? `https://yimengweixing.pages.dev/blog/${encodeURIComponent(post.slug)}/` : '#';
  updateCounters();
  renderMarkdown();
  setDirty(false);
  renderList();
}

function resetEditor() {
  if (state.dirty && !window.confirm('当前修改尚未发布，确定要放弃吗？')) return;
  setEditorMode();
  elements.title.focus();
}

function renderList() {
  const query = elements.search.value.trim().toLocaleLowerCase('zh-CN');
  const posts = state.posts.filter((post) => {
    if (!query) return true;
    return `${post.title} ${post.description} ${post.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(query);
  });
  elements.list.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'list-placeholder';
    empty.textContent = query ? '没有匹配的日志' : '档案库还是空的';
    elements.list.append(empty);
  }
  for (const post of posts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `post-card${post.slug === state.currentSlug ? ' active' : ''}`;
    button.dataset.slug = post.slug;
    const top = document.createElement('span');
    top.className = 'post-card-top';
    const title = document.createElement('strong');
    title.textContent = post.title;
    const status = document.createElement('small');
    status.className = post.status === 'archived' ? 'archived' : '';
    status.textContent = post.status === 'archived' ? 'ARCHIVED' : 'ONLINE';
    top.append(title, status);
    const meta = document.createElement('span');
    meta.className = 'post-card-meta';
    const tags = document.createElement('span');
    tags.textContent = post.tags.length ? post.tags.map((tag) => `#${tag}`).join(' ') : '#未分类';
    const date = document.createElement('time');
    date.textContent = dateOnly(post.updatedAt);
    meta.append(tags, date);
    button.append(top, meta);
    button.addEventListener('click', () => loadPost(post.slug));
    elements.list.append(button);
  }
  elements.count.textContent = `${state.posts.length} 篇日志`;
}

async function loadPosts() {
  const data = await api(`/posts?status=${encodeURIComponent(state.status)}&limit=50`);
  state.posts = data;
  renderList();
}

async function loadPost(slug) {
  if (slug === state.currentSlug) return;
  if (state.dirty && !window.confirm('当前修改尚未发布，确定要切换文章吗？')) return;
  try {
    setBusy(true, '正在读取日志…');
    const post = await api(`/posts/${encodeURIComponent(slug)}`);
    setEditorMode(post);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function updateCounters() {
  elements.descriptionCount.textContent = String(elements.description.value.length);
  const compact = elements.content.value.replace(/\s/gu, '');
  elements.wordCount.textContent = `${compact.length.toLocaleString('zh-CN')} 字`;
  elements.heading.textContent = elements.title.value.trim() || (state.currentSlug ? '未命名日志' : '新建日志');
}

function safeUrl(raw, image = false) {
  const value = raw.trim();
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || (!image && parsed.protocol === 'mailto:')) return parsed.href;
  } catch { /* ignore invalid URLs */ }
  return null;
}

function appendInline(parent, text) {
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index)));
    if (match[2] !== undefined) {
      const url = safeUrl(match[3], true);
      if (url) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = match[2];
        image.loading = 'lazy';
        parent.append(image);
      } else parent.append(document.createTextNode(match[0]));
    } else if (match[4] !== undefined) {
      const url = safeUrl(match[5], false);
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = match[4];
        link.target = '_blank';
        link.rel = 'noreferrer';
        parent.append(link);
      } else parent.append(document.createTextNode(match[0]));
    } else if (match[6] !== undefined) {
      const code = document.createElement('code');
      code.textContent = match[6];
      parent.append(code);
    } else if (match[7] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = match[7];
      parent.append(strong);
    } else {
      const emphasis = document.createElement('em');
      emphasis.textContent = match[8];
      parent.append(emphasis);
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function renderMarkdown() {
  const source = elements.content.value.replace(/\r\n?/gu, '\n');
  elements.preview.replaceChildren();
  if (!source.trim()) {
    const empty = document.createElement('p');
    empty.className = 'preview-empty';
    empty.textContent = '预览信号等待输入…';
    elements.preview.append(empty);
    return;
  }

  const lines = source.split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^```/u.test(line)) {
      const language = line.slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/u.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (language) code.dataset.language = language;
      code.textContent = codeLines.join('\n');
      pre.append(code);
      elements.preview.append(pre);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) {
      const node = document.createElement(`h${heading[1].length}`);
      appendInline(node, heading[2]);
      elements.preview.append(node);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
      elements.preview.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    if (/^>\s?/u.test(line)) {
      const quote = document.createElement('blockquote');
      const quoteLines = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) quoteLines.push(lines[index++].replace(/^>\s?/u, ''));
      appendInline(quote, quoteLines.join(' '));
      elements.preview.append(quote);
      continue;
    }

    const listMatch = /^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/u.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const itemMatch = /^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/u.exec(lines[index]);
        if (!itemMatch || Boolean(itemMatch[2]) !== ordered) break;
        const item = document.createElement('li');
        appendInline(item, itemMatch[3]);
        list.append(item);
        index += 1;
      }
      elements.preview.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s|^```|^>\s?|^\s*(?:[-*+] |\d+\. )/u.test(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendInline(paragraph, paragraphLines.join(' '));
    elements.preview.append(paragraph);
  }
}

function schedulePreview() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderMarkdown, 90);
}

function validateForm() {
  const tags = tagsFromInput();
  if (!elements.form.reportValidity()) return null;
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(elements.slug.value.trim())) {
    toast('URL 标识只能包含文字、数字和连字符', 'error');
    elements.slug.focus();
    return null;
  }
  if (tags.length < 1 || tags.length > 8) {
    toast('请提供 1 到 8 个标签', 'error');
    elements.tags.focus();
    return null;
  }
  return {
    slug: elements.slug.value.trim(),
    title: elements.title.value.trim(),
    description: elements.description.value.trim(),
    content: elements.content.value.trim(),
    tags,
    featured: elements.featured.checked,
    publishedAt: new Date(`${elements.publishedAt.value}T00:00:00+08:00`).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function publishPost() {
  if (state.loading) return;
  const payload = validateForm();
  if (!payload) return;
  const updating = Boolean(state.currentSlug);
  try {
    setBusy(true, updating ? '正在更新日志…' : '正在发布日志…');
    const result = await api(updating ? `/posts/${encodeURIComponent(state.currentSlug)}` : '/posts', {
      method: updating ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await loadPosts();
    const post = await api(`/posts/${encodeURIComponent(result.slug)}`);
    setEditorMode(post);
    toast(updating ? '日志已更新，修订记录已保存' : '日志已发布到博客');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function archivePost() {
  if (!state.currentSlug || !window.confirm('归档后文章将从公开博客隐藏，确定继续吗？')) return;
  try {
    setBusy(true, '正在归档日志…');
    await api(`/posts/${encodeURIComponent(state.currentSlug)}/archive`, { method: 'POST' });
    await loadPosts();
    const post = await api(`/posts/${encodeURIComponent(state.currentSlug)}`);
    setEditorMode(post);
    toast('日志已归档，可随时重新发布');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function deletePost() {
  if (!state.currentSlug) return;
  const title = elements.title.value.trim() || state.currentSlug;
  if (!window.confirm(`确定永久删除「${title}」吗？文章会保留一份删除前修订记录。`)) return;
  try {
    setBusy(true, '正在删除日志…');
    await api(`/posts/${encodeURIComponent(state.currentSlug)}`, { method: 'DELETE' });
    await loadPosts();
    setEditorMode();
    toast('日志已删除');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function insertAtCursor(text) {
  const start = elements.content.selectionStart;
  const end = elements.content.selectionEnd;
  const before = elements.content.value.slice(0, start);
  const after = elements.content.value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
  elements.content.value = `${before}${prefix}${text}${suffix}${after}`;
  const caret = before.length + prefix.length + text.length;
  elements.content.setSelectionRange(caret, caret);
  elements.content.focus();
  setDirty(true);
  updateCounters();
  renderMarkdown();
}

async function uploadImages(files) {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  for (const file of files) {
    if (!allowed.has(file.type)) { toast(`${file.name} 不是支持的图片格式`, 'error'); continue; }
    if (file.size > 1_500_000) { toast(`${file.name} 超过 1.5 MB`, 'error'); continue; }
    try {
      setBusy(true, `正在上传 ${file.name}…`);
      const asset = await api('/assets', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      insertAtCursor(`![${file.name}](${asset.url})`);
      toast(`${file.name} 已插入正文`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  elements.imageInput.value = '';
}

elements.newPost.addEventListener('click', resetEditor);
elements.search.addEventListener('input', renderList);
elements.publish.addEventListener('click', publishPost);
elements.archive.addEventListener('click', archivePost);
elements.delete.addEventListener('click', deletePost);
elements.upload.addEventListener('click', () => elements.imageInput.click());
elements.imageInput.addEventListener('change', () => uploadImages([...elements.imageInput.files]));

for (const tab of document.querySelectorAll('[data-status]')) {
  tab.addEventListener('click', async () => {
    state.status = tab.dataset.status;
    for (const item of document.querySelectorAll('[data-status]')) item.classList.toggle('active', item === tab);
    try { await loadPosts(); } catch (error) { toast(error.message, 'error'); }
  });
}

for (const control of elements.form.querySelectorAll('input, textarea')) {
  control.addEventListener('input', () => {
    if (control === elements.title && !state.currentSlug && !state.slugManuallyEdited) elements.slug.value = slugify(elements.title.value);
    if (control === elements.slug) state.slugManuallyEdited = Boolean(elements.slug.value);
    setDirty(true);
    updateCounters();
    if (control === elements.content) schedulePreview();
  });
}

elements.content.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = elements.content.selectionStart;
    elements.content.setRangeText('  ', start, elements.content.selectionEnd, 'end');
    elements.content.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('en-US') === 's') {
    event.preventDefault();
    publishPost();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

async function start() {
  setEditorMode();
  try {
    setBusy(true, '正在连接 D1 档案库…');
    await loadPosts();
  } catch (error) {
    toast(error.message, 'error');
    elements.list.innerHTML = '<div class="list-placeholder">档案库连接失败，请稍后刷新</div>';
  } finally {
    setBusy(false);
  }
}

start();
