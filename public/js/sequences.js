// Sequences: the looping timeline of image and scene clips a TV plays.
// Clips are edited locally and saved as a whole (debounced) with PUT /api/sequences/:id.

const ZOOM_LEVELS = [2, 4, 8, 16, 32]; // timeline pixels per second
const MIN_CLIP_MS = 1000;
const SAVE_DELAY_MS = 400;

class SequenceEditor {
    constructor() {
        this.sequences = [];
        this.sequence = null;      // full document being edited
        this.tvs = [];
        this.images = [];
        this.scenes = [];
        this.sceneDocs = {};       // scene_id -> full scene (for thumbnails)
        this.selectedClipId = null;
        this.zoomIndex = 2;
        this.drag = null;          // clip being reordered
        this.resize = null;        // clip edge being dragged
        this.saveTimer = null;
        this.loaded = false;
        this.pendingSelect = null;   // set by TV Management's "Open in Sequences"
        this.liveTvs = [];           // what each TV reports it is playing
        this.playheadTimer = null;

        document.addEventListener('section-changed', (event) => {
            if (event.detail.section === 'sequences') this.show();
        });
    }

    get pxPerSecond() {
        return ZOOM_LEVELS[this.zoomIndex];
    }

    escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    // app.js and multilayer.js create these as top-level globals (not window properties)
    get app() {
        return typeof app !== 'undefined' ? app : null;
    }

    get layerManager() {
        return typeof manager !== 'undefined' ? manager : null;
    }

    toast(message, type = 'success') {
        this.app?.showToast(message, type);
    }

    async request(url, method = 'GET', body) {
        const response = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || response.statusText);
        return result;
    }

    async show() {
        if (!this.loaded) {
            this.loaded = true;
            this.setupTimelineEvents();
        }
        const select = this.pendingSelect;
        this.pendingSelect = null;
        await this.loadSources();
        await this.loadSequences(select || this.sequence?.sequence_id);
        this.startPlayhead();
    }

    // "Now playing" on the timeline: poll what each TV reports while this page is open
    startPlayhead() {
        clearInterval(this.playheadTimer);
        const tick = async () => {
            if (!document.getElementById('sequences-section').classList.contains('active')) {
                clearInterval(this.playheadTimer);
                return;
            }
            try {
                this.liveTvs = await this.request('/api/tvs');
                this.updatePlayhead();
            } catch (error) {
                console.error('Playhead update failed:', error);
            }
        };
        tick();
        this.playheadTimer = setInterval(tick, 3000);
    }

    // Mark clips on screen without re-rendering (keeps drags and resizes intact)
    updatePlayhead() {
        if (!this.sequence) return;
        const playing = {};
        for (const tv of this.liveTvs) {
            if (this.sequence.tv_ids.includes(tv._id) && tv.current_clip && tv.status === 'online') {
                (playing[tv.current_clip] = playing[tv.current_clip] || []).push(tv.name);
            }
        }
        document.querySelectorAll('#sequenceTrack .clip').forEach(element => {
            const names = playing[element.dataset.clipId];
            element.classList.toggle('now-playing', !!names);
            let badge = element.querySelector('.clip-now');
            if (names && !badge) {
                badge = document.createElement('span');
                badge.className = 'clip-now';
                element.appendChild(badge);
            }
            if (badge) {
                if (names) badge.textContent = `▶ ${names.join(', ')}`;
                else badge.remove();
            }
        });
    }

    async loadSources() {
        const [tvs, images, scenes] = await Promise.all([
            this.request('/api/tvs'),
            this.request('/api/images'),
            this.request('/api/scenes')
        ]);
        this.tvs = tvs;
        this.images = images;
        this.scenes = scenes;
        await Promise.all(scenes.map(async scene => {
            this.sceneDocs[scene.scene_id] = await this.request(`/api/scenes/${scene.scene_id}`);
        }));
    }

    async loadSequences(selectId = this.sequence?.sequence_id) {
        this.sequences = await this.request('/api/sequences');
        const id = this.sequences.some(s => s.sequence_id === selectId) ? selectId : this.sequences[0]?.sequence_id;
        const select = document.getElementById('sequenceSelect');
        select.innerHTML = this.sequences.length
            ? this.sequences.map(s => `<option value="${this.escape(s.sequence_id)}">${this.escape(s.name)}</option>`).join('')
            : '<option value="">No sequences yet</option>';
        select.value = id || '';
        await this.selectSequence(id);
    }

    async selectSequence(sequenceId) {
        this.flushSave();
        this.sequence = sequenceId ? await this.request(`/api/sequences/${sequenceId}`) : null;
        this.selectedClipId = null;
        this.render();
    }

    // --- Rendering ---

    render() {
        this.renderTvs();
        this.renderTimeline();
        this.renderInspector();
    }

    renderTvs() {
        const box = document.getElementById('sequenceTvs');
        if (!this.sequence) {
            box.innerHTML = '';
            return;
        }
        box.innerHTML = '<span class="sequence-tvs-label">Plays on:</span>' + this.tvs.map(tv => {
            const assigned = this.sequence.tv_ids.includes(tv._id);
            const other = !assigned && this.sequences.find(s => s.tv_ids?.includes(tv._id));
            return `<label class="sequence-tv ${assigned ? 'on' : ''}" title="${other ? `Currently plays “${this.escape(other.name)}”` : ''}">
                <input type="checkbox" ${assigned ? 'checked' : ''} onchange="sequenceEditor.toggleTv('${this.escape(tv._id)}', this.checked)">
                ${this.escape(tv.name)}${other ? ` <span class="sequence-tv-other">(${this.escape(other.name)})</span>` : ''}
            </label>`;
        }).join('') || '<span class="sequence-tvs-label">No TVs registered</span>';
    }

    clipSource(clip) {
        if (clip.kind === 'scene') {
            const scene = this.sceneDocs[clip.ref];
            return { name: scene?.name || 'Missing scene', missing: !scene };
        }
        const image = this.images.find(img => img._id === clip.ref);
        return { name: image?.original_name || 'Missing image', missing: !image };
    }

    formatDuration(ms) {
        const seconds = Math.round(ms / 1000);
        return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`;
    }

    // Miniature of a scene from its elements (colour blocks, images, text)
    sceneThumb(sceneId) {
        const scene = this.sceneDocs[sceneId];
        if (!scene) return '';
        const scale = 0.1; // thumbnails are drawn at 192x108 then stretched by CSS
        const manager = this.layerManager;
        return `<div class="scene-thumb">${[...scene.elements]
            .filter(el => el.visible !== false)
            .sort((a, b) => a.priority - b.priority)
            .map(el => {
                const { x, y, width, height } = el.position;
                const content = el.content || {};
                const box = `left:${x / 19.2}%;top:${y / 10.8}%;width:${width / 19.2}%;height:${height / 10.8}%;opacity:${el.opacity ?? 1}`;
                if (content.image_id) {
                    return `<img style="${box}" src="/api/images/${encodeURIComponent(content.image_id)}/attachment?width=160" alt="">`;
                }
                const bg = manager?.cssColor ? manager.cssColor(content.backgroundColor) : 'transparent';
                const color = manager?.cssColor ? manager.cssColor(content.textColor) : '#fff';
                const text = content.table ? '' : (manager?.expandTokens ? manager.expandTokens(content.text) : content.text);
                const align = { center: 'center', right: 'flex-end' }[content.alignment] || 'flex-start';
                const tableRows = content.table
                    ? `<span class="scene-thumb-table" style="background:${manager.cssColor(content.table.headerBackground)}"></span>`
                    : '';
                return `<div style="${box};background:${bg};color:${color};justify-content:${align};font-size:${Math.max((content.fontSize || 24) * scale, 2)}px;font-weight:${content.fontWeight === 'bold' ? 700 : 400}">${tableRows}${this.escape(text)}</div>`;
            }).join('')}</div>`;
    }

    renderTimeline() {
        const track = document.getElementById('sequenceTrack');
        const ruler = document.getElementById('sequenceRuler');
        const summary = document.getElementById('sequenceSummary');
        document.getElementById('sequenceEditor').hidden = !this.sequence;
        document.getElementById('sequenceEmpty').hidden = !!this.sequence;
        if (!this.sequence) return;

        const clips = this.sequence.clips;
        const pps = this.pxPerSecond;
        const totalMs = clips.filter(c => c.enabled).reduce((sum, c) => sum + c.duration_ms, 0);
        const allMs = clips.reduce((sum, c) => sum + c.duration_ms, 0);
        summary.textContent = clips.length
            ? `${clips.length} clip${clips.length === 1 ? '' : 's'} · loop ${this.formatDuration(totalMs)}${totalMs !== allMs ? ` (${clips.filter(c => !c.enabled).length} off)` : ''}`
            : 'Empty: add images or scenes';

        // Ruler: a tick every 5/10/30/60s depending on zoom
        const step = pps >= 16 ? 5 : pps >= 8 ? 10 : pps >= 4 ? 30 : 60;
        const seconds = Math.ceil(allMs / 1000) + step;
        ruler.style.width = `${seconds * pps}px`;
        ruler.innerHTML = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) =>
            `<span class="ruler-tick" style="left:${i * step * pps}px">${this.formatDuration(i * step * 1000)}</span>`).join('');

        track.innerHTML = clips.map((clip, index) => {
            const source = this.clipSource(clip);
            const width = Math.max((clip.duration_ms / 1000) * pps, 24);
            const classes = ['clip', `clip-${clip.kind}`,
                clip.enabled ? '' : 'off',
                source.missing ? 'missing' : '',
                clip.clip_id === this.selectedClipId ? 'selected' : ''].filter(Boolean).join(' ');
            const thumb = clip.kind === 'image' && !source.missing
                ? `<img class="clip-thumb" src="/api/images/${encodeURIComponent(clip.ref)}/attachment?width=160" alt="" draggable="false">`
                : this.sceneThumb(clip.ref);
            return `<div class="${classes}" style="width:${width}px" data-clip-id="${this.escape(clip.clip_id)}" draggable="true"
                         title="${this.escape(source.name)} · ${this.formatDuration(clip.duration_ms)}">
                ${thumb}
                <div class="clip-label">
                    <span class="clip-kind">${clip.kind === 'scene' ? '🎬' : '🖼'}</span>
                    <span class="clip-name">${this.escape(source.name)}</span>
                </div>
                <div class="clip-badges">
                    <span class="clip-duration">${this.formatDuration(clip.duration_ms)}</span>
                    ${clip.schedule ? '<span title="Has a schedule">🗓</span>' : ''}
                    ${clip.enabled ? '' : '<span>Off</span>'}
                </div>
                <span class="clip-index">${index + 1}</span>
                <span class="clip-resize" data-clip-id="${this.escape(clip.clip_id)}" title="Drag to change how long it shows"></span>
            </div>`;
        }).join('') + (clips.length ? '<div class="clip-loop" title="Back to the start">↺</div>' : '');
        this.updatePlayhead();
    }

    renderInspector() {
        const panel = document.getElementById('clipInspector');
        const clip = this.sequence?.clips.find(c => c.clip_id === this.selectedClipId);
        if (!clip) {
            panel.innerHTML = '<p class="clip-inspector-empty">Select a clip to edit it. Drag clips to reorder; drag a clip\'s right edge to change how long it shows.</p>';
            return;
        }
        const index = this.sequence.clips.indexOf(clip);
        const source = this.clipSource(clip);
        const preview = clip.kind === 'image'
            ? `<img src="/api/images/${encodeURIComponent(clip.ref)}/attachment?width=400" alt="">`
            : this.sceneThumb(clip.ref);
        panel.innerHTML = `
            <div class="clip-inspector-preview">${preview}</div>
            <div class="clip-inspector-fields">
                <div class="clip-inspector-title">${clip.kind === 'scene' ? '🎬 Scene' : '🖼 Image'}: ${this.escape(source.name)}</div>
                ${source.missing ? '<p class="clip-warning">This clip\'s source was deleted. Remove the clip or pick another source.</p>' : ''}
                <div class="form-group">
                    <label for="clipDuration">Show for (seconds)</label>
                    <input type="number" id="clipDuration" class="form-input" min="1" max="3600" value="${clip.duration_ms / 1000}"
                           onchange="sequenceEditor.setClipDuration(this.value)">
                </div>
                <label class="clip-enabled"><input type="checkbox" ${clip.enabled ? 'checked' : ''}
                       onchange="sequenceEditor.setClipEnabled(this.checked)"> In rotation</label>
                <p class="clip-schedule">${clip.schedule ? `🗓 ${this.escape(this.describeSchedule(clip.schedule))}` : 'Plays at any time'}</p>
                <div class="clip-inspector-actions">
                    <button class="btn btn-secondary btn-sm" ${index === 0 ? 'disabled' : ''} onclick="sequenceEditor.moveClip(-1)">← Earlier</button>
                    <button class="btn btn-secondary btn-sm" ${index === this.sequence.clips.length - 1 ? 'disabled' : ''} onclick="sequenceEditor.moveClip(1)">Later →</button>
                    <button class="btn btn-danger btn-sm" onclick="sequenceEditor.removeClip()">Remove</button>
                </div>
            </div>`;
    }

    describeSchedule(schedule) {
        return this.app?.describeSchedule(schedule) || 'Scheduled';
    }

    // --- Clip edits (saved after a short pause) ---

    get selectedClip() {
        return this.sequence?.clips.find(c => c.clip_id === this.selectedClipId);
    }

    changed() {
        this.render();
        clearTimeout(this.saveTimer);
        this.setStatus('Saving…');
        this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    }

    flushSave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.save();
        }
    }

    async save() {
        this.saveTimer = null;
        const sequence = this.sequence;
        if (!sequence) return;
        try {
            const saved = await this.request(`/api/sequences/${sequence.sequence_id}`, 'PUT', {
                clips: sequence.clips.map(({ clip_id, kind, ref, duration_ms, enabled, schedule }) =>
                    ({ clip_id, kind, ref, duration_ms, enabled, schedule: schedule || null }))
            });
            if (this.sequence === sequence) this.sequence._rev = saved._rev;
            this.setStatus('Saved');
            this.sequences = await this.request('/api/sequences');
        } catch (error) {
            this.setStatus('Not saved');
            this.toast(`Couldn't save the sequence: ${error.message}`, 'error');
        }
    }

    setStatus(text) {
        document.getElementById('sequenceStatus').textContent = text;
    }

    selectClip(clipId) {
        this.selectedClipId = clipId;
        this.renderTimeline();
        this.renderInspector();
    }

    setClipDuration(seconds) {
        const clip = this.selectedClip;
        const ms = Math.round(Number(seconds) * 1000);
        if (!clip || !Number.isFinite(ms)) return;
        clip.duration_ms = Math.min(Math.max(ms, MIN_CLIP_MS), 3600000);
        this.changed();
    }

    setClipEnabled(enabled) {
        if (!this.selectedClip) return;
        this.selectedClip.enabled = enabled;
        this.changed();
    }

    moveClip(delta) {
        const clips = this.sequence.clips;
        const index = clips.indexOf(this.selectedClip);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= clips.length) return;
        clips.splice(target, 0, clips.splice(index, 1)[0]);
        this.changed();
    }

    removeClip() {
        const clip = this.selectedClip;
        if (!clip) return;
        this.sequence.clips = this.sequence.clips.filter(c => c !== clip);
        this.selectedClipId = null;
        this.changed();
    }

    addClips(newClips) {
        // Insert after the selected clip, or at the end
        const clips = this.sequence.clips;
        const at = this.selectedClip ? clips.indexOf(this.selectedClip) + 1 : clips.length;
        const withIds = newClips.map(clip => ({ ...clip, clip_id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` }));
        clips.splice(at, 0, ...withIds);
        this.selectedClipId = withIds[withIds.length - 1].clip_id;
        this.changed();
    }

    zoom(delta) {
        this.zoomIndex = Math.min(Math.max(this.zoomIndex + delta, 0), ZOOM_LEVELS.length - 1);
        this.renderTimeline();
    }

    // --- Timeline mouse handling: select, reorder (drag & drop), resize (right edge) ---

    setupTimelineEvents() {
        const track = document.getElementById('sequenceTrack');

        track.addEventListener('click', (event) => {
            const clip = event.target.closest('.clip');
            if (clip && !event.target.classList.contains('clip-resize')) this.selectClip(clip.dataset.clipId);
        });

        track.addEventListener('dragstart', (event) => {
            const clip = event.target.closest('.clip');
            if (!clip || this.resize) {
                event.preventDefault();
                return;
            }
            this.drag = clip.dataset.clipId;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', this.drag);
            clip.classList.add('dragging');
        });
        track.addEventListener('dragover', (event) => {
            const clip = event.target.closest('.clip');
            if (!this.drag || !clip) return;
            event.preventDefault();
            track.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
            clip.classList.add(this.dropSide(event, clip) === 'before' ? 'drop-before' : 'drop-after');
        });
        track.addEventListener('drop', (event) => {
            const target = event.target.closest('.clip');
            const dragged = this.drag;
            this.drag = null;
            if (!dragged || !target || target.dataset.clipId === dragged) {
                this.renderTimeline();
                return;
            }
            event.preventDefault();
            const clips = this.sequence.clips;
            const moving = clips.find(c => c.clip_id === dragged);
            const rest = clips.filter(c => c !== moving);
            const index = rest.findIndex(c => c.clip_id === target.dataset.clipId);
            rest.splice(index + (this.dropSide(event, target) === 'after' ? 1 : 0), 0, moving);
            this.sequence.clips = rest;
            this.selectedClipId = dragged;
            this.changed();
        });
        track.addEventListener('dragend', () => {
            if (this.drag) {
                this.drag = null;
                this.renderTimeline();
            }
        });

        // Resize: drag a clip's right edge; whole seconds
        track.addEventListener('pointerdown', (event) => {
            if (!event.target.classList.contains('clip-resize')) return;
            event.preventDefault();
            event.stopPropagation();
            const clip = this.sequence.clips.find(c => c.clip_id === event.target.dataset.clipId);
            this.resize = { clip, startX: event.clientX, startMs: clip.duration_ms, element: event.target.closest('.clip') };
            event.target.setPointerCapture(event.pointerId);
            this.selectedClipId = clip.clip_id;
        });
        track.addEventListener('pointermove', (event) => {
            if (!this.resize) return;
            const { clip, startX, startMs, element } = this.resize;
            const seconds = Math.round((startMs / 1000) + (event.clientX - startX) / this.pxPerSecond);
            clip.duration_ms = Math.max(seconds * 1000, MIN_CLIP_MS);
            element.style.width = `${Math.max(seconds * this.pxPerSecond, 24)}px`;
            element.querySelector('.clip-duration').textContent = this.formatDuration(clip.duration_ms);
        });
        const endResize = () => {
            if (!this.resize) return;
            const changed = this.resize.clip.duration_ms !== this.resize.startMs;
            this.resize = null;
            if (changed) this.changed(); else this.render();
        };
        track.addEventListener('pointerup', endResize);
        track.addEventListener('pointercancel', endResize);
    }

    dropSide(event, element) {
        const rect = element.getBoundingClientRect();
        return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    }

    // --- Adding clips ---

    openImagePicker() {
        const grid = document.getElementById('clipImageGrid');
        grid.innerHTML = this.images.map(img => `
            <label class="clip-picker-tile" title="${this.escape(img.original_name)}">
                <input type="checkbox" value="${this.escape(img._id)}">
                <img src="/api/images/${encodeURIComponent(img._id)}/attachment?width=160" alt="" loading="lazy">
                <span>${this.escape(img.original_name)}</span>
            </label>`).join('') || '<p>No images in the Image Library yet.</p>';
        document.getElementById('clipImageSeconds').value = 10;
        document.getElementById('clipImageModal').classList.add('show');
    }

    addSelectedImages(event) {
        event.preventDefault();
        const ids = [...document.querySelectorAll('#clipImageGrid input:checked')].map(cb => cb.value);
        const seconds = Math.max(Number(document.getElementById('clipImageSeconds').value) || 10, 1);
        document.getElementById('clipImageModal').classList.remove('show');
        if (!ids.length) return;
        this.addClips(ids.map(ref => ({ kind: 'image', ref, duration_ms: seconds * 1000, enabled: true, schedule: null })));
        this.toast(`Added ${ids.length} image clip(s)`);
    }

    openScenePicker() {
        document.getElementById('clipSceneSelect').innerHTML = this.scenes.map(scene =>
            `<option value="${this.escape(scene.scene_id)}">${this.escape(scene.name)} (${scene.element_count} elements)</option>`).join('');
        document.getElementById('clipSceneSeconds').value = 30;
        document.getElementById('clipSceneModal').classList.add('show');
    }

    addSelectedScene(event) {
        event.preventDefault();
        const ref = document.getElementById('clipSceneSelect').value;
        const seconds = Math.max(Number(document.getElementById('clipSceneSeconds').value) || 30, 1);
        document.getElementById('clipSceneModal').classList.remove('show');
        if (!ref) return;
        this.addClips([{ kind: 'scene', ref, duration_ms: seconds * 1000, enabled: true, schedule: null }]);
    }

    // --- Sequences ---

    async newSequence() {
        const name = prompt('Name for the new sequence', 'Lobby');
        if (!name?.trim()) return;
        try {
            const created = await this.request('/api/sequences', 'POST', { name: name.trim() });
            await this.loadSequences(created.sequence_id);
        } catch (error) {
            this.toast(error.message, 'error');
        }
    }

    async renameSequence() {
        if (!this.sequence) return;
        const name = prompt('Sequence name', this.sequence.name);
        if (!name?.trim() || name.trim() === this.sequence.name) return;
        this.flushSave();
        try {
            await this.request(`/api/sequences/${this.sequence.sequence_id}`, 'PUT', { name: name.trim() });
            await this.loadSequences();
        } catch (error) {
            this.toast(error.message, 'error');
        }
    }

    async duplicateSequence() {
        if (!this.sequence) return;
        this.flushSave();
        try {
            const copy = await this.request(`/api/sequences/${this.sequence.sequence_id}/duplicate`, 'POST', {});
            await this.loadSequences(copy.sequence_id);
            this.toast(`Duplicated as “${copy.name}” (not playing on any TV yet)`);
        } catch (error) {
            this.toast(error.message, 'error');
        }
    }

    async deleteSequence() {
        if (!this.sequence) return;
        const tvNote = this.sequence.tv_ids.length ? ` It plays on ${this.sequence.tv_ids.length} TV(s).` : '';
        if (!confirm(`Delete the sequence “${this.sequence.name}”?${tvNote}`)) return;
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        try {
            await this.request(`/api/sequences/${this.sequence.sequence_id}`, 'DELETE');
            this.sequence = null;
            await this.loadSequences();
        } catch (error) {
            this.toast(error.message, 'error');
        }
    }

    async toggleTv(tvId, assign) {
        const tvName = this.tvs.find(tv => tv._id === tvId)?.name || tvId;
        const other = this.sequences.find(s => s.sequence_id !== this.sequence.sequence_id && s.tv_ids?.includes(tvId));
        if (assign && other && !confirm(`${tvName} currently plays “${other.name}”. Switch it to “${this.sequence.name}”?`)) {
            this.renderTvs();
            return;
        }
        const tvIds = assign
            ? [...this.sequence.tv_ids, tvId]
            : this.sequence.tv_ids.filter(id => id !== tvId);
        try {
            this.flushSave();
            const saved = await this.request(`/api/sequences/${this.sequence.sequence_id}/tvs`, 'PUT', { tv_ids: tvIds });
            this.sequence.tv_ids = saved.tv_ids;
            this.sequence._rev = saved._rev;
            this.sequences = await this.request('/api/sequences');
            this.renderTvs();
        } catch (error) {
            this.toast(error.message, 'error');
            this.renderTvs();
        }
    }
}

const sequenceEditor = new SequenceEditor();
