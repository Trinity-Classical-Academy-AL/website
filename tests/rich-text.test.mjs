import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richTextToPlain, sanitizeRichText } from '../packages/school/src/rich-text.ts';

test('only paragraphs, breaks, bold, italic, underline and lists survive; no attributes or scripts', () => {
	assert.equal(sanitizeRichText('<div>Hi <b onclick="x()">there</b></div><script>alert(1)</script><p><a href="javascript:x">link</a></p>'), '<p>Hi <strong>there</strong></p><p>alert(1)</p><p>link</p>');
	assert.equal(sanitizeRichText('<p>a <img src=x onerror=alert(1)> b</p>'), '<p>a  b</p>');
	assert.equal(sanitizeRichText('<p>1 < 2 & 3</p>'), '<p>1 &lt; 2 &amp; 3</p>');
	assert.equal(sanitizeRichText('Plain\n\nSecond <line>'), '<p>Plain</p><p>Second &lt;line&gt;</p>');
	assert.equal(sanitizeRichText('<ul><li><i>one</i></li><li><u>two</u></li></ul>'), '<ul><li><em>one</em></li><li><u>two</u></li></ul>');
});

test('rich text reads well as plain text', () => {
	assert.equal(richTextToPlain('<p>Hello <strong>all</strong></p><ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol><p>Bye &amp; thanks</p>'), 'Hello all\n\n• a\n• b\n\n1. x\n2. y\n\nBye & thanks');
});

test('messy browser structure flattens to paragraphs and lists', () => {
	assert.equal(sanitizeRichText('Dear friends, <b>hi</b>.<p><ul><li>One</li><li>Two</li></ul><p><span>Thanks.</span></p></p>'), '<p>Dear friends, <strong>hi</strong>.</p><ul><li>One</li><li>Two</li></ul><p>Thanks.</p>');
	assert.equal(sanitizeRichText('<p>Before</p><p><br></p><p>After</p>'), '<p>Before</p><p>After</p>');
});

test('a list after a paragraph is pulled out of its wrapper', () => {
	assert.equal(sanitizeRichText('<p>Dear friends.</p><p><ul><li>One</li></ul><p>Thanks.</p></p>'), '<p>Dear friends.</p><ul><li>One</li></ul><p>Thanks.</p>');
});
