// Vite embeds a digest of the public CSS contents at build time.
export const cssVersion = import.meta.env.PORTAL_CSS_VERSION;
export const cssHref = (file: string) => `/css/${file}?v=${cssVersion}`;
