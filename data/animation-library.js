/* ============================================================
   ReeveOS Design Engine — Animation & Interaction Library (JS)
   ============================================================
   Drop this into any generated page. Self-initialising.
   No dependencies. No frameworks.
   ============================================================ */

(function() {
  'use strict';

  // ─── SCROLL REVEAL (IntersectionObserver) ───
  function initReveal() {
    var els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (!els.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(function(el) { el.classList.add('visible'); });
      return;
    }
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function(el) { observer.observe(el); });
  }

  // ─── NAV SCROLL EFFECT ───
  function initNavScroll() {
    var nav = document.querySelector('.nav-float');
    if (!nav) return;
    var scrolled = false;
    function check() {
      var shouldScroll = window.scrollY > 60;
      if (shouldScroll !== scrolled) {
        scrolled = shouldScroll;
        nav.classList.toggle('scrolled', scrolled);
      }
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  // ─── PARALLAX ───
  function initParallax() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var slow = document.querySelectorAll('.parallax-slow');
    var medium = document.querySelectorAll('.parallax-medium');
    var fast = document.querySelectorAll('.parallax-fast');
    if (!slow.length && !medium.length && !fast.length) return;

    var ticking = false;
    function update() {
      var scrollY = window.scrollY;
      slow.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        var center = rect.top + rect.height / 2;
        var offset = (center - window.innerHeight / 2) * 0.05;
        el.style.transform = 'translateY(' + offset + 'px)';
      });
      medium.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        var center = rect.top + rect.height / 2;
        var offset = (center - window.innerHeight / 2) * 0.1;
        el.style.transform = 'translateY(' + offset + 'px)';
      });
      fast.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        var center = rect.top + rect.height / 2;
        var offset = (center - window.innerHeight / 2) * 0.2;
        el.style.transform = 'translateY(' + offset + 'px)';
      });
      ticking = false;
    }

    window.addEventListener('scroll', function() {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  }

  // ─── COUNTER ANIMATION ───
  function initCounters() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('[data-count-to]').forEach(function(el) {
        el.textContent = el.getAttribute('data-count-to');
      });
      return;
    }
    var counters = document.querySelectorAll('[data-count-to]');
    if (!counters.length) return;

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var target = parseInt(el.getAttribute('data-count-to'), 10);
        var prefix = el.getAttribute('data-count-prefix') || '';
        var suffix = el.getAttribute('data-count-suffix') || '';
        var duration = parseInt(el.getAttribute('data-count-duration'), 10) || 2000;
        var startTime = performance.now();

        function ease(t) { return 1 - Math.pow(1 - t, 4); }

        function tick(now) {
          var elapsed = now - startTime;
          var progress = Math.min(elapsed / duration, 1);
          var value = Math.round(ease(progress) * target);
          el.textContent = prefix + value.toLocaleString() + suffix;
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    }, { threshold: 0.3 });

    counters.forEach(function(el) { observer.observe(el); });
  }

  // ─── SCROLL PROGRESS BAR ───
  function initScrollProgress() {
    var bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    function update() {
      var scrollTop = window.scrollY;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var progress = docHeight > 0 ? scrollTop / docHeight : 0;
      bar.style.transform = 'scaleX(' + progress + ')';
    }
    window.addEventListener('scroll', update, { passive: true });
  }

  // ─── SMOOTH SCROLL FOR ANCHOR LINKS ───
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
      anchor.addEventListener('click', function(e) {
        var targetId = this.getAttribute('href');
        if (targetId === '#') return;
        var target = document.querySelector(targetId);
        if (!target) return;
        e.preventDefault();
        var navHeight = 80;
        var y = target.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top: y, behavior: 'smooth' });
      });
    });
  }

  // ─── IMAGE LAZY LOADING ENHANCEMENT ───
  function initLazyImages() {
    document.querySelectorAll('img[data-src]').forEach(function(img) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            observer.unobserve(img);
          }
        });
      }, { rootMargin: '200px' });
      observer.observe(img);
    });
  }

  // ─── ACCORDION / FAQ ───
  function initAccordions() {
    document.querySelectorAll('.accordion-trigger').forEach(function(trigger) {
      trigger.addEventListener('click', function() {
        var item = this.closest('.accordion-item') || this.closest('details');
        if (!item) return;
        // Close siblings (single-open mode)
        var parent = item.parentElement;
        if (parent && parent.classList.contains('accordion-single')) {
          parent.querySelectorAll('.accordion-item[open], details[open]').forEach(function(other) {
            if (other !== item) other.removeAttribute('open');
          });
        }
      });
    });
  }

  // ─── MARQUEE PAUSE ON HOVER ───
  function initMarquee() {
    document.querySelectorAll('.marquee').forEach(function(marquee) {
      var track = marquee.querySelector('.marquee-track');
      if (!track) return;
      // Duplicate content for seamless loop
      if (!track.getAttribute('data-duped')) {
        track.innerHTML = track.innerHTML + track.innerHTML;
        track.setAttribute('data-duped', 'true');
      }
    });
  }

  // ─── INITIALISE ALL ───
  function init() {
    initReveal();
    initNavScroll();
    initParallax();
    initCounters();
    initScrollProgress();
    initSmoothScroll();
    initLazyImages();
    initAccordions();
    initMarquee();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
