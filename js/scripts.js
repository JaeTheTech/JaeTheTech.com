/* ═══════════════════════════════════════════════════════
   JaeTheTech.com — Scripts
   Mobile nav + scroll-reveal observer
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Mobile Nav Toggle ───────────────────────────────── */
  const toggle = document.querySelector('.nav-toggle');
  const links  = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
    });

    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('open');
      });
    });
  }

  /* ── Scroll-Reveal (IntersectionObserver) ────────────── */
  var reveals = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && reveals.length) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    reveals.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    /* Fallback — show everything immediately */
    reveals.forEach(function (el) {
      el.classList.add('visible');
    });
  }
})();
