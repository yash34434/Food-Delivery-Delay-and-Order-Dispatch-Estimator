/* ==========================================================================
   Motion layer for the Delivery Delay Estimator.
   - Tier detection (full / lite) and reduced-motion handling.
   - One passive scroll listener that writes CSS custom properties on :root,
     batched in requestAnimationFrame.
   - Canvas plates and loops that only run when visible and the tab is active.
   - Per-word splitting and IntersectionObserver reveals.
   No animation library. Only transform and opacity (plus clip-path) move.

   Testing overrides on any URL:
     ?tier=lite      force the lite tier
     ?tier=full      force the full tier
     ?motion=reduced  force reduced motion
   ========================================================================== */
(function () {
    'use strict';

    var root = document.documentElement;
    var params = new URLSearchParams(window.location.search);
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('motion') === 'reduced';
    var forced = params.get('tier');
    var cores = navigator.hardwareConcurrency || 4;
    var memory = navigator.deviceMemory || 4;
    var tier = forced || (cores >= 2 && memory >= 2 ? 'full' : 'lite');

    if (reduced) root.classList.add('motion-reduced');
    root.classList.add('tier-' + tier);
    root.classList.remove('no-js');
    root.classList.add('js');

    function isFull() { return root.classList.contains('tier-full') && !reduced; }
    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function setVar(name, value) { root.style.setProperty(name, value); }

    /* ---------- Per-word split (full tier only) ---------- */
    function splitWords() {
        document.querySelectorAll('[data-split]').forEach(function (el) {
            if (el.dataset.splitDone) return;
            el.dataset.splitDone = '1';
            el.classList.add('split');
            var words = el.textContent.trim().split(/\s+/);
            el.textContent = '';
            words.forEach(function (w, i) {
                var outer = document.createElement('span');
                outer.className = 'w';
                var inner = document.createElement('span');
                inner.className = 'wi';
                inner.textContent = w;
                inner.style.setProperty('--d', (i * 38) + 'ms');
                outer.appendChild(inner);
                el.appendChild(outer);
                el.appendChild(document.createTextNode(' '));
            });
        });
    }

    /* ---------- Reveal groups ---------- */
    var REVEAL = '.card, .tile, .vote, .mechanic, .table-compact tbody tr, .stops li, .cue, .chapter, .rail-card, .slip-row, .meta-row, .nav-link, .btn, .footer-line, details, .rv-target';

    function assignReveals() {
        var groups = new Map();
        document.querySelectorAll(REVEAL).forEach(function (el) {
            var parent = el.parentElement;
            var i = groups.get(parent) || 0;
            groups.set(parent, i + 1);
            el.classList.add('rv');
            el.style.setProperty('--d', (Math.min(i, 8) * 70) + 'ms');
        });
    }

    function observeReveals() {
        var targets = document.querySelectorAll('.rv, [data-split]');
        if (reduced || !('IntersectionObserver' in window)) {
            targets.forEach(function (el) { el.classList.add('in'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('in');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.12 });
        targets.forEach(function (el) { io.observe(el); });
    }

    /* ---------- Canvases ---------- */
    var canvases = [];
    var loopRunning = false;

    function dprCap() { return isFull() ? 1.5 : 1; }

    function registerCanvas(canvas, draw, animated) {
        var entry = { canvas: canvas, ctx: canvas.getContext('2d'), draw: draw, animated: animated, visible: true, w: 0, h: 0 };
        entry.fit = function () {
            var r = canvas.getBoundingClientRect();
            var dpr = Math.min(window.devicePixelRatio || 1, dprCap());
            canvas.width = Math.max(1, Math.round(r.width * dpr));
            canvas.height = Math.max(1, Math.round(r.height * dpr));
            entry.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            entry.w = r.width;
            entry.h = r.height;
            entry.ctx.clearRect(0, 0, entry.w, entry.h);
            entry.draw(entry.ctx, entry.w, entry.h, 0, true);
        };
        canvases.push(entry);
        entry.fit();
        if (entry.animated && isFull()) {
            var io = new IntersectionObserver(function (es) {
                entry.visible = es[0].isIntersecting;
                if (entry.visible) startLoop();
            });
            io.observe(canvas);
        }
        return entry;
    }

    function startLoop() {
        if (loopRunning || document.hidden || !isFull()) return;
        loopRunning = true;
        requestAnimationFrame(frame);
    }

    function frame(now) {
        if (document.hidden) { loopRunning = false; return; }
        var t = now / 1000;
        var any = false;
        canvases.forEach(function (c) {
            if (c.animated && c.visible) {
                c.ctx.clearRect(0, 0, c.w, c.h);
                c.draw(c.ctx, c.w, c.h, t, false);
                any = true;
            }
        });
        if (any) requestAnimationFrame(frame);
        else loopRunning = false;
    }

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) startLoop();
    });

    /* Drawing: hero field (red strokes on loam) */
    function drawField(ctx, w, h, t, first) {
        var cell = 26;
        var cols = Math.ceil(w / cell) + 1;
        var rows = Math.ceil(h / cell) + 1;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'butt';
        for (var j = 0; j < rows; j++) {
            for (var i = 0; i < cols; i++) {
                var phase = Math.sin(t * 0.35 + i * 0.6) * 0.5 + Math.sin(t * 0.21 + j * 0.9) * 0.5;
                var a = 0.05 + 0.14 * (0.5 + 0.5 * phase);
                var angle = 0.6 * phase + (i + j) * 0.12;
                var x = i * cell, y = j * cell;
                var len = 9;
                ctx.strokeStyle = 'rgba(226, 104, 46, ' + a.toFixed(3) + ')';
                ctx.beginPath();
                ctx.moveTo(x - Math.cos(angle) * len / 2, y - Math.sin(angle) * len / 2);
                ctx.lineTo(x + Math.cos(angle) * len / 2, y + Math.sin(angle) * len / 2);
                ctx.stroke();
            }
        }
    }

    /* Drawing: contour lines for the season band */
    function drawContours(ctx, w, h, t) {
        var lines = 22;
        for (var i = 0; i < lines; i++) {
            ctx.beginPath();
            var red = i % 5 === 4;
            ctx.strokeStyle = red ? 'rgba(226, 104, 46, .85)' : 'rgba(19, 35, 27, .22)';
            ctx.lineWidth = red ? 1.6 : 1;
            for (var x = 0; x <= w; x += 8) {
                var y = (h * (i + 1)) / (lines + 1)
                    + 18 * Math.sin(x * 0.012 + t * 0.4 + i * 0.3)
                    + 8 * Math.sin(x * 0.004 - t * 0.2 + i);
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }

    /* Drawing: static generated plates for the rail cards */
    function drawPlate(seed, kind) {
        return function (ctx, w, h) {
            ctx.fillStyle = '#fbfcf7';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(19, 35, 27, .22)';
            ctx.lineWidth = 1;
            if (kind === 'grid') {
                for (var x = 0; x < w; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + ((seed * 7) % 9) - 4, h); ctx.stroke(); }
                for (var k = 0; k < 12; k++) {
                    ctx.fillStyle = k % 4 === seed % 4 ? '#e2682e' : '#13231b';
                    ctx.fillRect((k * 37 + seed * 11) % (w - 8), (k * 53 + seed * 17) % (h - 8), 5, 5);
                }
            } else if (kind === 'contours') {
                for (var i = 0; i < 9; i++) {
                    ctx.beginPath();
                    for (var px = 0; px <= w; px += 6) {
                        var py = h * (i + 1) / 10 + 12 * Math.sin(px * 0.03 + i + seed);
                        if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                    }
                    ctx.strokeStyle = i === 4 ? '#e2682e' : 'rgba(19,35,27,.4)';
                    ctx.stroke();
                }
            } else {
                for (var r = 0; r < 7; r++) {
                    ctx.beginPath();
                    ctx.arc(w * 0.5, h * 0.5, 10 + r * 11, 0, Math.PI * 2);
                    ctx.strokeStyle = r === 3 ? '#e2682e' : 'rgba(19,35,27,.35)';
                    ctx.stroke();
                }
                ctx.fillStyle = '#13231b';
                ctx.fillRect(w * 0.5 - 3, h * 0.5 - 3, 6, 6);
            }
        };
    }

    /* ---------- Scroll-driven variables (one handler, rAF batched) ---------- */
    var stages = {};
    var lastPhase = -1;
    var lastChapter = -1;
    var railOverflow = 0;
    var slipCues = [];
    var chapters = [];
    var ticking = false;

    function measureRail() {
        var track = document.querySelector('.rail-track');
        if (!track) return;
        railOverflow = Math.max(0, track.scrollWidth - window.innerWidth);
        setVar('--rail-overflow', railOverflow + 'px');
    }

    function stageProgress(el) {
        var rect = el.getBoundingClientRect();
        var total = el.offsetHeight - window.innerHeight;
        if (total <= 0) return 0;
        return clamp(-rect.top / total, 0, 1);
    }

    function updateSlip(phase) {
        var values = {
            order: document.getElementById('slip-order'),
            time: document.getElementById('slip-time'),
            risk: document.getElementById('slip-risk'),
            test: document.getElementById('slip-test'),
        };
        var pred = document.getElementById('pred-minutes');
        var prob = document.getElementById('pred-prob');
        var label = document.getElementById('risk-label');
        if (values.time) values.time.textContent = phase >= 1 && pred ? pred.textContent + ' min' : 'pending';
        if (values.risk) values.risk.textContent = phase >= 2 && label ? label.textContent.trim().replace(/ risk$/i, '') : 'pending';
        if (values.test) values.test.textContent = phase >= 3 && prob ? prob.textContent + '%' : 'pending';
    }

    var STATUS = ['Awaiting order', 'Estimating delivery time', 'Scoring delay risk', 'Slip ready to print'];

    function applyPhase(phase) {
        slipCues.forEach(function (cue, i) { cue.classList.toggle('on', i <= phase); });
        var status = document.getElementById('route-status');
        if (status) status.textContent = STATUS[phase];
        updateSlip(phase);
        var meter = document.getElementById('packet-phase');
        if (meter) meter.textContent = 'Step ' + (phase + 1) + ' of 4';
    }

    // Called by main.js after a prediction arrives, so the slip shows live values
    function predicted() {
        var phase = isFull() ? Math.max(0, lastPhase) : 3;
        updateSlip(phase);
    }

    function applyChapter(index) {
        chapters.forEach(function (c, i) { c.classList.toggle('is-on', i === index); });
    }

    function updateScroll() {
        ticking = false;
        if (!isFull()) return;

        var hero = stages.hero;
        if (hero) {
            var h = stageProgress(hero);
            setVar('--hero-type-y', (-90 * h) + 'px');
            setVar('--hero-type-scale', (1 - 0.26 * h).toFixed(4));
            setVar('--hero-type-alpha', (1 - h).toFixed(4));
            setVar('--hero-meta', (1 - h * 0.9).toFixed(4));
        }

        var manifesto = stages.manifesto;
        if (manifesto) {
            var m = stageProgress(manifesto);
            setVar('--manifesto-wipe', (m * 100).toFixed(2) + '%');
            setVar('--manifesto-scale', (1 + 0.05 * m).toFixed(4));
        }

        var rail = stages.rail;
        if (rail) {
            var r = stageProgress(rail);
            setVar('--rail-x', (-r * railOverflow).toFixed(1) + 'px');
            setVar('--rail-meter', r.toFixed(4));
        }

        var packet = stages.packet;
        if (packet) {
            var p = stageProgress(packet);
            setVar('--packet-alpha', clamp(p * 4, 0, 1).toFixed(4));
            setVar('--packet-enter', (38 * (1 - clamp(p * 3, 0, 1))).toFixed(2) + 'px');
            setVar('--packet-scale', (0.78 + 0.22 * clamp(p * 2.5, 0, 1)).toFixed(4));
            setVar('--packet-cut', clamp((p - 0.8) * 5, 0, 1).toFixed(4));
            setVar('--packet-meter', p.toFixed(4));
            setVar('--packet-copy-x', (-20 * p).toFixed(2) + 'px');
            var phase = Math.min(3, Math.floor(p * 4));
            if (phase !== lastPhase) { lastPhase = phase; applyPhase(phase); }
        }

        var season = stages.season;
        if (season) {
            var s = stageProgress(season);
            setVar('--season-y', (-4 + 8 * s).toFixed(3) + '%');
            setVar('--season-scale', (1.10 - 0.045 * s).toFixed(4));
            var chapter = Math.min(2, Math.floor(s * 3));
            if (chapter !== lastChapter) { lastChapter = chapter; applyChapter(chapter); }
        }
    }

    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateScroll);
    }

    /* ---------- Frame-time check: downgrade to lite on slow devices ---------- */
    function frameCheck() {
        if (forced || !isFull()) return;
        var samples = [];
        var last = performance.now();
        function sample(now) {
            samples.push(now - last);
            last = now;
            if (samples.length < 60) { requestAnimationFrame(sample); return; }
            var avg = samples.slice(5).reduce(function (a, b) { return a + b; }, 0) / (samples.length - 5);
            if (avg > 24) {
                root.classList.remove('tier-full');
                root.classList.add('tier-lite');
                tier = 'lite';
                updateScroll();
            }
        }
        requestAnimationFrame(sample);
    }

    /* ---------- Init ---------- */
    function init() {
        if (isFull()) splitWords();
        assignReveals();

        stages.hero = document.querySelector('[data-stage="hero"]');
        stages.manifesto = document.querySelector('[data-stage="manifesto"]');
        stages.rail = document.querySelector('[data-stage="rail"]');
        stages.packet = document.querySelector('[data-stage="packet"]');
        stages.season = document.querySelector('[data-stage="season"]');
        slipCues = Array.prototype.slice.call(document.querySelectorAll('.cue'));
        chapters = Array.prototype.slice.call(document.querySelectorAll('.chapter'));

        document.querySelectorAll('canvas[data-plate]').forEach(function (cv) {
            registerCanvas(cv, drawPlate(parseInt(cv.dataset.seed || '1', 10), cv.dataset.plate), false);
        });
        document.querySelectorAll('canvas[data-field]').forEach(function (cv) {
            registerCanvas(cv, drawField, true);
        });
        document.querySelectorAll('canvas[data-contours]').forEach(function (cv) {
            registerCanvas(cv, drawContours, true);
        });

        measureRail();
        observeReveals();
        applyChapter(isFull() ? 0 : 2);
        applyPhase(isFull() ? 0 : 3);
        window.MotionHooks = { predicted: predicted };
        window.addEventListener('scroll', onScroll, { passive: true });
        updateScroll();
        startLoop();
        frameCheck();

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                canvases.forEach(function (c) { c.fit(); });
                measureRail();
                updateScroll();
            }, 150);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
