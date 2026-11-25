import type { APIRoute } from 'astro';
import { getBannerDocument, readFlyerBytes } from '@tca/school';

/**
 * The banner's saved flyer, for the preview on Admin → Website (admins only:
 * middleware guards /admin). Served even while the banner is off or outside its
 * dates, unlike the public /api/banner/flyer.
 */
export const prerender = false;
export const GET: APIRoute = async () => {
	const flyer = (await getBannerDocument())?.current?.flyer as { key: string; contentType: string; name: string } | null | undefined;
	const file = flyer ? await readFlyerBytes(flyer.key).catch(() => null) : null;
	if (!flyer || !file || !/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(flyer.contentType)) return new Response('Not found', { status: 404 });
	return new Response(file.data as BodyInit, { headers: {
		'content-type': flyer.contentType, 'content-disposition': `inline; filename="${flyer.name.replace(/[^\w.\- ]+/g, '')}"`,
		'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff',
	} });
};
