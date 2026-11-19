import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom, fieldErrorMessage } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { parseUsDate } from '../fields.ts';
import { getBannerDocument, saveBanner, saveFlyerBytes, deleteAnnouncement, listAdminAnnouncements, saveAnnouncement } from '@tca/school';
import { emptyBanner, isBannerActive, sniffFlyer, type Banner } from '../../../../src/lib/admissions/banner.ts';
import { validateBanner } from '../../../../src/lib/admissions/validation.ts';
import { TOUR_DEFAULTS } from '../../../../src/lib/admissions/defaults.ts';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadWebsite(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	const tab = Astro.url.searchParams.get('tab') === 'announcements' ? 'announcements' : 'banner';
	const [storedBanner, listedAnnouncements] = await Promise.all([getBannerDocument(), tab === 'announcements' ? listAdminAnnouncements() : Promise.resolve([])]);
	let banner = (storedBanner?.current as Banner | undefined) ?? emptyBanner();
	let errors: Record<string, string> = {};
	let errorSummary = '';
	let flyerError = '';
	const posted: Record<string, string> = {};
	const actionResult = await runActions(Astro, {
		announcement: async (form) => {
			const result = await saveAnnouncement({
				id: String(form.get('id') ?? '') || undefined,
				title: String(form.get('title') ?? ''),
				body: String(form.get('body') ?? ''),
				audience: String(form.get('audience') ?? 'all'),
				emailIt: form.get('emailIt') === 'on',
				publish: String(form.get('publish') ?? '') === 'yes',
			});
			return redirectOnSuccess(result, result => `/admin/website?tab=announcements&saved=${result.id}&mailed=${result.mailed}`);
		},
		'delete-announcement': async (form) => {
			await deleteAnnouncement(String(form.get('id') ?? ''));
			return { redirect: '/admin/website?tab=announcements&removed=1' };
		},
	}, {
		fallback: async (form) => {
			let flyer = banner.flyer;
			if (form.get('removeFlyer') === 'yes') flyer = null;
			const file = form.get('flyer');
			if (file instanceof File && file.size > 0) {
				if (file.size > TOUR_DEFAULTS.flyerMaxBytes) flyerError = `${file.name} is too large. Files must be 10 MB or smaller.`;
				else {
					const bytes = new Uint8Array(await file.arrayBuffer());
					const contentType = sniffFlyer(bytes, file.type);
					if (!contentType) flyerError = 'Use a JPG, PNG, WebP, or PDF.';
					else {
						const saved = await saveFlyerBytes(bytes, { name: file.name.replace(/[^\w.\- ]+/g, '').slice(0, 180) || 'flyer', contentType });
						flyer = { ...saved, contentType };
					}
				}
			}
			const startsOn = parseUsDate(String(form.get('startsOn') ?? '')) || (String(form.get('startsOn') ?? '').trim() ? 'invalid' : '');
			const endsOn = parseUsDate(String(form.get('endsOn') ?? '')) || (String(form.get('endsOn') ?? '').trim() ? 'invalid' : '');
			for (const key of ['text', 'url', 'title', 'date', 'time', 'location', 'description', 'rsvpUrl', 'rsvpLabel', 'secondaryUrl', 'secondaryLabel', 'startsOn', 'endsOn', 'clickAction']) {
				posted[key] = String(form.get(key) ?? '');
			}
			posted.enabled = form.get('enabled') === 'on' ? 'on' : '';
			if (!flyerError) {
				const validation = validateBanner({
					enabled: form.get('enabled') === 'on',
					text: posted.text,
					startsOn: startsOn === 'invalid' ? 'bad' : startsOn,
					endsOn: endsOn === 'invalid' ? 'bad' : endsOn,
					clickAction: posted.clickAction,
					url: posted.url,
					modal: {
						title: posted.title,
						date: parseUsDate(posted.date) || posted.date,
						time: posted.time,
						location: posted.location,
						description: posted.description,
						rsvpUrl: posted.rsvpUrl,
						rsvpLabel: posted.rsvpLabel,
						secondaryUrl: posted.secondaryUrl,
						secondaryLabel: posted.secondaryLabel,
					},
				});
				errors = validation.errors;
				if (startsOn === 'invalid') errors.startsOn = 'Use a real date.';
				if (endsOn === 'invalid') errors.endsOn = errors.endsOn || 'Use a real date.';
				const count = Object.keys(errors).length;
				if (count) errorSummary = fieldErrorMessage(count, { suffix: ' before saving. The live banner hasn’t changed.' });
				else if (validation.value) {
					await saveBanner({ ...validation.value, flyer, updatedAt: '' });
					const live = validation.value.enabled ? 'live' : 'hidden';
					return { redirect: `/admin/website?saved=1&state=${live}` };
				}
			}
			banner = {
				...banner,
				enabled: posted.enabled === 'on',
				text: posted.text ?? banner.text,
				startsOn: startsOn && startsOn !== 'invalid' ? startsOn : banner.startsOn,
				endsOn: endsOn && endsOn !== 'invalid' ? endsOn : banner.endsOn,
				clickAction: posted.clickAction === 'url' ? 'url' : 'flyer',
				url: posted.url ?? banner.url,
				flyer,
				modal: { ...banner.modal, title: posted.title ?? '', date: posted.date ?? '', time: posted.time ?? '', location: posted.location ?? '', description: posted.description ?? '', rsvpUrl: posted.rsvpUrl ?? '', rsvpLabel: posted.rsvpLabel || 'RSVP', secondaryUrl: posted.secondaryUrl ?? '', secondaryLabel: posted.secondaryLabel ?? '' },
			};
			return { error: errorSummary, fields: errors };
		},
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	errorSummary = actionResult.error;
	errors = actionResult.fields;
	const saved = Astro.url.searchParams.get('saved') === '1';
	const hidden = Astro.url.searchParams.get('state') === 'hidden';
	const announcements = listedAnnouncements;
	const editingId = Astro.url.searchParams.get('edit') || '';
	const addingAnnouncement = Astro.url.searchParams.get('sheet') === 'new' || Boolean(errorSummary && tab === 'announcements' && !editingId);
	const editingAnnouncement = announcements.find((row) => row.id === editingId);
	const live = isBannerActive(banner);
	const previewBadge = !banner.text.trim() ? 'Not set' : live ? 'Live' : 'Hidden';
	const bannerToast = saved ? toastFrom(Astro.url, { saved: hidden ? 'Banner saved. Hidden on the website.' : 'Banner saved. Live on the website now.' }) : '';
	const announcementToast = tab === 'announcements' ? toastFrom(Astro.url, { saved: (_value, url) => `Announcement saved${Number(url.searchParams.get('mailed') || 0) ? ` and emailed to ${url.searchParams.get('mailed')} families.` : '.'}` }) : '';
	return { family, csrf, tab, banner, errors, errorSummary, flyerError, saved, hidden, announcements, addingAnnouncement, editingAnnouncement, live, previewBadge, bannerToast, announcementToast };
}

export type WebsiteView = Exclude<Awaited<ReturnType<typeof loadWebsite>>, Response>;
