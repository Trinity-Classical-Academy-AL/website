import { formatBannerWhen } from '../lib/admissions/dates.ts';

type Flyer = { key: string; name: string; contentType: string; size: number };
type Modal = {
	title: string;
	date: string;
	time: string;
	location: string;
	description: string;
	rsvpUrl: string;
	rsvpLabel: string;
	secondaryUrl: string;
	secondaryLabel: string;
};
type Banner = {
	enabled: boolean;
	text: string;
	startsOn: string;
	endsOn: string;
	clickAction: 'url' | 'flyer';
	url: string;
	flyer: Flyer | null;
	modal: Modal;
	updatedAt?: string;
	version?: string;
};
type TourDate = {
	id?: string;
	date: string;
	capacity: number;
	startTime: string;
	endTime: string;
	enabled: boolean;
	label?: string;
	timeLabel?: string;
	booked?: number;
};
type TourRequest = {
	id: string;
	createdAt: string;
	status: string;
	tourDateId: string;
	parentName: string;
	email: string;
	phone: string;
	children: number;
	grades: string[];
	hearAbout: string;
	message: string;
};
type Interest = {
	id: string;
	createdAt: string;
	name: string;
	email: string;
	phone: string;
	pagePath: string;
	message: string;
};

async function api(path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	const response = await fetch(path, { ...init, headers });
	const type = response.headers.get('content-type') ?? '';
	const body = type.includes('json') ? await response.json() : null;
	return { response, body };
}

function escapeText(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
		return map[character];
	});
}

export function initAdminPage() {
	const root = document.querySelector<HTMLElement>('[data-admin-page]');
	if (!root) return;
	const loginView = root.querySelector<HTMLElement>('[data-admin-view="login"]');
	const appView = root.querySelector<HTMLElement>('[data-admin-view="app"]');
	const loginForm = root.querySelector<HTMLFormElement>('[data-login-form]');
	const loginError = root.querySelector<HTMLElement>('[data-login-error]');
	const bannerForm = root.querySelector<HTMLFormElement>('[data-banner-form]');
	if (!loginView || !appView || !loginForm || !bannerForm) return;

	let flyer: Flyer | null = null;
	let pastBanners: Banner[] = [];
	let dates: TourDate[] = [];
	let suggested: TourDate[] = [];
	let previewUrl = '';

	const showLogin = (message = '') => {
		loginView.hidden = false;
		appView.hidden = true;
		if (loginError) {
			loginError.hidden = !message;
			loginError.textContent = message;
		}
	};
	const showApp = () => {
		loginView.hidden = true;
		appView.hidden = false;
	};

	const textCount = () => {
		const input = bannerForm.querySelector<HTMLInputElement>('[data-banner-text]');
		const count = root.querySelector('[data-text-count]');
		if (count && input) count.textContent = String(input.value.length);
	};

	const fillBanner = (banner: Banner) => {
		flyer = banner.flyer;
		const enabled = bannerForm.querySelector<HTMLInputElement>('[data-banner-enabled]');
		const text = bannerForm.querySelector<HTMLInputElement>('[data-banner-text]');
		if (enabled) enabled.checked = banner.enabled;
		if (text) text.value = banner.text;
		bannerForm.querySelectorAll<HTMLInputElement>('input[name="clickAction"]').forEach((input) => {
			input.checked = input.value === banner.clickAction;
		});
		const url = bannerForm.querySelector<HTMLInputElement>('[data-banner-url]');
		if (url) url.value = banner.url;
		const modal = banner.modal;
		const set = (name: string, value: string) => {
			const field = bannerForm.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
			if (field) field.value = value;
		};
		set('title', modal.title);
		set('date', modal.date);
		set('time', modal.time);
		set('location', modal.location);
		set('description', modal.description);
		set('rsvpUrl', modal.rsvpUrl);
		set('rsvpLabel', modal.rsvpLabel || 'RSVP');
		set('secondaryUrl', modal.secondaryUrl);
		set('secondaryLabel', modal.secondaryLabel);
		set('startsOn', banner.startsOn);
		set('endsOn', banner.endsOn);
		const label = root.querySelector('[data-flyer-label]');
		const remove = root.querySelector<HTMLButtonElement>('[data-flyer-remove]');
		if (label) {
			label.textContent = flyer
				? `${flyer.name} · ${Math.max(1, Math.round(flyer.size / 1024))} KB`
				: 'Drag a flyer here or choose a file. JPG, PNG, WebP, or PDF · up to 8 MB.';
		}
		if (remove) remove.hidden = !flyer;
		textCount();
		paintPreview();
	};

	const paintPreview = () => {
		const banner = collectBanner();
		const bar = root.querySelector('[data-live-banner]');
		if (bar) bar.textContent = banner.text || 'Banner text shows here';
		const title = root.querySelector('[data-live-title]');
		const when = root.querySelector('[data-live-when]');
		const where = root.querySelector('[data-live-where]');
		const description = root.querySelector('[data-live-description]');
		if (title) title.textContent = banner.modal.title || 'Event title';
		if (when) when.textContent = formatBannerWhen(banner.modal.date, banner.modal.time);
		if (where) where.textContent = banner.modal.location;
		if (description) description.textContent = banner.modal.description;
		const media = root.querySelector('[data-live-media]');
		if (!media) return;
		media.replaceChildren();
		if (!flyer) return;
		if (previewUrl && flyer.contentType.startsWith('image/')) {
			const image = document.createElement('img');
			image.src = previewUrl;
			image.alt = '';
			image.className = 'max-h-48 w-auto object-contain';
			media.append(image);
		} else {
			const note = document.createElement('p');
			note.className = 'font-sans text-xs text-white';
			note.textContent = flyer.contentType === 'application/pdf' ? 'PDF flyer' : flyer.name;
			media.append(note);
		}
	};

	const collectBanner = (): Banner => {
		const data = new FormData(bannerForm);
		return {
			enabled: data.get('enabled') === 'on',
			text: String(data.get('text') ?? ''),
			startsOn: String(data.get('startsOn') ?? ''),
			endsOn: String(data.get('endsOn') ?? ''),
			clickAction: data.get('clickAction') === 'url' ? 'url' : 'flyer',
			url: String(data.get('url') ?? ''),
			flyer,
			modal: {
				title: String(data.get('title') ?? ''),
				date: String(data.get('date') ?? ''),
				time: String(data.get('time') ?? ''),
				location: String(data.get('location') ?? ''),
				description: String(data.get('description') ?? ''),
				rsvpUrl: String(data.get('rsvpUrl') ?? ''),
				rsvpLabel: String(data.get('rsvpLabel') ?? ''),
				secondaryUrl: String(data.get('secondaryUrl') ?? ''),
				secondaryLabel: String(data.get('secondaryLabel') ?? ''),
			},
		};
	};

	const renderHistory = () => {
		const list = root.querySelector('[data-history]');
		if (!list) return;
		list.replaceChildren();
		if (pastBanners.length === 0) {
			const empty = document.createElement('li');
			empty.className = 'font-sans text-sm text-ink-mute';
			empty.textContent = 'No past banners yet.';
			list.append(empty);
			return;
		}
		pastBanners.forEach((banner, index) => {
			const item = document.createElement('li');
			item.className = 'flex items-center justify-between gap-3 rounded-card border border-ink/10 px-3 py-2';
			const copy = document.createElement('span');
			copy.className = 'min-w-0 truncate font-sans text-sm';
			copy.textContent = banner.text || 'Untitled banner';
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-forest';
			button.textContent = 'Reuse';
			button.addEventListener('click', () => {
				fillBanner({ ...banner, startsOn: '', endsOn: '', enabled: false });
				const status = root.querySelector('[data-save-status]');
				if (status) status.textContent = 'Copied into the form. Dates were cleared. Save to publish.';
			});
			item.append(copy, button);
			list.append(item);
			void index;
		});
	};

	const renderDates = () => {
		const host = root.querySelector('[data-date-editor]');
		if (!host) return;
		const table = document.createElement('table');
		table.className = 'w-full min-w-[720px] border-collapse text-left font-sans text-sm';
		table.innerHTML =
			'<thead><tr class="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute"><th class="py-2 pr-3">Date</th><th class="py-2 pr-3">Start</th><th class="py-2 pr-3">End</th><th class="py-2 pr-3">Capacity</th><th class="py-2 pr-3">Booked</th><th class="py-2">On the site</th></tr></thead>';
		const body = document.createElement('tbody');
		dates.forEach((date, index) => {
			const row = document.createElement('tr');
			row.className = 'border-t border-ink/10';
			row.innerHTML = `<td class="py-2 pr-3"><input data-date="${index}" type="date" value="${escapeText(date.date)}" class="rounded-card border border-ink/15 px-2 py-1"></td>
				<td class="py-2 pr-3"><input data-start="${index}" type="time" value="${escapeText(date.startTime)}" class="rounded-card border border-ink/15 px-2 py-1"></td>
				<td class="py-2 pr-3"><input data-end="${index}" type="time" value="${escapeText(date.endTime)}" class="rounded-card border border-ink/15 px-2 py-1"></td>
				<td class="py-2 pr-3"><input data-capacity="${index}" type="number" min="0" max="200" value="${date.capacity}" class="w-20 rounded-card border border-ink/15 px-2 py-1"></td>
				<td class="py-2 pr-3">${date.booked ?? 0}</td>
				<td class="py-2"><input data-enabled="${index}" type="checkbox" ${date.enabled ? 'checked' : ''} class="h-4 w-4 accent-forest"></td>`;
			body.append(row);
		});
		table.append(body);
		host.replaceChildren(table);
		host.querySelectorAll('input').forEach((input) => {
			input.addEventListener('change', () => {
				const index = Number(input.dataset.date ?? input.dataset.start ?? input.dataset.end ?? input.dataset.capacity ?? input.dataset.enabled);
				const date = dates[index];
				if (!date) return;
				if (input.dataset.date != null) date.date = (input as HTMLInputElement).value;
				if (input.dataset.start != null) date.startTime = (input as HTMLInputElement).value;
				if (input.dataset.end != null) date.endTime = (input as HTMLInputElement).value;
				if (input.dataset.capacity != null) date.capacity = Number((input as HTMLInputElement).value);
				if (input.dataset.enabled != null) date.enabled = (input as HTMLInputElement).checked;
			});
		});
	};

	const renderTable = (host: Element | null, headers: string[], rows: string[][]) => {
		if (!host) return;
		if (rows.length === 0) {
			host.textContent = 'Nothing here yet.';
			return;
		}
		const table = document.createElement('table');
		table.className = 'w-full min-w-[640px] border-collapse text-left font-sans text-sm';
		const head = document.createElement('tr');
		headers.forEach((header) => {
			const cell = document.createElement('th');
			cell.className = 'py-2 pr-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute';
			cell.textContent = header;
			head.append(cell);
		});
		const thead = document.createElement('thead');
		thead.append(head);
		const body = document.createElement('tbody');
		rows.forEach((row) => {
			const tr = document.createElement('tr');
			tr.className = 'border-t border-ink/10 align-top';
			row.forEach((value) => {
				const cell = document.createElement('td');
				cell.className = 'py-2 pr-3';
				cell.textContent = value;
				tr.append(cell);
			});
			body.append(tr);
		});
		table.append(thead, body);
		host.replaceChildren(table);
	};

	const loadOverview = async () => {
		const { response, body } = await api('/api/admin/overview');
		if (!response.ok) return;
		dates = body.dates ?? [];
		suggested = body.suggestedDates ?? [];
		renderDates();
		const requests = (body.requests ?? []) as TourRequest[];
		const requestHost = root.querySelector('[data-requests]');
		renderTable(
			requestHost,
			['When', 'Status', 'Tour', 'Name', 'Email', 'Phone', 'Children', 'Grades', 'Note'],
			requests.map((request) => [
				request.createdAt.slice(0, 16).replace('T', ' '),
				request.status,
				request.tourDateId,
				request.parentName,
				request.email,
				request.phone,
				String(request.children || ''),
				request.grades.join(', '),
				request.message,
			]),
		);
		requests.forEach((request, index) => {
			if (request.status === 'cancelled') return;
			const row = requestHost?.querySelectorAll('tbody tr')[index];
			if (!row) return;
			const cell = document.createElement('td');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'font-mono text-[10px] uppercase tracking-eyebrow text-[#9f2d2d]';
			button.textContent = 'Free seat';
			button.addEventListener('click', async () => {
				button.disabled = true;
				const result = await api('/api/admin/tour-requests/cancel', {
					method: 'POST',
					body: JSON.stringify({ id: request.id }),
				});
				if (result.response.ok) await loadOverview();
				else button.disabled = false;
			});
			cell.append(button);
			row.append(cell);
		});
		renderTable(
			root.querySelector('[data-interest]'),
			['When', 'Name', 'Email', 'Phone', 'Page', 'Note'],
			((body.interest ?? []) as Interest[]).map((note) => [
				note.createdAt.slice(0, 16).replace('T', ' '),
				note.name,
				note.email,
				note.phone,
				note.pagePath,
				note.message,
			]),
		);
	};

	const loadBanner = async () => {
		const { response, body } = await api('/api/admin/banner');
		if (!response.ok) return;
		pastBanners = body.history ?? [];
		fillBanner(body.current);
		renderHistory();
		const status = root.querySelector('[data-save-status]');
		if (status) {
			status.textContent = body.current?.updatedAt
				? `All changes saved · ${new Date(body.current.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
				: 'Not saved yet';
		}
	};

	loginForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const token = new FormData(loginForm).get('token');
		const { response, body } = await api('/api/admin/session', {
			method: 'POST',
			body: JSON.stringify({ token }),
		});
		if (!response.ok) {
			showLogin(body?.error || 'That token is not valid.');
			loginForm.querySelector<HTMLInputElement>('[name="token"]')?.focus();
			return;
		}
		showApp();
		await Promise.all([loadBanner(), loadOverview()]);
	});

	root.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
		await api('/api/admin/session', { method: 'DELETE' });
		showLogin();
	});

	root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((tab) => {
		tab.addEventListener('click', () => {
			const name = tab.dataset.tab;
			root.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
				panel.hidden = panel.dataset.panel !== name;
			});
			root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
				const selected = button.dataset.tab === name;
				button.setAttribute('aria-selected', selected ? 'true' : 'false');
				button.className = selected
					? 'rounded-pill bg-forest px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-white'
					: 'rounded-pill border border-ink/15 bg-white px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink';
			});
		});
	});

	bannerForm.addEventListener('input', () => {
		textCount();
		paintPreview();
		const status = root.querySelector('[data-save-status]');
		if (status && !status.textContent?.startsWith('Saving')) status.textContent = 'Not saved yet';
	});

	bannerForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const status = root.querySelector('[data-save-status]');
		const error = root.querySelector<HTMLElement>('[data-banner-error]');
		if (status) status.textContent = 'Saving…';
		if (error) error.hidden = true;
		const banner = collectBanner();
		const { response, body } = await api('/api/admin/banner', { method: 'PUT', body: JSON.stringify(banner) });
		if (!response.ok) {
			if (error) {
				error.hidden = false;
				error.textContent = body?.error || 'Check the banner fields.';
			}
			if (status) status.textContent = 'Not saved yet';
			return;
		}
		pastBanners = body.history ?? [];
		fillBanner(body.current);
		renderHistory();
		if (status) status.textContent = `All changes saved · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
	});

	const fileInput = root.querySelector<HTMLInputElement>('[data-flyer-input]');
	const uploadFile = async (file: File) => {
		const error = root.querySelector<HTMLElement>('[data-flyer-error]');
		if (error) error.hidden = true;
		if (file.size > 8 * 1024 * 1024) {
			if (error) {
				error.hidden = false;
				error.textContent = 'Flyers need to be 8 MB or smaller.';
			}
			return;
		}
		const form = new FormData();
		form.set('flyer', file);
		const { response, body } = await api('/api/admin/banner/flyer', { method: 'POST', body: form });
		if (!response.ok) {
			if (error) {
				error.hidden = false;
				error.textContent = body?.error || 'That file could not be uploaded.';
			}
			return;
		}
		flyer = body.flyer;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
		const label = root.querySelector('[data-flyer-label]');
		if (label && flyer) label.textContent = `${flyer.name} · ${Math.max(1, Math.round(flyer.size / 1024))} KB`;
		const remove = root.querySelector<HTMLButtonElement>('[data-flyer-remove]');
		if (remove) remove.hidden = false;
		paintPreview();
	};
	fileInput?.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (file) void uploadFile(file);
	});
	const dropzone = root.querySelector<HTMLElement>('[data-dropzone]');
	dropzone?.addEventListener('dragover', (event) => event.preventDefault());
	dropzone?.addEventListener('drop', (event) => {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];
		if (file) void uploadFile(file);
	});
	root.querySelector('[data-flyer-remove]')?.addEventListener('click', () => {
		flyer = null;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = '';
		const label = root.querySelector('[data-flyer-label]');
		if (label) label.textContent = 'Drag a flyer here or choose a file. JPG, PNG, WebP, or PDF · up to 8 MB.';
		const remove = root.querySelector<HTMLButtonElement>('[data-flyer-remove]');
		if (remove) remove.hidden = true;
		paintPreview();
	});

	root.querySelector('[data-add-date]')?.addEventListener('click', () => {
		dates.push({ date: '', startTime: '09:00', endTime: '10:00', capacity: 12, enabled: true, booked: 0 });
		renderDates();
	});
	root.querySelector('[data-use-season]')?.addEventListener('click', () => {
		const booked = new Map(dates.map((date) => [date.date, date.booked ?? 0]));
		dates = suggested.map((date) => ({ ...date, booked: booked.get(date.date) ?? 0 }));
		renderDates();
	});
	root.querySelector('[data-save-dates]')?.addEventListener('click', async () => {
		const error = root.querySelector<HTMLElement>('[data-dates-error]');
		if (error) error.hidden = true;
		const { response, body } = await api('/api/admin/tour-dates', {
			method: 'PUT',
			body: JSON.stringify({
				dates: dates.map((date) => ({
					date: date.date,
					startTime: date.startTime,
					endTime: date.endTime,
					capacity: date.capacity,
					enabled: date.enabled,
				})),
			}),
		});
		if (!response.ok) {
			if (error) {
				error.hidden = false;
				error.textContent = body?.error || 'Those dates could not be saved.';
			}
			return;
		}
		await loadOverview();
	});

	const boot = async () => {
		const params = new URLSearchParams(location.search);
		const token = params.get('token');
		if (token) {
			const { response, body } = await api('/api/admin/session', {
				method: 'POST',
				body: JSON.stringify({ token }),
			});
			params.delete('token');
			const next = `${location.pathname}${params.toString() ? `?${params}` : ''}`;
			history.replaceState({}, '', next);
			if (!response.ok) {
				showLogin(body?.error || 'That token is not valid.');
				return;
			}
		}
		const session = await api('/api/admin/session');
		if (!session.response.ok) {
			showLogin(session.response.status === 503 ? session.body?.error || '' : '');
			return;
		}
		showApp();
		await Promise.all([loadBanner(), loadOverview()]);
	};

	void boot();
}
