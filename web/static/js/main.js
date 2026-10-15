const $ = id => document.getElementById(id);


function themeColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function plot(id, data, layout) {
    const muted = themeColor('--muted');
    const line = themeColor('--line');
    const axis = {
        gridcolor: line, zerolinecolor: line, linecolor: themeColor('--ink'),
        tickfont: { family: themeColor('--mono') || 'monospace', size: 10.5, color: muted },
        titlefont: { family: themeColor('--sans') || 'sans-serif', size: 12, color: muted },
    };
    const base = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: muted, family: getComputedStyle(document.body).fontFamily, size: 12 },
        hovermode: 'closest',
        margin: { l: 50, r: 16, t: 10, b: 44 },
        showlegend: false,
    };
    const merged = Object.assign(base, layout);
    merged.hoverlabel = { font: { family: base.font.family } };
    merged.xaxis = Object.assign({}, axis, layout.xaxis);
    merged.yaxis = Object.assign({}, axis, layout.yaxis);
    Plotly.react(id, data, merged, { responsive: true, displayModeBar: false });
}

/* Predict page */

function initPredictPage() {
    const form = $('prediction-form');
    let timer = null;

    form.querySelectorAll('input[type=range]').forEach(slider => {
        slider.addEventListener('input', () => { $(slider.id + '-val').textContent = slider.value; });
    });
    form.addEventListener('input', e => {
        syncDropFields();
        if (e.target === $('start_node') || e.target === document.querySelector('.drop-field select')) syncTripDistance();
        clearTimeout(timer);
        timer = setTimeout(runPrediction, 200);
    });
    form.addEventListener('submit', e => e.preventDefault());
    syncDropFields();
    syncTripDistance();
    runPrediction();
}

function haversineKm(a, b) {
    const rad = d => d * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
        + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The model was trained on straight-line restaurant-to-customer distance, so feed it the same thing
function syncTripDistance() {
    const pickup = PLACES[$('start_node').value];
    const drop = PLACES[document.querySelector('.drop-field select').value];
    const slider = $('distance_km');
    slider.value = Math.max(0.5, haversineKm(pickup, drop)).toFixed(1);
    $('distance_km-val').textContent = slider.value;
}

// One drop-off for the main order plus one per stacked order
function syncDropFields() {
    const count = 1 + parseInt($('multiple_deliveries').value, 10);
    document.querySelectorAll('.drop-field').forEach((field, i) => { field.hidden = i >= count; });
}

function runPrediction() {
    const payload = {};
    new FormData($('prediction-form')).forEach((value, key) => {
        payload[key] = isNaN(value) || value === '' ? value : parseFloat(value);
    });
    payload.drops = [...document.querySelectorAll('.drop-field:not([hidden]) select')].map(s => s.value);

    fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json())
        .then(data => {
            if (data.status !== 'success') return;
            showEstimate(data.prediction);
            showRoutes(data.search_comparison, data.map, data.stops);
        })
        .catch(err => console.error('predict failed', err));
}

function showEstimate(pred) {
    $('pred-minutes').textContent = pred.predicted_minutes;
    $('pred-prob').textContent = pred.delay_probability_pct;
    if (window.MotionHooks) window.MotionHooks.predicted();

    const tier = pred.delay_risk_tier.toLowerCase();
    const colors = { low: '--good', moderate: '--warn', high: '--bad' };
    $('risk-label').className = 'risk ' + tier;
    $('prob-tile').className = 'tile risk-' + tier;
    $('risk-label').textContent = pred.delay_risk_tier + ' risk';
    $('prob-bar').style.width = pred.delay_probability_pct + '%';
    $('prob-bar').style.background = themeColor(colors[tier]);

    const votes = {
        'm-rf': pred.rf_prediction,
        'm-dt-gini': pred.tree_gini_prediction,
        'm-dt-entropy': pred.tree_entropy_prediction,
        'm-lr': pred.logistic_prediction,
    };
    Object.entries(votes).forEach(([id, late]) => {
        $(id).textContent = late ? 'Late' : 'On time';
        $(id).className = late ? 'late' : 'ok';
    });
}

function stopClass(id, stops) {
    if (id === stops[0]) return 'pickup';
    return stops.includes(id) ? 'drop' : '';
}

function showRoutes(results, map, stops) {
    const [astar, greedy] = results;
    $('route-stops').innerHTML = astar.path
        .map((id, i) => `<li class="${stopClass(id, stops)}">${astar.path_names[i]}</li>`)
        .join('');

    const cheapest = Math.min(...results.map(r => r.path_cost));
    $('search-comparison-body').innerHTML = results.map(r => `
        <tr class="${r === astar ? 'best' : ''}">
            <td>${r.algorithm}</td>
            <td>${r.nodes_expanded}</td>
            <td>${r.total_distance_km} km</td>
            <td>${r.estimated_time_min} min</td>
            <td>${r.path_cost}${r.path_cost > cheapest ? '' : ' <span class="muted">(best)</span>'}</td>
        </tr>`).join('');

    drawRouteMap(map, astar, greedy, stops);
}

const BASEMAP = {
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};
let routeMap = null;
let mapReady = false;
let pendingRoute = null;
const stopMarkers = {};

const line = coords => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

function initRouteMap(map) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    routeMap = new maplibregl.Map({
        container: 'route-map',
        style: dark ? BASEMAP.dark : BASEMAP.light,
        center: [72.865, 19.08],
        zoom: 11,
        attributionControl: { compact: true },
    });
    routeMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    routeMap.fitBounds([[72.805, 18.99], [72.92, 19.175]], { padding: 30, duration: 0 });

    map.nodes.forEach(n => {
        const el = document.createElement('div');
        el.className = 'stop-marker';
        el.innerHTML = '<span></span>' + n.name;
        stopMarkers[n.id] = el;
        new maplibregl.Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat([n.lon, n.lat]).addTo(routeMap);
    });

    routeMap.on('load', () => {
        const empty = { type: 'FeatureCollection', features: [] };
        ['roads', 'greedy', 'astar'].forEach(id => routeMap.addSource(id, { type: 'geojson', data: empty }));
        routeMap.addLayer({
            id: 'roads', type: 'line', source: 'roads',
            layout: { 'line-cap': 'round' },
            paint: {
                'line-width': 3,
                'line-opacity': 0.7,
                'line-color': ['match', ['get', 'traffic'],
                    'Low', themeColor('--green'), 'High', themeColor('--saffron'), 'Jam', themeColor('--bad'),
                    themeColor('--muted')],
            },
        });
        routeMap.addLayer({
            id: 'greedy', type: 'line', source: 'greedy',
            paint: { 'line-color': themeColor('--violet'), 'line-width': 3, 'line-dasharray': [1, 1.5] },
        });
        routeMap.addLayer({
            id: 'astar', type: 'line', source: 'astar',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': themeColor('--teal'), 'line-width': 6 },
        });
        mapReady = true;
        if (pendingRoute) drawRouteMap(...pendingRoute);
    });
}

// Reveal the A* path segment by segment (full tier only; lite draws it at once)
function animateRoute(coords) {
    const full = document.documentElement.classList.contains('tier-full') && !prefersReducedMotion();
    if (!full || coords.length < 3) {
        routeMap.getSource('astar').setData(line(coords));
        return;
    }
    const start = performance.now();
    const duration = 900;
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        const n = Math.max(2, Math.round(coords.length * e));
        routeMap.getSource('astar').setData(line(coords.slice(0, n)));
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function drawRouteMap(map, astar, greedy, stops) {
    if (!routeMap) initRouteMap(map);
    if (!mapReady) {
        pendingRoute = [map, astar, greedy, stops];
        return;
    }
    routeMap.getSource('roads').setData({
        type: 'FeatureCollection',
        features: map.edges.map(e => Object.assign(line(e.coords), { properties: { traffic: e.traffic } })),
    });
    routeMap.getSource('greedy').setData(line(greedy.coords));
    animateRoute(astar.coords);

    const onPath = new Set(astar.path);
    // Toggle only our classes; MapLibre keeps its positioning classes on the same element
    Object.entries(stopMarkers).forEach(([id, el]) => {
        const role = stopClass(id, stops);
        el.classList.toggle('on-path', onPath.has(id));
        el.classList.toggle('pickup', role === 'pickup');
        el.classList.toggle('drop', role === 'drop');
    });
}

/* Retrain page */

function initRetrainPage() {
    const form = $('retrain-form');
    form.querySelectorAll('input[name=dataset_choice]').forEach(radio => {
        radio.addEventListener('change', () => { $('custom-file-group').hidden = radio.value !== 'custom'; });
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        const btn = $('btn-retrain');
        btn.disabled = true;
        btn.textContent = 'Retraining...';
        $('retrain-error').hidden = true;

        fetch('/api/retrain', { method: 'POST', body: new FormData(form) })
            .then(res => res.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.message || 'Retraining failed.');
                showRetrainResult(data);
            })
            .catch(err => {
                $('retrain-error').textContent = err.message;
                $('retrain-error').hidden = false;
            })
            .finally(() => {
                btn.disabled = false;
                btn.textContent = 'Retrain models';
            });
    });
}

function showRetrainResult(data) {
    const before = Object.fromEntries(data.previous_metrics.classification.map(m => [m.model_name, m.accuracy]));
    const delta = data.accuracy_delta;

    $('meta-samples').textContent = data.samples_trained;
    $('meta-timestamp').textContent = data.timestamp;
    $('prev-col').hidden = false;
    $('retrain-summary').innerHTML =
        `Added ${data.rows_added} rows in ${data.training_time_seconds}s. Random forest accuracy ` +
        `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta} points</span>.`;

    $('metrics-table-body').innerHTML = data.updated_metrics.classification.map(m => `
        <tr>
            <td>${m.model_name}</td>
            <td>${m.accuracy}%</td>
            <td class="muted">${before[m.model_name] ?? '--'}%</td>
            <td>${m.precision}%</td>
            <td>${m.recall}%</td>
            <td>${m.f1_score}%</td>
            <td>${m.roc_auc}</td>
        </tr>`).join('');

    const reg = data.updated_metrics.regression;
    $('reg-mae').textContent = reg.mae + ' min';
    $('reg-rmse').textContent = reg.rmse + ' min';
    $('reg-r2').textContent = reg.r2_score;

    // Briefly highlight what changed so the update is easy to spot
    ['reg-mae', 'reg-rmse', 'reg-r2'].forEach(id => flashOnce($(id)));
    $('metrics-table-body').querySelectorAll('tr').forEach(flashOnce);
}

function flashOnce(el) {
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
    el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
}

/* Motion helpers */

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isDark = () => false;

// Ease a single trace from its start to its final values over `duration` ms
function animateTrace(id, traceIndex, key, buildAt, duration = 900) {
    if (prefersReducedMotion() || !$(id)) return;
    const start = performance.now();
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        Plotly.restyle(id, { [key]: [buildAt(e)] }, [traceIndex]);
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// Run `fn` once, when the element first scrolls into view
function onFirstView(el, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver((entries, obs) => {
        if (entries.some(e => e.isIntersecting)) {
            obs.disconnect();
            fn();
        }
    }, { threshold: 0.25 });
    io.observe(el);
}

/* How it works page */

function initExplainCharts(metrics, clusters, featureImportances) {
    const accent = themeColor('--accent');
    const ink = themeColor('--ink');
    const teal = themeColor('--teal');
    const violet = themeColor('--violet');
    const gold = themeColor('--saffron');
    const green = themeColor('--green');
    const rf = metrics.classification[0];
    const dark = isDark();
    const motion = !prefersReducedMotion();

    /* Confusion matrix: clear light-to-deep teal scale, gaps between cells,
       and text colour chosen per cell so every count stays readable */
    const cm = rf.confusion_matrix;
    const labels = ['On time', 'Late'];
    const values = [cm.tn, cm.fp, cm.fn, cm.tp];
    const maxCount = Math.max(...values);
    const scale = [[0, '#eaede4'], [1, ink]];
    const cellText = n => (n / maxCount > 0.55 ? '#fbfcf7' : ink);
    plot('confusion-matrix-chart', [{
        z: [[cm.tn, cm.fp], [cm.fn, cm.tp]],
        x: labels,
        y: labels,
        type: 'heatmap',
        colorscale: scale,
        zmin: 0,
        zmax: maxCount,
        xgap: 4,
        ygap: 4,
        showscale: false,
        hoverinfo: 'skip',
    }], {
        margin: { l: 80, r: 16, t: 10, b: 44 },
        xaxis: { title: 'Predicted', side: 'bottom' },
        yaxis: { title: 'Actual', autorange: 'reversed' },
        annotations: [
            ['On time', 'On time', 'TN', cm.tn], ['Late', 'On time', 'FP', cm.fp],
            ['On time', 'Late', 'FN', cm.fn], ['Late', 'Late', 'TP', cm.tp],
        ].map(([x, y, tag, n]) => ({
            x, y,
            text: `${tag}<br><b>${n.toLocaleString()}</b>`,
            showarrow: false,
            font: { color: cellText(n), size: 14 },
        })),
    });

    /* ROC: draws from the origin once, on page load */
    const rocX = rf.roc_curve.map(p => p.fpr);
    const rocY = rf.roc_curve.map(p => p.tpr);
    plot('roc-curve-chart', [
        { x: [0, 1], y: [0, 1], mode: 'lines', line: { dash: 'dot', color: themeColor('--muted'), width: 1 }, hoverinfo: 'skip' },
        { x: motion ? [] : rocX, y: motion ? [] : rocY, mode: 'lines', line: { color: accent, width: 2.5 } },
    ], {
        xaxis: { title: 'False positive rate', range: [0, 1] },
        yaxis: { title: 'True positive rate', range: [0, 1.02] },
    });
    if (motion) {
        // Thin the curve for the animation (shape is unchanged) and redraw once per frame
        const step = Math.max(1, Math.ceil(rocX.length / 250));
        const xs = rocX.filter((_, i) => i % step === 0 || i === rocX.length - 1);
        const ys = rocY.filter((_, i) => i % step === 0 || i === rocY.length - 1);
        const start = performance.now();
        const frame = now => {
            const t = Math.min(1, (now - start) / 1000);
            const k = Math.max(2, Math.round(xs.length * (1 - Math.pow(1 - t, 3))));
            Plotly.restyle('roc-curve-chart', { x: [xs.slice(0, k)], y: [ys.slice(0, k)] }, [1]);
            if (t < 1) requestAnimationFrame(frame);
            else Plotly.restyle('roc-curve-chart', { x: [rocX], y: [rocY] }, [1]);
        };
        requestAnimationFrame(frame);
    }

    /* K-Means elbow: the WCSS curve rises into place when scrolled into view */
    const elbowX = clusters.elbow_data.map(d => d.k);
    const elbowY = clusters.elbow_data.map(d => d.inertia);
    const elbowSize = clusters.elbow_data.map(d => (d.k === 3 ? 12 : 7));
    const elbowColor = clusters.elbow_data.map(d => (d.k === 3 ? accent : violet));
    plot('elbow-chart', [{
        x: elbowX,
        y: motion ? elbowY.map(() => 0) : elbowY,
        mode: 'lines+markers',
        line: { color: violet, width: 2 },
        marker: { size: elbowSize, color: elbowColor },
    }], {
        xaxis: { title: 'k', dtick: 1 },
        yaxis: { title: 'WCSS' },
    });
    if (motion) {
        onFirstView($('elbow-chart'), () => animateTrace('elbow-chart', 0, 'y', e => elbowY.map(v => v * e), 1100));
    }

    /* PCA scatter: three cluster colours, coloured by rank */
    const palette = [green, gold, violet];
    plot('pca-scatter-chart', clusters.profiles.map((prof, rank) => {
        const pts = clusters.pca_points.filter(p => p.cluster === prof.cluster_id);
        return {
            name: prof.name,
            x: pts.map(p => p.x),
            y: pts.map(p => p.y),
            text: pts.map(p => `${p.time} min, ${p.distance.toFixed(1)} km`),
            mode: 'markers',
            hoverinfo: 'text',
            marker: { size: 5, color: palette[rank % palette.length], opacity: 0.75 },
        };
    }), {
        showlegend: true,
        legend: { orientation: 'h', y: 1.08, x: 0 },
        margin: { l: 50, r: 16, t: 30, b: 44 },
        xaxis: { title: 'PC 1' },
        yaxis: { title: 'PC 2' },
    });

    /* Feature importance: bars grow from zero */
    const top = featureImportances.slice(0, 8).reverse();
    const barValues = top.map(f => f.importance);
    plot('feature-importance-chart', [{
        x: motion ? barValues.map(() => 0) : barValues,
        y: top.map(f => f.feature.replace(/_/g, ' ')),
        type: 'bar',
        orientation: 'h',
        marker: { color: top.map((f, i) => (i === top.length - 1 ? accent : teal)) },
    }], {
        margin: { l: 10, r: 16, t: 10, b: 44 },
        xaxis: { title: 'Importance' },
        yaxis: { automargin: true },
    });
    if (motion) {
        onFirstView($('feature-importance-chart'), () => animateTrace('feature-importance-chart', 0, 'x', e => barValues.map(v => v * e), 900));
    }
}

// Keep every Plotly chart sized to its container (debounced)
let plotResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(plotResizeTimer);
    plotResizeTimer = setTimeout(() => {
        document.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el));
    }, 150);
});
