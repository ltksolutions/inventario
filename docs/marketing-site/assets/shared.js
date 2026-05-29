/*
 * SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
 * SPDX-License-Identifier: CC-BY-4.0
 *
 * Inventario marketing site — shared layout (nav + footer).
 * Injekuje sa do <body> každej stránky pri load. Aktuálna stránka
 * sa určuje cez data-page attribute na <body>.
 */

(function () {
  'use strict';

  const NAV_LINKS = [
    { href: '/', page: 'home', label: 'Domov' },
    { href: '/use-cases', page: 'use-cases', label: 'Pre koho' },
    { href: '/interactive-demo', page: 'demo', label: 'Demo' },
    { href: '/pricing', page: 'pricing', label: 'Cenník' },
    { href: '/technology', page: 'technology', label: 'Technológia' },
    { href: '/about', page: 'about', label: 'O projekte' },
  ];

  const EXTERNAL_LINKS = {
    app: 'https://app.inventario.estate',
    docs: 'https://docs.inventario.estate',
    github: 'https://github.com/ltksolutions/inventario',
    sportup: 'https://sportup.sk',
    email: 'inventario@ltk.solutions',
  };

  const LOGO_SVG = `
        <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <!-- Inventario logo: stacked inventory items / asset layers -->
            <!-- Three horizontal bars of decreasing width representing inventoried items -->
            <rect x="5" y="7"  width="22" height="4" rx="1" fill="currentColor" opacity="0.95"/>
            <rect x="5" y="14" width="17" height="4" rx="1" fill="currentColor" opacity="0.75"/>
            <rect x="5" y="21" width="12" height="4" rx="1" fill="currentColor" opacity="0.55"/>
            <!-- Accent dot on right side: "active asset" / status indicator -->
            <circle cx="25" cy="23" r="2.2" fill="#388fc3"/>
        </svg>
    `;

  function buildNav(activePage) {
    const linksHtml = NAV_LINKS.map(
      (link) => `
            <a href="${link.href}" class="nav-link ${link.page === activePage ? 'active' : ''}">${link.label}</a>
        `,
    ).join('');

    const mobileLinksHtml = NAV_LINKS.map(
      (link) => `
            <a href="${link.href}" class="nav-link ${link.page === activePage ? 'active' : ''}">${link.label}</a>
        `,
    ).join('');

    return `
            <nav class="nav" id="site-nav">
                <div class="nav-inner">
                    <a href="/" class="nav-brand">
                        <span class="nav-brand-icon">${LOGO_SVG}</span>
                        <span class="nav-brand-text">
                            <div class="nav-brand-name">Inventario</div>
                            <div class="nav-brand-tag">Open asset management</div>
                        </span>
                    </a>
                    <div class="nav-links">${linksHtml}</div>
                    <div class="nav-right">
                        <a href="${EXTERNAL_LINKS.docs}" class="nav-link" target="_blank" rel="noopener">
                            Dokumentácia
                        </a>
                        <a href="${EXTERNAL_LINKS.github}" class="nav-link" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub repository">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -3px" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.04-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4 1.02 0 2.04.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.81 1.1.81 2.22 0 1.61-.01 2.91-.01 3.3 0 .32.22.7.83.58C20.57 21.79 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
                        </a>
                        <div class="lang-switch" role="group" aria-label="Voľba jazyka">
                            <button class="active" data-lang="sk" aria-pressed="true">SK</button>
                            <button disabled data-lang="en" aria-label="English (čoskoro)" title="Čoskoro">EN</button>
                        </div>
                        <a href="${EXTERNAL_LINKS.app}" class="btn btn-primary" style="padding: 0.55rem 1rem; font-size: 0.85rem;">
                            Otvoriť aplikáciu
                        </a>
                        <button class="nav-mobile-toggle" id="nav-mobile-toggle" aria-label="Otvoriť menu" aria-expanded="false" aria-controls="site-nav">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
                        </button>
                    </div>
                </div>
                <div class="nav-mobile-menu">
                    ${mobileLinksHtml}
                    <a href="${EXTERNAL_LINKS.docs}" class="nav-link" target="_blank" rel="noopener">
                        Dokumentácia <span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span>
                    </a>
                    <a href="${EXTERNAL_LINKS.github}" class="nav-link" target="_blank" rel="noopener">GitHub <span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span></a>
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; margin-top: 0.25rem;">
                        <div class="lang-switch" role="group" aria-label="Voľba jazyka">
                            <button class="active" data-lang="sk" aria-pressed="true">SK</button>
                            <button disabled data-lang="en" aria-label="English (čoskoro)" title="Čoskoro">EN</button>
                        </div>
                        <a href="${EXTERNAL_LINKS.app}" class="btn btn-primary" style="padding: 0.55rem 1rem; font-size: 0.85rem;">
                            Otvoriť aplikáciu
                        </a>
                    </div>
                </div>
            </nav>
        `;
  }

  function buildFooter() {
    return `
            <footer class="footer">
                <div class="footer-inner">
                    <div class="footer-grid">
                        <div class="footer-brand">
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                <span class="nav-brand-icon" style="background: rgba(255,255,255,0.12); box-shadow: none;">${LOGO_SVG}</span>
                                <div class="wordmark" style="color: white; font-size: 1.5rem;">Inventario</div>
                            </div>
                            <p class="footer-tagline">
                                Otvorená multi-tenant platforma pre evidenciu a vypožičiavanie majetku. Bez <span lang="en">vendor lock-in</span>.
                            </p>
                            <div style="display: flex; gap: 0.5rem; margin-top: 1.25rem; flex-wrap: wrap;">
                                <span class="badge badge-white">🇪🇺 EUPL-1.2</span>
                                <span class="badge badge-white">✓ REUSE 3.3</span>
                                <span class="badge badge-white">🔒 GDPR</span>
                            </div>
                        </div>
                        <div>
                            <h4 class="footer-heading">Produkt</h4>
                            <ul class="footer-links">
                                <li><a href="/">Domov</a></li>
                                <li><a href="/use-cases">Pre koho</a></li>
                                <li><a href="/pricing">Cenník</a></li>
                                <li><a href="/technology">Technológia</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 class="footer-heading">Zdroje</h4>
                            <ul class="footer-links">
                                <li><a href="${EXTERNAL_LINKS.docs}" target="_blank" rel="noopener">Dokumentácia <span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span></a></li>
                                <li><a href="${EXTERNAL_LINKS.github}" target="_blank" rel="noopener">GitHub repo <span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span></a></li>
                                <li><a href="/interactive-demo">Demo aplikácie</a></li>
                                <li><a href="${EXTERNAL_LINKS.docs}/architecture" target="_blank" rel="noopener">Architektúra <span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span></a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 class="footer-heading">Kontakt</h4>
                            <ul class="footer-links">
                                <li><a href="mailto:${EXTERNAL_LINKS.email}">${EXTERNAL_LINKS.email}</a></li>
                                <li><a href="/about">O projekte</a></li>
                                <li><a href="${EXTERNAL_LINKS.sportup}" target="_blank" rel="noopener">${EXTERNAL_LINKS.sportup} <span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span></a></li>
                            </ul>
                            <h4 class="footer-heading" style="margin-top: 1.5rem;">Právne</h4>
                            <ul class="footer-links">
                                <li><a href="/sub-processors">Sub-procesori (GDPR)</a></li>
                            </ul>
                        </div>
                    </div>
                    <div class="footer-bottom">
                        <div class="footer-license">
                            v0.3 · EUPL-1.2 · © 2026 LTK Solutions
                        </div>
                        <div class="footer-ecosystem">
                            Member of the
                            <a href="${EXTERNAL_LINKS.sportup}" target="_blank" rel="noopener">SportUp</a>
                            ecosystem
                        </div>
                    </div>
                </div>
            </footer>
        `;
  }

  function init() {
    const body = document.body;
    const activePage = body.getAttribute('data-page') || 'home';

    // Insert skip-link as the very first body element (WCAG 2.4.1
    // Bypass Blocks). Targets #main which every marketing page wraps
    // around its content sections.
    body.insertAdjacentHTML(
      'afterbegin',
      '<a class="skip-link" href="#main">Preskočiť na hlavný obsah</a>',
    );

    // Insert nav after skip-link
    document.querySelector('.skip-link').insertAdjacentHTML('afterend', buildNav(activePage));

    // Insert footer at end
    body.insertAdjacentHTML('beforeend', buildFooter());

    // Mobile menu toggle
    const toggle = document.getElementById('nav-mobile-toggle');
    const nav = document.getElementById('site-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('mobile-open');
        toggle.setAttribute('aria-expanded', String(isOpen));
      });
    }

    // Language switcher placeholder behavior
    document.querySelectorAll('.lang-switch button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        // Future: switch language
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
