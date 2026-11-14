function closeMobileMenu(returnFocus = false) {
  const shell = document.querySelector('.portal-shell');
  const toggle = shell?.querySelector<HTMLButtonElement>('[data-mobile-toggle]');
  shell?.classList.remove('menu-open');
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.setAttribute('aria-label', 'Open menu');
  toggle?.querySelector('[data-menu-lines]')?.setAttribute('d', 'M4 7h16M4 12h16M4 17h16');
  if (returnFocus) toggle?.focus();
}

function closeAccounts(returnFocus = false) {
  document.querySelectorAll<HTMLElement>('[data-account-popover]:popover-open').forEach(popover => popover.hidePopover());
  const sheet = document.querySelector<HTMLElement>('[data-mobile-account]');
  if (sheet && !sheet.hidden) {
    sheet.hidden = true;
    const trigger = document.querySelector<HTMLElement>('[data-mobile-account-toggle]');
    trigger?.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger?.focus({ preventScroll: true });
  }
}

// Delegation keeps controls working immediately after a ClientRouter swap, including
// the persisted sidebar. No hydration or per-navigation listener registration.
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const toggle = event.target.closest<HTMLButtonElement>('[data-mobile-toggle]');
  if (toggle) {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    closeAccounts();
    closeMobileMenu();
    if (open) {
      document.querySelector('.portal-shell')?.classList.add('menu-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      toggle.querySelector('[data-menu-lines]')?.setAttribute('d', 'M6 6l12 12M18 6 6 18');
    }
  }
  if (event.target.closest('[data-mobile-account-toggle]')) {
    closeMobileMenu();
    closeAccounts();
    const sheet = document.querySelector<HTMLElement>('[data-mobile-account]');
    if (sheet) {
      sheet.hidden = false;
      document.querySelector('[data-mobile-account-toggle]')?.setAttribute('aria-expanded', 'true');
      sheet.querySelector<HTMLElement>('.sheet-pop')?.focus({ preventScroll: true });
    }
  }
  const backdrop = event.target.closest<HTMLElement>('.mobile-account');
  if (backdrop && event.target === backdrop) closeAccounts(true);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeAccounts(true);
  if (document.querySelector('.portal-shell.menu-open')) closeMobileMenu(true);
});

document.addEventListener('beforetoggle', (event) => {
  const popover = event.target;
  if (!(popover instanceof HTMLElement) || !popover.matches('[data-account-popover]')) return;
  const open = (event as ToggleEvent).newState === 'open';
  document.querySelector(`[popovertarget="${popover.id}"]`)?.setAttribute('aria-expanded', String(open));
  if (open) {
    closeMobileMenu();
    // Match Ark's top-start placement and 8px gutter, clamped to the viewport.
    if (popover.classList.contains('desktop-account')) {
      const trigger = document.querySelector(`[popovertarget="${popover.id}"]`)!.getBoundingClientRect();
      popover.style.left = `${Math.max(8, Math.min(trigger.left, innerWidth - 308))}px`;
      popover.style.bottom = `${innerHeight - trigger.top + 8}px`;
    }

  }
}, true);

// The browser restores focus for Escape/light dismiss; make backdrop clicks explicit too.
document.addEventListener('toggle', (event) => {
  const popover = event.target;
  if (!(popover instanceof HTMLElement) || !popover.matches('[data-account-popover]')) return;
  if ((event as ToggleEvent).newState === 'closed' && document.activeElement === document.body) {
    document.querySelector<HTMLElement>(`[popovertarget="${popover.id}"]`)?.focus({ preventScroll: true });
  }
}, true);

document.addEventListener('astro:before-swap', () => {
  closeAccounts();
  closeMobileMenu();
});

document.addEventListener('astro:page-load', () => {
  // Persisted markup must follow the new route, including query-string tab navigation.
  const current = document.querySelector('[data-portal-current]')?.getAttribute('data-portal-current');
  document.querySelectorAll<HTMLAnchorElement>('[data-portal-sidebar] .nav a').forEach(link => {
    const active = link.pathname === current;
    link.classList.toggle('on', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
});

// interactions.ts owns submit busy state and all navigation scroll restoration.
