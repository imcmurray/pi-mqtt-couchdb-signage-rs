// Multi-Layer Digital Signage Management Interface

// Layer coordinates are in the TV's 1920x1080 compositing space
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;
const DRAG_SNAP = 10;
const MIN_LAYER_SIZE = 20;
const RESIZE_CORNERS = ['nw', 'ne', 'sw', 'se'];
// Reordering renumbers priorities in steps: above the slideshow (1), below alerts (150+)
const PRIORITY_STEP = 10;
// Browser stand-ins for the fonts the TV draws with (metric-compatible where possible).
// Single quotes only: these go inside a style="..." attribute
const PREVIEW_FONTS = {
    'DejaVu Sans': "'DejaVu Sans', Verdana, sans-serif",
    'DejaVu Serif': "'DejaVu Serif', Georgia, serif",
    'DejaVu Sans Mono': "'DejaVu Sans Mono', Menlo, Consolas, monospace",
    'Liberation Sans': "'Liberation Sans', Arial, Helvetica, sans-serif",
    'Liberation Serif': "'Liberation Serif', 'Times New Roman', Times, serif",
    'Liberation Sans Narrow': "'Liberation Sans Narrow', 'Arial Narrow', sans-serif-condensed, sans-serif"
};

class MultiLayerManager {
    constructor() {
        this.selectedTvId = null;
        this.selectedLayerId = null;
        // The editor works on a TV's overlays (Layer Control) or a scene's elements (Scenes)
        this.mode = 'tv';
        this.sceneId = null;
        this.scenes = [];
        this.layers = [];
        this.libraryImages = [];
        this.liveValues = {};       // weather values for {tokens}
        this.calendarRows = [];     // court_calendar data set
        this.ws = null;
        this.apiBase = '/api';
        this.drag = null;

        // Alert management properties
        this.selectedAlertType = 'INFO';
        this.selectedTargetType = 'all';
        this.activeAlerts = [];

        // Template management properties
        this.templates = [];
        this.selectedTemplate = null;
        this.tvSelectionMode = 'single';
        this.selectedTvIds = [];
        this.tvs = [];

        this.init();
    }

    async init() {
        await this.loadLibraryImages();
        await this.loadLiveData();
        await this.loadScenes();
        document.addEventListener('section-changed', (event) => {
            const { section } = event.detail;
            if (section === 'scenes') this.mountWorkspace('scene');
            if (section === 'layers') this.mountWorkspace('tv');
        });
        await this.loadTVs();
        await this.loadActiveAlerts();
        await this.loadTemplates();
        this.connectWebSocket();
        this.setupEventListeners();
        this.startStatusUpdates();
        this.renderTvCheckboxes();
        this.resetLayerForm();
        this.log('Multi-Layer Manager initialized');
    }

    // Layer Control API lives under /api/layers (the /api/tvs/:id/layers routes
    // are the older per-TV slideshow/logo config); scene elements use the same shape
    layersUrl(path = '', tvId = this.selectedTvId) {
        if (this.mode === 'scene') {
            return `${this.apiBase}/scenes/${this.sceneId}/elements${path}`;
        }
        return `${this.apiBase}/layers/tvs/${tvId}/layers${path}`;
    }

    // What the editor is working on: the selected TV or the selected scene
    get targetId() {
        return this.mode === 'scene' ? this.sceneId : this.selectedTvId;
    }

    get noun() {
        return this.mode === 'scene' ? 'element' : 'layer';
    }

    // Move the shared editor into the page being shown and point it at that page's target
    mountWorkspace(mode) {
        const slot = document.getElementById(mode === 'scene' ? 'sceneWorkspaceSlot' : 'layerWorkspaceSlot');
        const workspace = document.getElementById('layerWorkspace');
        if (!slot || !workspace) return;
        if (workspace.parentElement !== slot) slot.appendChild(workspace);
        if (this.mode === mode) return;

        this.mode = mode;
        this.selectedLayerId = null;
        this.layers = [];
        workspace.classList.toggle('scene-mode', mode === 'scene');
        document.getElementById('layerListTitle').textContent = mode === 'scene' ? 'Elements' : 'Active Layers';
        document.querySelector('#layerWorkspace .layers-order-hint').textContent =
            `Top of the list draws on top. Drag to reorder.`;
        this.resetLayerForm();
        this.renderLayers();
        this.loadLayers();
    }

    // --- Scenes ---
    async loadScenes() {
        try {
            this.scenes = await (await fetch(`${this.apiBase}/scenes`)).json();
        } catch (error) {
            this.log(`Error loading scenes: ${error.message}`, 'error');
            this.scenes = [];
        }
        if (!this.scenes.some(scene => scene.scene_id === this.sceneId)) {
            this.sceneId = this.scenes[0]?.scene_id || null;
        }
        const select = document.getElementById('sceneSelect');
        select.innerHTML = this.scenes.length
            ? this.scenes.map(scene => `<option value="${this.escapeHtml(scene.scene_id)}">${this.escapeHtml(scene.name)}</option>`).join('')
            : '<option value="">No scenes yet</option>';
        select.value = this.sceneId || '';
        this.updateSceneMeta();
        if (this.mode === 'scene') await this.loadLayers();
    }

    get selectedScene() {
        return this.scenes.find(scene => scene.scene_id === this.sceneId);
    }

    updateSceneMeta() {
        const scene = this.selectedScene;
        document.getElementById('sceneMeta').textContent = scene
            ? `${scene.element_count} element(s)${scene.description ? ' · ' + scene.description : ''}`
            : '';
    }

    async selectScene(sceneId) {
        this.sceneId = sceneId || null;
        this.selectedLayerId = null;
        this.resetLayerForm();
        this.updateSceneMeta();
        await this.loadLayers();
    }

    async openNewSceneModal() {
        const starters = await (await fetch(`${this.apiBase}/scenes/starters`)).json();
        document.getElementById('newSceneStarter').innerHTML = '<option value="">Blank scene</option>' +
            starters.map(s => `<option value="${this.escapeHtml(s.preset_id)}">${this.escapeHtml(s.name)} (${s.element_count} elements)</option>`).join('');
        document.getElementById('newSceneName').value = '';
        document.getElementById('newSceneModal').classList.add('show');
        document.getElementById('newSceneName').focus();
    }

    async sceneRequest(url, method, body) {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || response.statusText);
        return result;
    }

    async createScene(event) {
        event.preventDefault();
        const name = document.getElementById('newSceneName').value.trim();
        const fromPreset = document.getElementById('newSceneStarter').value;
        try {
            const scene = await this.sceneRequest(`${this.apiBase}/scenes`, 'POST', { name, ...(fromPreset ? { from_preset: fromPreset } : {}) });
            document.getElementById('newSceneModal').classList.remove('show');
            this.sceneId = scene.scene_id;
            this.log(`Created scene "${scene.name}"`);
            await this.loadScenes();
        } catch (error) {
            alert(`Couldn't create the scene: ${error.message}`);
        }
    }

    async renameScene() {
        const scene = this.selectedScene;
        if (!scene) return;
        const name = prompt('Scene name', scene.name);
        if (!name || name.trim() === scene.name) return;
        try {
            await this.sceneRequest(`${this.apiBase}/scenes/${scene.scene_id}`, 'PUT', { name: name.trim() });
            await this.loadScenes();
        } catch (error) {
            alert(`Couldn't rename the scene: ${error.message}`);
        }
    }

    async duplicateScene() {
        const scene = this.selectedScene;
        if (!scene) return;
        try {
            const copy = await this.sceneRequest(`${this.apiBase}/scenes/${scene.scene_id}/duplicate`, 'POST', {});
            this.sceneId = copy.scene_id;
            this.log(`Duplicated "${scene.name}"`);
            await this.loadScenes();
        } catch (error) {
            alert(`Couldn't duplicate the scene: ${error.message}`);
        }
    }

    async deleteScene() {
        const scene = this.selectedScene;
        if (!scene || !confirm(`Delete the scene "${scene.name}" and its ${scene.element_count} element(s)?`)) return;
        try {
            await this.sceneRequest(`${this.apiBase}/scenes/${scene.scene_id}`, 'DELETE');
            this.sceneId = null;
            this.log(`Deleted scene "${scene.name}"`);
            await this.loadScenes();
        } catch (error) {
            alert(`Couldn't delete the scene: ${error.message}`);
        }
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    // Layer colours are "rgba(r, g, b, a)"; templates store a as 0-255, the UI as 0-1
    parseColor(value) {
        const match = String(value || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
        if (!match) return { r: 0, g: 0, b: 0, a: 1 };
        let a = match[4] === undefined ? 1 : parseFloat(match[4]);
        if (a > 1) a = Math.min(a, 255) / 255;
        return { r: +match[1], g: +match[2], b: +match[3], a };
    }

    cssColor(value) {
        const { r, g, b, a } = this.parseColor(value);
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
    }

    colorToHex(value) {
        const { r, g, b } = this.parseColor(value);
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }

    hexToRgba(hex, alpha) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`;
    }

    isAlertLayer(layer) {
        return (layer.tags || []).includes('alert');
    }

    get selectedTv() {
        return this.tvs.find(tv => tv._id === this.selectedTvId);
    }

    get controlLayers() {
        return this.mode === 'scene' ? this.layers : this.layers.filter(layer => !this.isAlertLayer(layer));
    }

    async loadTVs() {
        try {
            const response = await fetch(`${this.apiBase}/tvs`);
            const tvs = await response.json();
            this.tvs = tvs;

            const tvSelect = document.getElementById('tvSelect');
            tvSelect.innerHTML = '<option value="">Select a TV...</option>' + tvs.map(tv =>
                `<option value="${this.escapeHtml(tv._id)}">${this.escapeHtml(tv.name)} (${this.escapeHtml(tv.location)})</option>`
            ).join('');

            // Auto-select first TV if available
            if (tvs.length > 0 && !this.selectedTvId) {
                this.selectedTvId = tvs[0]._id;
            }
            tvSelect.value = this.selectedTvId || '';
            if (this.selectedTvId) {
                await this.loadLayers();
            }

            this.renderTvCheckboxes();
            this.log(`Loaded ${tvs.length} TVs`);
        } catch (error) {
            this.log(`Error loading TVs: ${error.message}`, 'error');
        }
    }

    // Image Library images a layer can show instead of text
    async loadLibraryImages() {
        try {
            const response = await fetch(`${this.apiBase}/images`);
            if (!response.ok) throw new Error(response.statusText);
            this.libraryImages = (await response.json())
                .sort((a, b) => a.original_name.localeCompare(b.original_name));
        } catch (error) {
            this.libraryImages = [];
            this.log(`Error loading images: ${error.message}`, 'error');
        }

        const select = document.getElementById('layerImage');
        const current = select.value;
        select.innerHTML = '<option value="">Text</option>' + this.libraryImages.map(img =>
            `<option value="${this.escapeHtml(img._id)}">${this.escapeHtml(img.original_name)}${img.mimetype === 'image/png' ? '' : ' (no transparency)'}</option>`
        ).join('');
        select.value = current;
    }

    // --- Live data: court calendar rows and weather values ---
    async loadLiveData() {
        try {
            const datasets = await (await fetch(`${this.apiBase}/datasets`)).json();
            const weather = datasets.find(d => d.dataset_id === 'weather');
            const calendar = datasets.find(d => d.dataset_id === 'court_calendar');
            this.liveValues = weather?.values || {};

            document.getElementById('weatherStatus').textContent = weather
                ? `${weather.values?.location || ''}: ${weather.values?.weather || ''} (updated ${this.timeAgo(weather.updated_at)})`
                : 'Waiting for the first update…';

            if (calendar) {
                const full = await (await fetch(`${this.apiBase}/datasets/court_calendar`)).json();
                this.calendarRows = full.rows || [];
                const today = this.localDate(new Date());
                const todayCount = this.calendarRows.filter(r => r.date === today).length;
                document.getElementById('calendarStatus').textContent =
                    `${calendar.row_count} hearing(s) loaded, ${todayCount} today · ${calendar.source || 'upload'} · updated ${this.timeAgo(calendar.updated_at)}`;
            } else {
                this.calendarRows = [];
            }
        } catch (error) {
            this.log(`Error loading live data: ${error.message}`, 'error');
        }
    }

    async uploadCalendar(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;

        let json;
        try {
            json = JSON.parse(await file.text());
        } catch (error) {
            alert(`"${file.name}" isn't valid JSON: ${error.message}`);
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/datasets/court_calendar?filename=${encodeURIComponent(file.name)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(json)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || response.statusText);

            this.log(`Calendar: ${result.message}`);
            const skipped = result.errors?.length ? `\n\nSkipped:\n${result.errors.join('\n')}` : '';
            alert(`✅ ${result.message}.${skipped}`);
            await this.loadLiveData();
            this.updateScreenPreview();
        } catch (error) {
            this.log(`Calendar upload failed: ${error.message}`, 'error');
            alert(`❌ Calendar upload failed: ${error.message}`);
        }
    }

    timeAgo(iso) {
        const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
        if (!Number.isFinite(minutes)) return 'unknown';
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    localDate(date) {
        return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map((n, i) => (i ? String(n).padStart(2, '0') : n)).join('-');
    }

    // Mirrors pi-slideshow-rs layer_data::expand_tokens, in the browser's time zone
    expandTokens(text) {
        if (!text || !text.includes('{')) return text || '';
        const now = new Date();
        const clock = {
            time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            time24: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
            short_date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            day: now.toLocaleDateString('en-US', { weekday: 'long' }),
            month: now.toLocaleDateString('en-US', { month: 'long' }),
            year: String(now.getFullYear())
        };
        return text.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => clock[name] ?? this.liveValues[name] ?? match);
    }

    insertToken(token) {
        const textarea = document.getElementById('layerText');
        const { selectionStart: start, selectionEnd: end, value } = textarea;
        textarea.value = value.slice(0, start) + token + value.slice(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + token.length;
    }

    // First page of a table layer, laid out like the TV draws it
    renderTablePreview(layer, scale) {
        const spec = layer.content.table;
        const today = this.localDate(new Date());
        const rows = this.calendarRows.filter(row =>
            spec.filter === 'all' ? true
                : spec.filter === 'upcoming' ? row.date >= today
                    : row.date === today);
        const rowHeight = (spec.rowHeight || 70) * scale;
        const perPage = Math.max(1, Math.floor((layer.position.height - (spec.rowHeight || 70) * 1.5) / (spec.rowHeight || 70)));
        const columns = spec.columns.map(c => `${c.width}fr`).join(' ');
        const cell = (value, field) => {
            if (field === 'time' && /^\d{2}:\d{2}$/.test(value || '')) {
                const [h, m] = value.split(':').map(Number);
                return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
            }
            return value || '';
        };
        const header = spec.columns.map(c => `<span>${this.escapeHtml(c.label)}</span>`).join('');
        const body = rows.slice(0, perPage).map((row, i) => `
            <div class="table-preview-row" style="height:${rowHeight}px; grid-template-columns:${columns};
                 background:${this.cssColor(i % 2 ? spec.altRowBackground : spec.rowBackground)}">
                ${spec.columns.map(c => `<span>${this.escapeHtml(cell(row[c.field], c.field))}</span>`).join('')}
            </div>`).join('');
        const pages = Math.max(1, Math.ceil(rows.length / perPage));

        return `<div class="table-preview" style="color:${this.cssColor(spec.textColor)}; font-size:${(spec.fontSize || 28) * scale}px">
            <div class="table-preview-row header" style="height:${rowHeight}px; grid-template-columns:${columns};
                 background:${this.cssColor(spec.headerBackground)}; color:${this.cssColor(spec.headerTextColor)};
                 font-size:${(spec.headerFontSize || 26) * scale}px">${header}</div>
            ${body || `<div class="table-preview-empty" style="height:${rowHeight * 2}px">${this.escapeHtml(spec.emptyText || 'Nothing scheduled.')}</div>`}
            ${pages > 1 ? `<div class="table-preview-page" style="height:${rowHeight / 2}px">Page 1 of ${pages}</div>` : ''}
        </div>`;
    }

    libraryImageName(imageId) {
        return this.libraryImages.find(img => img._id === imageId)?.original_name || 'Image';
    }

    // Table layers are laid out by their template; the editor moves/sizes them only
    setTableMode(table) {
        const note = document.getElementById('tableLayerNote');
        document.getElementById('layerForm').classList.toggle('table-mode', !!table);
        note.hidden = !table;
        if (table) {
            note.textContent = `This layer is a table showing the ${table.dataset === 'court_calendar' ? 'Court Calendar' : table.dataset} data set ` +
                `(${table.filter === 'all' ? 'all dates' : table.filter === 'upcoming' ? 'today and later' : "today's hearings"}, ` +
                `${table.columns.map(c => c.label).join(', ')}). Upload new data under Live Data; long lists page every ${table.pageSeconds || 12} seconds.`;
        }
    }

    // Image layers show only the image on the TV, so hide the text-only fields
    onLayerImageChange() {
        const imageId = document.getElementById('layerImage').value;
        const thumb = document.getElementById('layerImageThumb');
        document.getElementById('layerForm').classList.toggle('image-mode', !!imageId);
        thumb.hidden = !imageId;
        if (imageId) {
            thumb.src = `/api/images/${encodeURIComponent(imageId)}/attachment?width=160`;
        } else {
            thumb.removeAttribute('src');
        }
    }

    async loadLayers() {
        if (!this.targetId) {
            this.layers = [];
            this.renderLayers();
            return;
        }
        const target = `${this.mode}:${this.targetId}`;

        try {
            const response = await fetch(this.layersUrl());
            if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            const layers = await response.json();
            // Ignore a slow reply for a TV/scene the editor has since moved away from
            if (target !== `${this.mode}:${this.targetId}`) return;
            this.layers = layers;
        } catch (error) {
            this.layers = [];
            this.log(`Error loading layers: ${error.message}`, 'error');
        }

        if (this.selectedLayerId && !this.layers.some(l => l.layer_id === this.selectedLayerId)) {
            this.selectedLayerId = null;
            this.resetLayerForm();
        }
        this.renderLayers();
    }

    renderLayers() {
        // Re-rendering mid-drag or mid-edit would drop the element in use
        if (this.drag || this.inlineEdit || this.listDrag) return;
        this.updateLayersList();
        this.updateScreenPreview();
        this.updateLayerCount();
    }

    updateLayersList() {
        const layersList = document.getElementById('layersList');
        const layers = [...this.controlLayers].sort((a, b) => b.priority - a.priority);

        if (layers.length === 0) {
            layersList.innerHTML = this.mode === 'scene'
                ? `<p class="layers-empty">${this.sceneId ? 'No elements yet. Create one with the editor below.' : 'Create a scene to start.'}</p>`
                : '<p class="layers-empty">No layers yet. Create one, apply a template, or add the sample layers.</p>';
            return;
        }

        layersList.innerHTML = layers.map(layer => {
            const id = this.escapeHtml(layer.layer_id);
            const { x, y, width, height } = layer.position;
            return `
            <div class="layer-item ${this.selectedLayerId === layer.layer_id ? 'selected' : ''} ${layer.visible ? '' : 'hidden-layer'}"
                 data-layer-id="${id}" onclick="layerItemClicked(event, '${id}')"
                 draggable="true"
                 ondragstart="manager.onLayerDragStart(event, '${id}')"
                 ondragover="manager.onLayerDragOver(event)"
                 ondragleave="this.classList.remove('drop-before', 'drop-after')"
                 ondrop="manager.onLayerDrop(event, '${id}')"
                 ondragend="manager.onLayerDragEnd()">
                <div class="layer-item-header">
                    <span class="layer-drag-handle" title="Drag to change which layer is on top">⋮⋮</span>
                    <span class="layer-swatch" style="background: ${this.cssColor(layer.content?.backgroundColor)}"></span>
                    <span class="layer-name">${this.escapeHtml(layer.name)}</span>
                    ${layer.visible ? '' : '<span class="layer-badge">Hidden</span>'}
                </div>
                <div class="layer-text" title="${layer.content?.image_id || layer.content?.table ? '' : 'Click to change the text'}">${layer.content?.table
                    ? `📅 Table: ${this.escapeHtml(layer.content.table.dataset === 'court_calendar' ? 'Court Calendar' : layer.content.table.dataset)}`
                    : layer.content?.image_id
                    ? `🖼 ${this.escapeHtml(this.libraryImageName(layer.content.image_id))}`
                    : (layer.content?.text?.trim() ? this.escapeHtml(layer.content.text) : '<em>Colour block (no text)</em>')}</div>
                <div class="layer-meta">
                    <span>${x},${y}</span>
                    <span>${width}×${height}</span>
                    <span>Priority ${layer.priority}</span>
                    ${layer.opacity < 1 ? `<span>${Math.round(layer.opacity * 100)}%</span>` : ''}
                </div>
                <div class="layer-controls">
                    <button class="btn btn-small ${layer.visible ? 'btn-warning' : 'btn-success'}"
                            onclick="event.stopPropagation(); toggleLayerVisibility('${id}', ${!layer.visible})">
                        ${layer.visible ? 'Hide' : 'Show'}
                    </button>
                    <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); deleteLayer('${id}')">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    updateScreenPreview() {
        const screen = document.getElementById('screenPreview');
        const tv = this.selectedTv;
        const scale = (screen.clientWidth || 600) / SCREEN_WIDTH;
        const alerts = this.layers.filter(layer => this.isAlertLayer(layer) && layer.visible);

        // Overlays preview over what the TV is playing; a scene is the full screen itself
        const background = this.mode === 'scene'
            ? (this.layers.length ? '' : '<div class="preview-empty">Empty scene: add an element, or start from a courthouse starter</div>')
            : tv?.current_image
            ? `<img class="preview-background" src="/api/images/${encodeURIComponent(tv.current_image)}/attachment?width=960" alt="" draggable="false">`
            : '<div class="preview-empty">No image showing</div>';

        // Hidden layers aren't on the TV; still draw the selected one faintly so it can be moved
        const drawn = this.layers
            .filter(layer => layer.visible || layer.layer_id === this.selectedLayerId)
            .sort((a, b) => a.priority - b.priority);

        screen.innerHTML = background + drawn.map(layer => {
            const { x, y, width, height } = layer.position;
            const content = layer.content || {};
            const isAlert = this.isAlertLayer(layer);
            const imageId = content.image_id;
            const table = content.table;
            const classes = ['layer-preview',
                isAlert ? 'alert-layer' : '',
                layer.layer_id === this.selectedLayerId ? 'selected' : '',
                layer.visible ? '' : 'hidden-layer'].filter(Boolean).join(' ');
            const style = [
                `left: ${(x / SCREEN_WIDTH) * 100}%`,
                `top: ${(y / SCREEN_HEIGHT) * 100}%`,
                `width: ${(width / SCREEN_WIDTH) * 100}%`,
                `height: ${(height / SCREEN_HEIGHT) * 100}%`,
                `z-index: ${layer.priority}`,
                `opacity: ${layer.visible ? layer.opacity : 0.35}`,
                `background: ${imageId ? 'transparent' : this.cssColor(content.backgroundColor)}`,
                `color: ${this.cssColor(content.textColor)}`,
                `font-size: ${Math.max((content.fontSize || 24) * scale, 6)}px`,
                `justify-content: ${{ center: 'center', right: 'flex-end' }[content.alignment] || 'flex-start'}`,
                `align-items: ${{ top: 'flex-start', bottom: 'flex-end' }[content.verticalAlignment] || 'center'}`,
                `text-align: ${content.alignment || 'left'}`,
                `font-family: ${PREVIEW_FONTS[content.fontFamily] || PREVIEW_FONTS['DejaVu Sans']}`,
                `font-weight: ${content.fontWeight === 'bold' ? 700 : 400}`,
                `padding: ${10 * scale}px`
            ].join('; ');
            const handles = layer.layer_id === this.selectedLayerId && !isAlert
                ? RESIZE_CORNERS.map(corner => `<span class="resize-handle ${corner}" data-corner="${corner}"></span>`).join('')
                    + '<span class="resize-size"></span>'
                : '';
            return `<div class="${classes}" data-layer-id="${this.escapeHtml(layer.layer_id)}" style="${style}"
                         title="${this.escapeHtml(layer.name)}">${handles}${table
                ? this.renderTablePreview(layer, scale)
                : imageId
                ? `<img class="layer-preview-image" src="/api/images/${encodeURIComponent(imageId)}/attachment?width=400" alt="" draggable="false">`
                : `<span class="layer-preview-text">${this.escapeHtml(this.expandTokens(content.text))}</span>`}</div>`;
        }).join('');

        document.getElementById('previewLegend').textContent = this.mode === 'scene' ? '' : [
            tv?.config?.orientation && tv.config.orientation !== 'landscape' ? `TV orientation: ${tv.config.orientation}` : '',
            alerts.length ? `${alerts.length} alert banner(s) showing (managed under Emergency Alerts)` : ''
        ].filter(Boolean).join(' · ');
    }

    updateLayerCount() {
        const count = this.controlLayers.length;
        if (this.mode === 'tv') {
            document.getElementById('layerCount').textContent = `${count} layer${count === 1 ? '' : 's'}`;
        }
        document.getElementById('layerCountText').textContent = count;
    }

    // Drag layers around the preview; a press without movement selects
    onPreviewPointerDown(event) {
        if (event.target.closest('[contenteditable="true"]')) return;
        const element = event.target.closest('.layer-preview');
        if (!element || element.classList.contains('alert-layer') || event.button !== 0) return;
        const layer = this.layers.find(l => l.layer_id === element.dataset.layerId);
        if (!layer) return;

        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        const screen = document.getElementById('screenPreview');
        this.drag = {
            element,
            layer,
            corner: event.target.closest('.resize-handle')?.dataset.corner || null,
            startX: event.clientX,
            startY: event.clientY,
            scale: screen.clientWidth / SCREEN_WIDTH,
            moved: false,
            rect: { ...layer.position }
        };
    }

    // New rectangle for a corner drag; the opposite corner stays put. Image
    // layers keep their proportions unless Shift is held (text layers: the reverse).
    resizeRect(drag, dx, dy, shiftKey) {
        const start = drag.layer.position;
        const west = drag.corner.includes('w');
        const north = drag.corner.includes('n');
        const anchorX = west ? start.x + start.width : start.x;
        const anchorY = north ? start.y + start.height : start.y;
        const maxWidth = west ? anchorX : SCREEN_WIDTH - anchorX;
        const maxHeight = north ? anchorY : SCREEN_HEIGHT - anchorY;
        const snap = value => Math.round(value / DRAG_SNAP) * DRAG_SNAP;

        let width = start.width + (west ? -dx : dx);
        let height = start.height + (north ? -dy : dy);

        const keepAspect = !!drag.layer.content?.image_id !== shiftKey;
        if (keepAspect) {
            const ratio = start.width / start.height;
            let scale = Math.max(width / start.width, height / start.height);
            scale = Math.min(scale, maxWidth / start.width, maxHeight / start.height);
            scale = Math.max(scale, MIN_LAYER_SIZE / Math.min(start.width, start.height));
            // Snap the width, keep the height in proportion (and still on screen)
            width = Math.min(snap(start.width * scale), maxWidth, Math.floor(maxHeight * ratio));
            height = Math.round(width / ratio);
        } else {
            width = Math.min(Math.max(snap(width), MIN_LAYER_SIZE), maxWidth);
            height = Math.min(Math.max(snap(height), MIN_LAYER_SIZE), maxHeight);
        }

        return {
            x: west ? anchorX - width : anchorX,
            y: north ? anchorY - height : anchorY,
            width,
            height
        };
    }

    onPreviewPointerMove(event) {
        const drag = this.drag;
        if (!drag) return;
        const dx = (event.clientX - drag.startX) / drag.scale;
        const dy = (event.clientY - drag.startY) / drag.scale;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
        drag.moved = true;

        if (drag.corner) {
            drag.rect = this.resizeRect(drag, dx, dy, event.shiftKey);
            const label = drag.element.querySelector('.resize-size');
            if (label) label.textContent = `${drag.rect.width}×${drag.rect.height}`;
        } else {
            const snap = value => Math.round(value / DRAG_SNAP) * DRAG_SNAP;
            const { width, height } = drag.layer.position;
            drag.rect = {
                ...drag.rect,
                x: Math.min(Math.max(snap(drag.layer.position.x + dx), 0), SCREEN_WIDTH - width),
                y: Math.min(Math.max(snap(drag.layer.position.y + dy), 0), SCREEN_HEIGHT - height)
            };
        }

        const { x, y, width, height } = drag.rect;
        Object.assign(drag.element.style, {
            left: `${(x / SCREEN_WIDTH) * 100}%`,
            top: `${(y / SCREEN_HEIGHT) * 100}%`,
            width: `${(width / SCREEN_WIDTH) * 100}%`,
            height: `${(height / SCREEN_HEIGHT) * 100}%`
        });
        drag.element.classList.add(drag.corner ? 'resizing' : 'dragging');
    }

    async onPreviewPointerUp() {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;

        if (!drag.moved) {
            // A second click on the selected text layer edits its text in place
            if (drag.layer.layer_id === this.selectedLayerId && !drag.corner) {
                this.startInlineEdit(drag.element.querySelector('.layer-preview-text'), drag.layer);
            } else {
                this.selectLayer(drag.layer.layer_id);
            }
            return;
        }
        const { x, y, width, height } = drag.rect;
        const start = drag.layer.position;
        if (x === start.x && y === start.y && width === start.width && height === start.height) {
            this.renderLayers();
            return;
        }

        try {
            const response = await fetch(this.layersUrl(`/${drag.layer.layer_id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ position: drag.rect })
            });
            if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            this.log(drag.corner
                ? `Resized "${drag.layer.name}" to ${width}×${height} at ${x},${y}`
                : `Moved "${drag.layer.name}" to ${x},${y}`);
        } catch (error) {
            this.log(`Failed to ${drag.corner ? 'resize' : 'move'} layer: ${error.message}`, 'error');
        }
        this.selectedLayerId = drag.layer.layer_id;
        await this.loadLayers();
        this.fillLayerForm(this.layers.find(l => l.layer_id === drag.layer.layer_id));
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.updateConnectionStatus(true);
            this.log('WebSocket connected');
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };

        this.ws.onclose = () => {
            this.updateConnectionStatus(false);
            this.log('WebSocket disconnected, attempting to reconnect...', 'warning');
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = () => {
            this.log('WebSocket error', 'error');
        };
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'mqtt_message':
                this.handleMqttMessage(data.topic, data.payload);
                break;
            case 'alerts_updated':
                if (data.data?.type === 'active') {
                    this.loadActiveAlerts();
                    this.loadLayers(); // alert banners show in the preview
                }
                if (data.data?.type === 'queue' && typeof loadQueueStatus === 'function') loadQueueStatus();
                if (data.data?.type === 'scheduled' && typeof loadScheduledAlerts === 'function') loadScheduledAlerts();
                break;
            case 'layers_updated':
                if (this.mode === 'tv' && data.data?.tv_id === this.selectedTvId) this.loadLayers();
                break;
            case 'scene_elements_updated':
                if (this.mode === 'scene' && data.data?.scene_id === this.sceneId) this.loadLayers();
                break;
            case 'scenes_updated':
                this.loadScenes();
                break;
        }
    }

    handleMqttMessage(topic, payload) {
        // Keep the preview background on whatever the selected TV is showing
        const tv = this.selectedTv;
        if (!tv || typeof topic !== 'string') return;
        const mqttTvId = tv._id.replace(/^tv_/, '');
        if (topic.endsWith(`/tv/${mqttTvId}/image/current`) && payload?.image_id && payload.image_id !== tv.current_image) {
            tv.current_image = payload.image_id;
            this.updateScreenPreview();
        }
    }

    updateConnectionStatus(connected) {
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');
        statusDot.classList.toggle('connected', connected);
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    setupEventListeners() {
        document.getElementById('tvSelect').addEventListener('change', async (e) => {
            this.selectedTvId = e.target.value;
            if (this.mode !== 'tv') return;
            this.selectedLayerId = null;
            this.resetLayerForm();
            if (this.selectedTvId) {
                await this.loadLayers();
            } else {
                this.layers = [];
                this.renderLayers();
            }
        });

        const screen = document.getElementById('screenPreview');
        screen.addEventListener('pointerdown', e => this.onPreviewPointerDown(e));
        screen.addEventListener('pointermove', e => this.onPreviewPointerMove(e));
        screen.addEventListener('pointerup', () => this.onPreviewPointerUp());
        screen.addEventListener('pointercancel', () => { this.drag = null; this.renderLayers(); });

        // Font sizes in the preview follow its width
        if (window.ResizeObserver) {
            let lastWidth = 0;
            new ResizeObserver(entries => {
                const width = Math.round(entries[0].contentRect.width);
                if (width && width !== lastWidth) {
                    lastWidth = width;
                    this.updateScreenPreview();
                }
            }).observe(screen);
        }
    }

    selectLayer(layerId) {
        const layer = this.layers.find(l => l.layer_id === layerId);
        if (!layer) return;
        this.selectedLayerId = layerId;
        this.fillLayerForm(layer);
        this.renderLayers();
    }

    // --- Reordering the Active Layers list (top = drawn on top) ---
    onLayerDragStart(event, layerId) {
        if (this.inlineEdit) {
            event.preventDefault();
            return;
        }
        this.listDrag = layerId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', layerId);
        event.currentTarget.classList.add('dragging');
    }

    layerDropSide(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    }

    onLayerDragOver(event) {
        if (!this.listDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const side = this.layerDropSide(event);
        event.currentTarget.classList.toggle('drop-before', side === 'before');
        event.currentTarget.classList.toggle('drop-after', side === 'after');
    }

    onLayerDragEnd() {
        // Also fires after a drop; only needed to clean up a cancelled drag
        if (!this.listDrag) return;
        this.listDrag = null;
        this.renderLayers();
    }

    async onLayerDrop(event, targetId) {
        event.preventDefault();
        const draggedId = this.listDrag;
        const side = this.layerDropSide(event);
        this.listDrag = null;
        if (!draggedId || draggedId === targetId) {
            this.renderLayers();
            return;
        }

        // Same order the list shows: highest priority first
        const ordered = [...this.controlLayers].sort((a, b) => b.priority - a.priority);
        const dragged = ordered.find(l => l.layer_id === draggedId);
        const rest = ordered.filter(l => l.layer_id !== draggedId);
        rest.splice(rest.findIndex(l => l.layer_id === targetId) + (side === 'after' ? 1 : 0), 0, dragged);

        const changes = rest
            .map((layer, index) => ({ layer, priority: (rest.length - index) * PRIORITY_STEP }))
            .filter(({ layer, priority }) => layer.priority !== priority);
        changes.forEach(({ layer, priority }) => { layer.priority = priority; });
        this.renderLayers();

        const results = await Promise.allSettled(changes.map(({ layer, priority }) =>
            fetch(this.layersUrl(`/${layer.layer_id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority })
            }).then(async response => {
                if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            })
        ));
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length) {
            this.log(`Reorder: ${failed.length} layer(s) failed to save: ${failed[0].reason.message}`, 'error');
        } else {
            this.log(`Moved "${dragged.name}" ${side === 'before' ? 'above' : 'below'} "${rest.find(l => l.layer_id === targetId)?.name}"`);
        }
        await this.loadLayers();
        if (this.selectedLayerId) {
            this.fillLayerForm(this.layers.find(l => l.layer_id === this.selectedLayerId));
        }
    }

    layerItemClicked(event, layerId) {
        const textElement = event.target.closest('.layer-text');
        if (textElement && layerId === this.selectedLayerId) {
            this.startInlineEdit(textElement, this.layers.find(l => l.layer_id === layerId));
        } else {
            this.selectLayer(layerId);
        }
    }

    // Edit a text layer's text where it's shown: Enter saves, Shift+Enter
    // adds a line, Escape cancels, clicking away saves
    startInlineEdit(element, layer) {
        if (!element || !layer || layer.content?.image_id || this.inlineEdit) return;

        const original = layer.content?.text || '';
        element.textContent = original;
        element.contentEditable = 'true';
        element.classList.add('inline-editing');
        element.focus();
        document.getSelection().selectAllChildren(element);
        this.inlineEdit = { element, layer };

        const finish = async (save) => {
            if (this.inlineEdit?.element !== element) return;
            this.inlineEdit = null;
            element.contentEditable = 'false';
            element.removeEventListener('keydown', onKey);
            element.removeEventListener('blur', onBlur);

            const text = element.innerText.replace(/\n$/, '');
            if (save && text !== original) {
                await this.saveLayerText(layer, text);
            } else {
                this.renderLayers();
            }
        };
        const onKey = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            e.stopPropagation();
        };
        const onBlur = () => finish(true);
        element.addEventListener('keydown', onKey);
        element.addEventListener('blur', onBlur);
    }

    async saveLayerText(layer, text) {
        try {
            const response = await fetch(this.layersUrl(`/${layer.layer_id}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: { ...layer.content, text } })
            });
            if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            this.log(`Updated the text of "${layer.name}"`);
        } catch (error) {
            this.log(`Failed to update text: ${error.message}`, 'error');
            alert(`Couldn't save the text: ${error.message}`);
        }
        await this.loadLayers();
        if (layer.layer_id === this.selectedLayerId) {
            this.fillLayerForm(this.layers.find(l => l.layer_id === layer.layer_id));
        }
    }

    newLayer() {
        this.selectedLayerId = null;
        this.resetLayerForm();
        this.renderLayers();
        document.getElementById('layerName').focus();
    }

    setEditorMode(editing) {
        const noun = this.noun;
        document.getElementById('layerEditorTitle').textContent = `${editing ? 'Edit' : 'New'} ${noun[0].toUpperCase()}${noun.slice(1)}`;
        document.getElementById('layerSaveButton').textContent = editing ? 'Save changes' : `Create ${noun}`;
        document.getElementById('layerEditorNew').style.display = editing ? '' : 'none';
        document.getElementById('layerEditorNew').textContent = `+ New ${noun}`;
        document.getElementById('layerSaveTemplateButton').style.display = editing ? '' : 'none';
    }

    resetLayerForm() {
        document.getElementById('layerForm').reset();
        document.getElementById('layerBgColor').value = '#000000';
        document.getElementById('layerTextColor').value = '#ffffff';
        this.onLayerImageChange();
        this.setTableMode(null);
        this.setEditorMode(false);
    }

    fillLayerForm(layer) {
        if (!layer) return;
        const content = layer.content || {};
        const set = (id, value) => { document.getElementById(id).value = value; };
        set('layerName', layer.name || '');
        set('layerText', content.text || '');
        set('layerX', layer.position.x);
        set('layerY', layer.position.y);
        set('layerWidth', layer.position.width);
        set('layerHeight', layer.position.height);
        set('fontSize', content.fontSize || 24);
        set('layerAlignment', content.alignment || 'left');
        set('layerVerticalAlignment', content.verticalAlignment || 'middle');
        set('layerFontFamily', PREVIEW_FONTS[content.fontFamily] ? content.fontFamily : 'DejaVu Sans');
        set('layerFontWeight', content.fontWeight === 'bold' ? 'bold' : 'normal');
        set('layerPriority', layer.priority);
        set('layerOpacity', Math.round((layer.opacity ?? 1) * 100));
        set('layerBgColor', this.colorToHex(content.backgroundColor));
        set('layerBgAlpha', Math.round(this.parseColor(content.backgroundColor).a * 100));
        set('layerTextColor', this.colorToHex(content.textColor));
        document.getElementById('layerVisible').checked = layer.visible !== false;
        set('layerImage', content.image_id || '');
        this.onLayerImageChange();
        this.setTableMode(content.table);
        this.setEditorMode(true);
    }

    readLayerForm() {
        const number = id => Number(document.getElementById(id).value);
        const position = {
            x: number('layerX'),
            y: number('layerY'),
            width: number('layerWidth'),
            height: number('layerHeight')
        };
        if (position.x + position.width > SCREEN_WIDTH || position.y + position.height > SCREEN_HEIGHT) {
            throw new Error(`The layer must fit on the ${SCREEN_WIDTH}×${SCREEN_HEIGHT} screen`);
        }
        const imageId = document.getElementById('layerImage').value || null;
        const text = document.getElementById('layerText').value;
        return {
            name: document.getElementById('layerName').value.trim(),
            layer_type: 'DataRow',
            content: {
                text,
                image_id: imageId,
                backgroundColor: this.hexToRgba(document.getElementById('layerBgColor').value, number('layerBgAlpha') / 100),
                textColor: this.hexToRgba(document.getElementById('layerTextColor').value, 1),
                fontSize: number('fontSize'),
                alignment: document.getElementById('layerAlignment').value,
                verticalAlignment: document.getElementById('layerVerticalAlignment').value,
                fontFamily: document.getElementById('layerFontFamily').value,
                fontWeight: document.getElementById('layerFontWeight').value
            },
            position,
            visible: document.getElementById('layerVisible').checked,
            opacity: number('layerOpacity') / 100,
            priority: number('layerPriority')
        };
    }

    async saveLayer(event) {
        event?.preventDefault();
        if (!this.targetId) {
            this.log(this.mode === 'scene' ? 'Please create or select a scene first' : 'Please select a TV first', 'error');
            return;
        }

        let layerData;
        try {
            layerData = this.readLayerForm();
        } catch (error) {
            this.log(error.message, 'error');
            alert(error.message);
            return;
        }

        const editing = this.layers.find(l => l.layer_id === this.selectedLayerId);
        if (editing) {
            // Keep fields the editor doesn't show
            layerData.layer_type = editing.layer_type;
            layerData.content = { ...editing.content, ...layerData.content };
        }

        try {
            const response = await fetch(editing ? this.layersUrl(`/${editing.layer_id}`) : this.layersUrl(), {
                method: editing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(layerData)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || response.statusText);

            this.log(`${editing ? 'Updated' : 'Created'} layer: ${result.name}`);
            this.selectedLayerId = result.layer_id;
            await this.loadLayers();
            this.fillLayerForm(this.layers.find(l => l.layer_id === result.layer_id));
        } catch (error) {
            this.log(`Failed to save layer: ${error.message}`, 'error');
            alert(`Couldn't save the layer: ${error.message}`);
        }
    }

    async animateSelected(animationType) {
        if (!this.selectedLayerId) {
            this.log('Please select a layer first', 'error');
            return;
        }

        const animationData = {
            type: animationType,
            duration: parseInt(document.getElementById('animDuration').value) || 500,
            easing: 'ease-in-out'
        };
        if (animationType.startsWith('slide_')) {
            animationData.distance = 100;
        }

        try {
            const response = await fetch(this.layersUrl(`/${this.selectedLayerId}/animate`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(animationData)
            });
            if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            this.log(`Started ${animationType} animation`);
        } catch (error) {
            this.log(`Failed to animate: ${error.message}`, 'error');
        }
    }

    async setLayerVisibility(layerId, visible) {
        const response = await fetch(this.layersUrl(`/${layerId}/visibility`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible })
        });
        if (!response.ok) throw new Error((await response.json()).error || response.statusText);
    }

    async toggleLayerVisibility(layerId, visible) {
        try {
            await this.setLayerVisibility(layerId, visible);
            this.log(`Layer ${visible ? 'shown' : 'hidden'}`);
        } catch (error) {
            this.log(`Failed to toggle visibility: ${error.message}`, 'error');
        }
        await this.loadLayers();
        if (layerId === this.selectedLayerId) {
            this.fillLayerForm(this.layers.find(l => l.layer_id === layerId));
        }
    }

    async removeLayer(layerId) {
        const response = await fetch(this.layersUrl(`/${layerId}`), { method: 'DELETE' });
        if (!response.ok) throw new Error((await response.json()).error || response.statusText);
    }

    async deleteLayer(layerId) {
        const layer = this.layers.find(l => l.layer_id === layerId);
        if (!confirm(`Delete the layer "${layer?.name || layerId}"?`)) return;

        try {
            await this.removeLayer(layerId);
            this.log('Layer deleted');
        } catch (error) {
            this.log(`Failed to delete layer: ${error.message}`, 'error');
        }
        if (this.selectedLayerId === layerId) {
            this.selectedLayerId = null;
            this.resetLayerForm();
        }
        await this.loadLayers();
    }

    async createSampleLayers() {
        if (!this.selectedTvId) {
            this.log('Please select a TV first', 'error');
            return;
        }

        const sampleLayers = [
            { name: 'Court Schedule Header', text: "TODAY'S COURT SCHEDULE", y: 50, height: 60, fontSize: 32, backgroundColor: 'rgba(0, 0, 128, 0.9)', alignment: 'center' },
            { name: 'Court Room 1', text: '9:00 AM - Room 101 - Smith vs. Johnson', y: 150, height: 50, fontSize: 24, backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            { name: 'Court Room 2', text: '10:30 AM - Room 205 - State vs. Williams', y: 210, height: 50, fontSize: 24, backgroundColor: 'rgba(0, 0, 0, 0.8)' },
            { name: 'Delay Notice', text: 'Court Room 205 delayed by 30 minutes', y: 900, height: 60, fontSize: 28, backgroundColor: 'rgba(200, 0, 0, 0.9)', alignment: 'center' }
        ];

        this.log('Creating sample layers...');
        for (const sample of sampleLayers) {
            try {
                const response = await fetch(this.layersUrl(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: sample.name,
                        layer_type: 'DataRow',
                        content: {
                            text: sample.text,
                            backgroundColor: sample.backgroundColor,
                            textColor: 'rgba(255, 255, 255, 1)',
                            fontSize: sample.fontSize,
                            alignment: sample.alignment || 'left'
                        },
                        position: { x: 0, y: sample.y, width: SCREEN_WIDTH, height: sample.height },
                        visible: true,
                        opacity: 1.0,
                        priority: 15
                    })
                });
                if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            } catch (error) {
                this.log(`Error creating sample layer "${sample.name}": ${error.message}`, 'error');
            }
        }

        await this.loadLayers();
        this.log('Sample layers created');
    }

    async setAllVisibility(visible) {
        const targets = this.controlLayers.filter(layer => layer.visible !== visible);
        if (!this.targetId || targets.length === 0) return;

        const results = await Promise.allSettled(targets.map(layer => this.setLayerVisibility(layer.layer_id, visible)));
        const failed = results.filter(r => r.status === 'rejected').length;
        this.log(`${visible ? 'Showed' : 'Hid'} ${targets.length - failed} layer(s)${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'info');
        await this.loadLayers();
    }

    hideAllLayers() {
        return this.setAllVisibility(false);
    }

    showAllLayers() {
        return this.setAllVisibility(true);
    }

    async deleteAllLayers() {
        const layers = this.controlLayers;
        if (!this.targetId || layers.length === 0) return;
        if (!confirm(this.mode === 'scene'
            ? `Delete all ${layers.length} elements in this scene?`
            : `Delete all ${layers.length} layers on this TV? Alert banners are not affected.`)) return;

        const results = await Promise.allSettled(layers.map(layer => this.removeLayer(layer.layer_id)));
        const failed = results.filter(r => r.status === 'rejected').length;
        this.log(`Deleted ${layers.length - failed} layer(s)${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'info');
        this.selectedLayerId = null;
        this.resetLayerForm();
        await this.loadLayers();
    }

    startStatusUpdates() {
        // Fallback refresh for layers and live data every 60 seconds (primary updates via WebSocket)
        setInterval(async () => {
            await this.loadLiveData();
            if (this.targetId) {
                this.loadLayers();
            }
        }, 60000);

        // Keep {time} in the preview current
        setInterval(() => this.renderLayers(), 30000);

        // Fallback refresh for active alerts every 60 seconds (primary updates via WebSocket)
        setInterval(() => {
            this.loadActiveAlerts();
        }, 60000);
    }

    // Emergency Alert System Methods

    selectAlertType(type) {
        this.selectedAlertType = type;

        // Update UI to show selected state
        document.querySelectorAll('.alert-type-button').forEach(btn => {
            btn.classList.remove('selected');
        });

        const selectedBtn = document.querySelector(`.alert-type-button.${type.toLowerCase()}`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
        }

        this.log(`Alert type selected: ${type}`);
    }

    selectTargetType(targetType) {
        this.selectedTargetType = targetType;

        // Update UI to show selected state
        document.querySelectorAll('.target-type-option').forEach(btn => {
            btn.classList.remove('selected');
        });

        const selectedBtn = document.querySelector(`.target-type-option[onclick*="${targetType}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
        }

        // Show/hide location selector based on target type
        const locationSelector = document.getElementById('locationSelector');
        if (locationSelector) {
            locationSelector.style.display = targetType === 'location' ? 'block' : 'none';
        }

        this.log(`Target type selected: ${targetType}`);
    }

    async broadcastAlert() {
        const title = document.getElementById('alertTitle').value.trim();
        const message = document.getElementById('alertMessage').value.trim();

        if (!title || !message) {
            this.log('Please fill in alert title and message', 'error');
            return;
        }

        const alertData = {
            title,
            message,
            type: this.selectedAlertType,
            target_type: this.selectedTargetType,
            created_by: 'web-admin'
        };

        // Add location if targeting by location
        if (this.selectedTargetType === 'location') {
            const location = document.getElementById('targetLocationInput')?.value.trim();
            if (!location) {
                this.log('Please enter a location', 'error');
                return;
            }
            alertData.target_location = location;
        }

        try {
            const response = await fetch(`${this.apiBase}/alerts/broadcast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(alertData)
            });

            if (response.ok) {
                const result = await response.json();
                const alertInfo = result.data.alert;
                const deliveredCount = result.data.delivered_count;

                this.log(`Alert broadcasted: "${alertInfo.title}" (${alertInfo.type}) to ${deliveredCount} TV(s)`);

                // Clear form
                document.getElementById('alertTitle').value = '';
                document.getElementById('alertMessage').value = '';

                // Reload active alerts
                await this.loadActiveAlerts();
            } else {
                const error = await response.json();
                this.log(`Failed to broadcast alert: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error broadcasting alert: ${error.message}`, 'error');
        }
    }

    async loadActiveAlerts() {
        try {
            const response = await fetch(`${this.apiBase}/alerts/active`);
            const result = await response.json();

            this.activeAlerts = result.data || [];
            this.updateActiveAlertsList();
        } catch (error) {
            this.log(`Error loading active alerts: ${error.message}`, 'error');
        }
    }

    updateActiveAlertsList() {
        const activeAlertsCount = document.getElementById('activeAlertCount');
        const activeAlertsList = document.getElementById('activeAlertsList');

        if (!activeAlertsCount || !activeAlertsList) return;

        activeAlertsCount.textContent = this.activeAlerts.length;

        if (this.activeAlerts.length === 0) {
            activeAlertsList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 16px;">No active alerts</p>';
            return;
        }

        activeAlertsList.innerHTML = this.activeAlerts.map(alert => {
            const createdDate = new Date(alert.created_at).toLocaleString();
            const typeIcon = alert.alert_type === 'CRITICAL' ? '🚨' : alert.alert_type === 'URGENT' ? '⚠️' : 'ℹ️';
            const typeClass = alert.alert_type.toLowerCase();

            return `
                <div class="active-alert-item ${typeClass}">
                    <div class="alert-header">
                        <span class="alert-icon">${typeIcon}</span>
                        <span class="alert-type-badge ${typeClass}">${alert.alert_type}</span>
                        <span class="alert-time">${createdDate}</span>
                    </div>
                    <div class="alert-title">${this.escapeHtml(alert.title)}</div>
                    <div class="alert-message">${this.escapeHtml(alert.message)}</div>
                    <div class="alert-footer">
                        <span class="alert-delivery">Delivered to ${alert.delivered_to_count} TV(s)</span>
                        <button class="btn btn-small btn-secondary" onclick="dismissAlert('${alert.alert_id}')">
                            Dismiss
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async dismissAlert(alertId) {
        if (!confirm('Are you sure you want to dismiss this alert?')) return;

        try {
            const response = await fetch(`${this.apiBase}/alerts/${alertId}/dismiss`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Manually dismissed from web interface' })
            });

            if (response.ok) {
                this.log('Alert dismissed');
                await this.loadActiveAlerts();
            } else {
                const error = await response.json();
                this.log(`Failed to dismiss alert: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error dismissing alert: ${error.message}`, 'error');
        }
    }
    
    log(message, level = 'info') {
        const logOutput = document.getElementById('logOutput');
        const timestamp = new Date().toLocaleTimeString();
        const prefix = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '✅';

        logOutput.textContent += `${timestamp} ${prefix} ${message}\n`;
        logOutput.scrollTop = logOutput.scrollHeight;

        console.log(`[${level.toUpperCase()}] ${message}`);
    }

    // ============ Template Management Methods ============

    async loadTemplates() {
        try {
            const response = await fetch(`${this.apiBase}/presets`);
            const result = await response.json();

            if (result.success) {
                this.templates = result.data;
                this.renderTemplates();
                this.log(`Loaded ${this.templates.length} templates`);
            }
        } catch (error) {
            this.log(`Error loading templates: ${error.message}`, 'error');
        }
    }

    renderTemplates() {
        const templateList = document.getElementById('templateList');
        if (!templateList) return;

        const filter = document.getElementById('templateCategoryFilter')?.value || '';
        const filteredTemplates = filter
            ? this.templates.filter(t => t.category === filter)
            : this.templates;

        if (filteredTemplates.length === 0) {
            templateList.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                    ${filter ? 'No templates in this category' : 'No templates available'}
                </div>
            `;
            return;
        }

        templateList.innerHTML = filteredTemplates.map(template => {
            const isSelected = this.selectedTemplate?.preset_id === template.preset_id;
            const preview = this.generateTemplatePreview(template);

            return `
                <div class="template-card ${isSelected ? 'selected' : ''}"
                     onclick="selectTemplate('${template.preset_id}')">
                    <div class="template-card-header">
                        <span class="template-card-name">${this.escapeHtml(template.name)}</span>
                        <span class="template-card-category ${template.category}">${template.category}</span>
                    </div>
                    <div class="template-card-preview">${this.escapeHtml(preview)}</div>
                    <div class="template-card-meta">
                        ${template.layers?.length || 0} layer(s) • Used ${template.usage_count || 0} times
                    </div>
                </div>
            `;
        }).join('');
    }

    generateTemplatePreview(template) {
        if (!template.layers || template.layers.length === 0) {
            return '(empty)';
        }

        const lines = [];
        const sortedLayers = [...template.layers].sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));

        for (const layer of sortedLayers.slice(0, 4)) {
            const yPos = layer.position?.y || 0;
            const height = layer.position?.height || 50;
            const text = layer.content?.text || layer.name || 'Layer';
            const truncated = text.length > 25 ? text.substring(0, 22) + '...' : text;
            lines.push(`Y:${yPos} H:${height} "${truncated}"`);
        }

        if (sortedLayers.length > 4) {
            lines.push(`... +${sortedLayers.length - 4} more`);
        }

        return lines.join('\n');
    }

    filterTemplates() {
        this.renderTemplates();
    }

    selectTemplate(presetId) {
        const template = this.templates.find(t => t.preset_id === presetId);
        if (!template) return;

        this.selectedTemplate = template;
        this.renderTemplates();

        // Show apply section
        const applySection = document.getElementById('templateApplySection');
        const templateName = document.getElementById('selectedTemplateName');

        if (applySection && templateName) {
            applySection.style.display = 'block';
            templateName.textContent = template.name;
        }

        this.log(`Selected template: ${template.name}`);
    }

    clearTemplateSelection() {
        this.selectedTemplate = null;
        this.renderTemplates();

        const applySection = document.getElementById('templateApplySection');
        if (applySection) {
            applySection.style.display = 'none';
        }
    }

    // ============ Multi-TV Selection Methods ============

    setTvMode(mode) {
        this.tvSelectionMode = mode;

        // Update button states
        document.getElementById('singleTvMode')?.classList.toggle('active', mode === 'single');
        document.getElementById('multiTvMode')?.classList.toggle('active', mode === 'multi');

        // Show/hide selectors
        document.getElementById('singleTvSelector').style.display = mode === 'single' ? 'block' : 'none';
        document.getElementById('multiTvSelector').style.display = mode === 'multi' ? 'block' : 'none';

        this.log(`TV selection mode: ${mode}`);
    }

    renderTvCheckboxes() {
        const container = document.getElementById('tvCheckboxList');
        if (!container || !this.tvs) return;

        container.innerHTML = this.tvs.map(tv => `
            <label class="tv-checkbox-item">
                <input type="checkbox" value="${tv._id}" onchange="updateSelectedTvs()">
                <span>${this.escapeHtml(tv.name)} (${this.escapeHtml(tv.location)})</span>
            </label>
        `).join('');

        this.updateSelectedTvCount();
    }

    updateSelectedTvs() {
        const checkboxes = document.querySelectorAll('#tvCheckboxList input[type="checkbox"]:checked');
        this.selectedTvIds = Array.from(checkboxes).map(cb => cb.value);
        this.updateSelectedTvCount();
    }

    updateSelectedTvCount() {
        const countEl = document.getElementById('selectedTvCount');
        if (countEl) {
            countEl.textContent = `${this.selectedTvIds.length} selected`;
        }
    }

    selectAllTvs() {
        const checkboxes = document.querySelectorAll('#tvCheckboxList input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
        this.updateSelectedTvs();
    }

    deselectAllTvs() {
        const checkboxes = document.querySelectorAll('#tvCheckboxList input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        this.updateSelectedTvs();
    }

    getSelectedTvIds() {
        if (this.tvSelectionMode === 'single') {
            return this.selectedTvId ? [this.selectedTvId] : [];
        }
        return this.selectedTvIds;
    }

    // ============ Template Apply Methods ============

    async applyTemplateToSelectedTvs() {
        if (!this.selectedTemplate) {
            this.log('Please select a template first', 'error');
            return;
        }

        const tvIds = this.getSelectedTvIds();
        if (tvIds.length === 0) {
            this.log('Please select at least one TV', 'error');
            return;
        }

        const overrideExisting = document.getElementById('overrideExistingLayers')?.checked || false;

        try {
            const response = await fetch(`${this.apiBase}/presets/apply-bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preset_id: this.selectedTemplate.preset_id,
                    tv_ids: tvIds,
                    override_existing: overrideExisting
                })
            });

            const result = await response.json();

            if (result.success) {
                const successCount = result.data.results.filter(r => r.success).length;
                const failures = result.data.results.filter(r => !r.success);

                this.log(`Template "${this.selectedTemplate.name}" applied to ${successCount}/${tvIds.length} TVs`);

                // Show detailed results in log
                if (failures.length > 0) {
                    failures.forEach(f => this.log(`Failed for ${f.tv_id}: ${f.error}`, 'warning'));
                }

                // Show user-friendly feedback
                if (successCount === tvIds.length) {
                    alert(`✅ Template "${this.selectedTemplate.name}" applied successfully to ${successCount} TV(s)!`);
                } else if (successCount > 0) {
                    alert(`⚠️ Template applied to ${successCount}/${tvIds.length} TVs.\n\nFailed:\n${failures.map(f => `• ${f.tv_id}: ${f.error}`).join('\n')}`);
                } else {
                    alert(`❌ Failed to apply template to any TV.\n\n${failures.map(f => `• ${f.tv_id}: ${f.error}`).join('\n')}`);
                }

                // Reload layers if current TV was affected
                if (tvIds.includes(this.selectedTvId)) {
                    await this.loadLayers();
                }

                this.clearTemplateSelection();
            } else {
                this.log(`Failed to apply template: ${result.error}`, 'error');
                alert(`❌ Failed to apply template: ${result.error}`);
            }
        } catch (error) {
            this.log(`Error applying template: ${error.message}`, 'error');
            alert(`❌ Error applying template: ${error.message}`);
        }
    }

    // ============ Save Layer as Template Methods ============

    openSaveTemplateModal(layerId = null) {
        const targetLayerId = layerId || this.selectedLayerId;
        const layer = this.layers.find(l => l.layer_id === targetLayerId);
        if (!layer) {
            this.log('Please select a layer first', 'error');
            alert('Select a layer first, then save it as a template.');
            return;
        }
        this.showSaveTemplateModal(targetLayerId, '💾 Save Layer as Template', '');
    }

    // Every Layer Control layer on the selected TV, saved as one custom template
    openSaveLayoutModal() {
        const count = this.controlLayers.length;
        if (!this.selectedTvId || count === 0) {
            alert('This TV has no layers to save yet.');
            return;
        }
        const tvName = this.selectedTv?.name || 'this TV';
        this.showSaveTemplateModal('', `💾 Save Layout as Template (${count} layer${count === 1 ? '' : 's'})`,
            `Layout saved from ${tvName}`);
    }

    showSaveTemplateModal(layerId, title, description) {
        document.getElementById('saveTemplateTitle').textContent = title;
        document.getElementById('templateLayerId').value = layerId;
        document.getElementById('templateName').value = '';
        document.getElementById('templateDescription').value = description;
        document.getElementById('templateCategory').value = layerId ? 'custom' : 'layout';
        document.getElementById('saveTemplateModal').classList.add('show');
        document.getElementById('templateName').focus();
    }

    closeSaveTemplateModal() {
        document.getElementById('saveTemplateModal').classList.remove('show');
    }

    async saveLayerAsTemplate(event) {
        event.preventDefault();

        const layerId = document.getElementById('templateLayerId').value;
        const name = document.getElementById('templateName').value.trim();
        const description = document.getElementById('templateDescription').value.trim();
        const category = document.getElementById('templateCategory').value;

        if (!name || name.length < 3) {
            this.log('Template name must be at least 3 characters', 'error');
            return;
        }

        try {
            const url = layerId
                ? this.layersUrl(`/${layerId}/save-as-template`)
                : `${this.apiBase}/presets/save-layout/${this.selectedTvId}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, category })
            });

            const result = await response.json();

            if (result.success) {
                const what = layerId ? 'Layer' : `Layout (${result.data.layers.length} layers)`;
                this.log(`${what} saved as template "${name}"`);
                this.closeSaveTemplateModal();
                await this.loadTemplates();
                alert(`✅ ${what} saved as template "${name}"!\n\nApply it to any TV from the 📚 Templates sidebar.`);
            } else {
                this.log(`Failed to save template: ${result.error}`, 'error');
                alert(`❌ Failed to save template: ${result.error}`);
            }
        } catch (error) {
            this.log(`Error saving template: ${error.message}`, 'error');
            alert(`❌ Error saving template: ${error.message}`);
        }
    }

    toggleTemplateSidebar() {
        const sidebar = document.getElementById('templateSidebar');
        if (sidebar) {
            sidebar.classList.toggle('open');
        }
    }
}

// Global functions for HTML onclick handlers
let manager;

document.addEventListener('DOMContentLoaded', () => {
    manager = new MultiLayerManager();
});

function loadTVs() {
    manager.loadTVs();
}

function selectLayer(layerId) {
    manager.selectLayer(layerId);
}

function saveLayer(event) {
    manager.saveLayer(event);
}

function newLayer() {
    manager.newLayer();
}

function onLayerImageChange() {
    manager.onLayerImageChange();
}

function selectScene(sceneId) {
    manager.selectScene(sceneId);
}

function openNewSceneModal() {
    manager.openNewSceneModal();
}

function createScene(event) {
    manager.createScene(event);
}

function renameScene() {
    manager.renameScene();
}

function duplicateScene() {
    manager.duplicateScene();
}

function deleteScene() {
    manager.deleteScene();
}

function insertToken(token) {
    manager.insertToken(token);
}

function uploadCalendar(input) {
    manager.uploadCalendar(input);
}

function animateSelected(type) {
    manager.animateSelected(type);
}

function toggleLayerVisibility(layerId, visible) {
    manager.toggleLayerVisibility(layerId, visible);
}

function deleteLayer(layerId) {
    manager.deleteLayer(layerId);
}

function createSampleLayers() {
    manager.createSampleLayers();
}

function hideAllLayers() {
    manager.hideAllLayers();
}

function showAllLayers() {
    manager.showAllLayers();
}

function deleteAllLayers() {
    manager.deleteAllLayers();
}

function selectAlertType(type) {
    manager.selectAlertType(type);
}

function selectTargetType(targetType) {
    manager.selectTargetType(targetType);
}

function broadcastAlert() {
    manager.broadcastAlert();
}

function dismissAlert(alertId) {
    manager.dismissAlert(alertId);
}

// Template management global functions
function toggleTemplateSidebar() {
    manager.toggleTemplateSidebar();
}

function filterTemplates() {
    manager.filterTemplates();
}

function selectTemplate(presetId) {
    manager.selectTemplate(presetId);
}

function clearTemplateSelection() {
    manager.clearTemplateSelection();
}

function applyTemplateToSelectedTvs() {
    manager.applyTemplateToSelectedTvs();
}

function openSaveTemplateModal() {
    manager.openSaveTemplateModal();
}

function openSaveLayoutModal() {
    manager.openSaveLayoutModal();
}

function layerItemClicked(event, layerId) {
    manager.layerItemClicked(event, layerId);
}

function closeSaveTemplateModal() {
    manager.closeSaveTemplateModal();
}

function saveLayerAsTemplate(event) {
    manager.saveLayerAsTemplate(event);
}

// Multi-TV selection global functions
function setTvMode(mode) {
    manager.setTvMode(mode);
}

function updateSelectedTvs() {
    manager.updateSelectedTvs();
}

function selectAllTvs() {
    manager.selectAllTvs();
}

function deselectAllTvs() {
    manager.deselectAllTvs();
}

async function quickSendTemplate(templateId) {
    try {
        const response = await fetch(`/api/alerts/templates/${templateId}`);
        const data = await response.json();

        if (!data.success) {
            alert('Failed to load template');
            return;
        }

        const template = data.data;

        if (template.variables.length === 0) {
            if (confirm(`Send "${template.name}" alert to all TVs?`)) {
                await sendTemplateAlert(templateId, {}, 'all');
            }
            return;
        }

        const variables = {};
        for (const variable of template.variables) {
            const label = variable.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const value = prompt(`Enter ${label}:`);
            if (value === null) {
                return;
            }
            variables[variable] = value;
        }

        await sendTemplateAlert(templateId, variables, 'all');
    } catch (error) {
        console.error('Error with quick-send template:', error);
        alert('Error sending template alert');
    }
}

async function sendTemplateAlert(templateId, variables, targetType) {
    try {
        const response = await fetch(`/api/alerts/templates/${templateId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variables,
                target_type: targetType,
                created_by: 'admin'
            })
        });

        const data = await response.json();

        if (data.success) {
            alert(`✅ Alert sent to ${data.data.delivered_count} TVs!\n\nTitle: ${data.data.alert.title}`);
            manager.loadActiveAlerts();
            loadQueueStatus();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error sending template alert:', error);
        alert('Error sending alert');
    }
}

async function loadQueueStatus() {
    try {
        const response = await fetch('/api/alerts/queue');
        const data = await response.json();

        if (data.success) {
            const queueCount = document.getElementById('queueCount');
            const queueList = document.getElementById('queueList');

            queueCount.textContent = data.data.queue_length;

            if (data.data.queue.length === 0) {
                queueList.innerHTML = '<div style="color: #64748b; font-size: 13px; padding: 8px;">No alerts in queue</div>';
                return;
            }

            queueList.innerHTML = data.data.queue.map((item, index) => `
                <div style="background: #f8fafc; padding: 10px; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid ${getAlertColor(item.type)};">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1;">
                            <div style="font-weight: 500; font-size: 14px;">${manager.escapeHtml(item.title)}</div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                                Position: ${index + 1} | Type: ${item.type} | ${item.target_tv_count} TVs
                            </div>
                        </div>
                        <button class="btn btn-danger btn-small" onclick="removeFromQueue('${item.alert_id}')" style="font-size: 11px; padding: 4px 8px;">
                            ✕
                        </button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading queue status:', error);
    }
}

async function clearAlertQueue() {
    if (!confirm('Clear all queued alerts?')) {
        return;
    }

    try {
        const response = await fetch('/api/alerts/queue/clear', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            alert(`Cleared ${data.data.cleared_count} alerts from queue`);
            loadQueueStatus();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error clearing queue:', error);
        alert('Error clearing queue');
    }
}

async function removeFromQueue(alertId) {
    try {
        const response = await fetch(`/api/alerts/queue/${alertId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            loadQueueStatus();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error removing from queue:', error);
        alert('Error removing alert');
    }
}

function getAlertColor(type) {
    switch (type) {
        case 'CRITICAL': return '#dc2626';
        case 'URGENT': return '#d97706';
        case 'INFO': return '#2563eb';
        default: return '#64748b';
    }
}

// Fallback refresh for queue status every 60 seconds (primary updates via WebSocket)
setInterval(loadQueueStatus, 60000);
setTimeout(loadQueueStatus, 1000);

// ============ Alert Scheduling Functions ============

function toggleScheduleForm() {
    const container = document.getElementById('scheduleFormContainer');
    container.style.display = container.style.display === 'none' ? 'block' : 'none';

    if (container.style.display === 'block') {
        // datetime-local wants local time, not UTC
        const inTenMinutes = new Date(Date.now() + 10 * 60000);
        document.getElementById('scheduleDateTime').value =
            new Date(inTenMinutes.getTime() - inTenMinutes.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
}

async function scheduleCurrentAlert() {
    const title = document.getElementById('alertTitle').value.trim();
    const message = document.getElementById('alertMessage').value.trim();
    const type = manager.selectedAlertType;
    const targetType = manager.selectedTargetType;
    const targetLocation = document.getElementById('targetLocationInput')?.value?.trim() || null;

    if (!title || !message) {
        alert('Please enter alert title and message before scheduling');
        return;
    }

    const scheduledFor = document.getElementById('scheduleDateTime').value;
    if (!scheduledFor) {
        alert('Please select a date and time');
        return;
    }

    const scheduledDate = new Date(scheduledFor);
    if (scheduledDate <= new Date()) {
        alert('Scheduled time must be in the future');
        return;
    }

    const recurrencePattern = document.getElementById('scheduleRecurrence').value || null;
    const recurrenceEnd = document.getElementById('recurrenceEnd').value || null;

    try {
        const response = await fetch('/api/alerts/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                message,
                type,
                target_type: targetType,
                target_location: targetLocation,
                scheduled_for: new Date(scheduledFor).toISOString(),
                recurrence_pattern: recurrencePattern,
                recurrence_end: recurrenceEnd ? new Date(recurrenceEnd).toISOString() : null,
                created_by: 'admin'
            })
        });

        const data = await response.json();

        if (data.success) {
            const timeUntil = formatScheduleTime(data.data.time_until_ms);
            alert(`✅ Alert scheduled for ${new Date(scheduledFor).toLocaleString()}!\n\nExecutes ${timeUntil}`);

            document.getElementById('alertTitle').value = '';
            document.getElementById('alertMessage').value = '';
            toggleScheduleForm();
            loadScheduledAlerts();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error scheduling alert:', error);
        alert('Error scheduling alert');
    }
}

async function loadScheduledAlerts() {
    try {
        const response = await fetch('/api/alerts/scheduled');
        const data = await response.json();

        if (data.success) {
            const scheduledCount = document.getElementById('scheduledCount');
            const scheduledList = document.getElementById('scheduledList');

            scheduledCount.textContent = data.data.length;

            if (data.data.length === 0) {
                scheduledList.innerHTML = '<div style="color: #64748b; font-size: 13px; padding: 8px;">No scheduled alerts</div>';
                return;
            }

            scheduledList.innerHTML = data.data.map(alert => {
                const timeUntil = formatScheduleTime(alert.time_until_ms);
                const isUrgent = alert.time_until_ms < 3600000;
                const recurrenceLabel = alert.recurrence_pattern
                    ? ` • Repeats ${alert.recurrence_pattern}`
                    : '';

                return `
                    <div style="background: #f8fafc; padding: 10px; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid ${getAlertColor(alert.alert_type)};">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div style="flex: 1;">
                                <div style="font-weight: 500; font-size: 14px;">${manager.escapeHtml(alert.title)}</div>
                                <div style="font-size: 12px; color: ${isUrgent ? '#d97706' : '#64748b'}; margin-top: 2px; font-weight: ${isUrgent ? '500' : 'normal'};">
                                    ${isUrgent ? '⏰ ' : ''}${timeUntil} • ${alert.alert_type}${recurrenceLabel}
                                </div>
                                <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                                    ${new Date(alert.scheduled_for).toLocaleString()}
                                </div>
                            </div>
                            <button class="btn btn-danger btn-small" onclick="cancelScheduledAlert('${alert.alert_id}')" style="font-size: 11px; padding: 4px 8px;">
                                Cancel
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading scheduled alerts:', error);
    }
}

async function cancelScheduledAlert(alertId) {
    if (!confirm('Cancel this scheduled alert?')) {
        return;
    }

    try {
        const response = await fetch(`/api/alerts/scheduled/${alertId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            alert('✅ Scheduled alert cancelled');
            loadScheduledAlerts();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error cancelling scheduled alert:', error);
        alert('Error cancelling alert');
    }
}

function formatScheduleTime(ms) {
    if (ms < 0) return 'Past due';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `in ${days}d ${hours % 24}h`;
    if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `in ${minutes}m`;
    return `in ${seconds}s`;
}

document.addEventListener('DOMContentLoaded', function() {
    const recurrenceSelect = document.getElementById('scheduleRecurrence');
    if (recurrenceSelect) {
        recurrenceSelect.addEventListener('change', function() {
            const container = document.getElementById('recurrenceEndContainer');
            container.style.display = this.value ? 'block' : 'none';
        });
    }
});

// Fallback refresh for scheduled alerts every 60 seconds (primary updates via WebSocket)
setInterval(loadScheduledAlerts, 60000);
setTimeout(loadScheduledAlerts, 1500);