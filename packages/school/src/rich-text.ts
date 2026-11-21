/**
 * Announcement bodies are a small subset of HTML: paragraphs, line breaks,
 * bold, italic, underline and lists. Everything else is dropped (tags) or
 * escaped (stray "<"), and no attributes survive, so it's safe to render.
 * Older bodies are plain text; they're turned into paragraphs.
 */
const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em', div: 'p' };

const escapeText = (value: string) => value.replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const isRichText = (value: string) => /<(p|ul|ol|li|strong|em|u|br|b|i|div)\b/i.test(value);

/** Plain text (older announcements) to paragraphs. */
export function plainToRichText(text: string): string {
	return text.trim().split(/\n\s*\n/).map((part) => `<p>${escapeText(part.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

export function sanitizeRichText(input: string): string {
	if (!isRichText(input)) return plainToRichText(input);
	let out = '';
	let last = 0;
	const tag = /<(\/?)([a-z0-9]+)\b[^>]*>/gi;
	for (const match of input.matchAll(tag)) {
		out += escapeText(input.slice(last, match.index));
		last = match.index! + match[0].length;
		const name = RENAME[match[2].toLowerCase()] ?? match[2].toLowerCase();
		if (!ALLOWED.has(name)) continue;
		out += name === 'br' ? (match[1] ? '' : '<br>') : `<${match[1]}${name}>`;
	}
	out += escapeText(input.slice(last));
	return tidy(out);
}

/**
 * Browsers nest blocks oddly (a list inside a paragraph, text outside any
 * paragraph). Flatten to paragraphs and lists at the top level.
 */
function tidy(html: string): string {
	let out = html.replace(/<p>\s*<p>/g, '<p>').replace(/<\/p>\s*<\/p>/g, '</p>');
	// A list never sits inside a paragraph: close the paragraph before it, reopen after.
	out = out.replace(/<p>((?:(?!<\/?p>)[^])*?)<(ul|ol)>/g, (match, before: string, list: string) => `${before.trim() ? `<p>${before}</p>` : ''}<${list}>`)
		.replace(/<\/(ul|ol)>((?:(?!<\/?p>)[^])*?)<\/p>/g, (match, list: string, after: string) => `</${list}>${after.trim() ? `<p>${after}</p>` : ''}`)
		.replace(/<\/(ul|ol)>(\s*<p>[^]*?<\/p>)\s*<\/p>/g, '</$1>$2');
	// Loose text at the top level becomes a paragraph.
	const blocks: string[] = [];
	let depth = 0, loose = '';
	for (const part of out.split(/(<\/?(?:p|ul|ol)>)/)) {
		if (!part) continue;
		const open = /^<(p|ul|ol)>$/.test(part), close = /^<\/(p|ul|ol)>$/.test(part);
		if (depth === 0 && !open && !close) { loose += part; continue; }
		if (depth === 0 && open && loose.trim()) { blocks.push(`<p>${loose.trim()}</p>`); loose = ''; }
		if (open) depth += 1;
		if (close) depth = Math.max(0, depth - 1);
		blocks.push(part);
	}
	if (loose.trim()) blocks.push(`<p>${loose.trim()}</p>`);
	return blocks.join('').replace(/<p>(\s|<br>)*<\/p>/g, '').replace(/^(<br>)+|(<br>)+$/g, '').trim();
}

/** For plain-text emails, previews and search. */
export function richTextToPlain(html: string): string {
	const rich = isRichText(html) ? html : plainToRichText(html);
	// Lists: bullets for <ul>, numbers for <ol> (tracked as we go).
	const lists: { ordered: boolean; n: number }[] = [];
	const listed = rich.replace(/<(\/?)(ul|ol|li)>/g, (match, close: string, name: string) => {
		if (name === 'li') { if (close) return ''; const top = lists[lists.length - 1]; return top?.ordered ? `\n${++top.n}. ` : '\n• '; }
		if (close) { lists.pop(); return '\n\n'; }
		lists.push({ ordered: name === 'ol', n: 0 });
		return '\n';
	});
	return listed
		.replace(/<br>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
		.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Inline styles for email clients (they ignore stylesheets). */
export function richTextEmailHtml(html: string, font: string): string {
	return sanitizeRichText(html)
		.replace(/<p>/g, `<p style="margin:0 0 16px;font:${font}">`)
		.replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:22px;font:${font}">`)
		.replace(/<ol>/g, `<ol style="margin:0 0 16px;padding-left:22px;font:${font}">`)
		.replace(/<li>/g, '<li style="margin:0 0 6px">');
}
