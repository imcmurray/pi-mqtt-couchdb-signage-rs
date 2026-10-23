// Digital Signage Management App

// Shown in place of an image preview that fails to load
const IMAGE_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">' +
    '<rect width="200" height="150" fill="#f8f9fa"/>' +
    '<text x="100" y="75" text-anchor="middle" fill="#666" font-family="Arial" font-size="12">No Preview</text>' +
    '</svg>'
);

class DigitalSignageApp {
    constructor() {
        this.ws = null;
        this.currentSection = 'dashboard';
        this.tvs = [];
        this.images = [];
        this.currentImageId = null;
        // TV Management "Images" section; kept here because the TV list re-renders on every heartbeat
        this.expandedPlaylists = new Set();
        this.playlists = {};           // tvId -> [{ _id, original_name, enabled, ... }]
        this.playlistSelection = {};   // tvId -> Set of selected image ids
        this.darkTheme = localStorage.getItem('darkTheme') === 'true';
        this.mqttMessages = {
            general: [],
            signage: []
        };
        this.mqttPaused = false;
        this.maxMqttMessages = 100;
        this.mqttTvFilter = 'all';
        this.mqttTopicFilter = null;
        this.mqttTopicTreeVisible = false;
        this.mqttExpandedBranches = new Set();

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initWebSocket();
        this.loadInitialData();
        this.setupUploadArea();
        this.initTheme();
        this.loadVersionInfo();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.dataset.section;
                this.switchSection(section);
            });
        });

        // Modal close buttons
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeModal();
            });
        });

        // TV Form
        document.getElementById('tv-form').addEventListener('submit', (e) => {
            this.handleTvFormSubmit(e);
        });

        // Add TV button
        document.getElementById('add-tv-btn').addEventListener('click', () => {
            this.showTvModal();
        });

        // Image assignment
        document.getElementById('confirm-assignment').addEventListener('click', () => {
            this.confirmImageAssignment();
        });

        // Search images
        document.getElementById('search-images').addEventListener('input', (e) => {
            this.searchImages(e.target.value);
        });

        // Filter by TV
        document.getElementById('filter-tv').addEventListener('change', (e) => {
            this.filterImagesByTv(e.target.value);
        });

        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => {
            this.toggleTheme();
        });

        // MQTT controls
        document.getElementById('clear-mqtt-logs').addEventListener('click', () => {
            this.clearMqttLogs();
        });

        document.getElementById('toggle-mqtt-pause').addEventListener('click', () => {
            this.toggleMqttPause();
        });

        // Version info click handler
        document.getElementById('version-info').addEventListener('click', () => {
            this.showVersionModal();
        });

        // MQTT TV filter
        document.getElementById('mqtt-tv-filter')?.addEventListener('change', (e) => {
            this.mqttTvFilter = e.target.value;
            this.updateMqttDisplay();
        });

        // Topic tree toggle
        document.getElementById('toggle-topic-tree')?.addEventListener('click', () => {
            this.toggleTopicTree();
        });
    }

    initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.updateConnectionStatus(true);
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus(false);
            // Attempt to reconnect after 5 seconds
            setTimeout(() => this.initWebSocket(), 5000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus(false);
        };
    }

    handleWebSocketMessage(data) {
        if (data.type === 'mqtt_update') {
            const { topic, payload } = data.data;
            console.log('MQTT update:', topic, payload);
            
            // Add to MQTT activity monitor
            this.addMqttMessage(topic, payload);
            
            // Update TV status in real-time
            if (topic.includes('/status') || topic.includes('/heartbeat')) {
                this.updateTvStatus(topic, payload);
            }
            
            // Update current image when Pi changes images
            if (topic.includes('/image/current')) {
                this.updateTvCurrentImage(topic, payload);
            } else if (topic.includes('/status') && payload.current_image) {
                // Manual next/previous only reports the new image in the status message
                this.updateTvCurrentImage(topic, { image_id: payload.current_image });
            }
        }
    }

    updateConnectionStatus(connected) {
        const statusDot = document.getElementById('connection-status');
        const statusText = document.getElementById('connection-text');
        
        if (connected) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Connected';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Disconnected';
        }
    }

    async loadInitialData() {
        this.showLoading(true);

        try {
            await Promise.all([
                this.loadDashboardData(),
                this.loadTvs(),
                this.loadImages()
            ]);
            // Re-render once images are loaded so "Currently Playing" can resolve its image
            this.updateTvOverview(this.tvs);
            this.startLastSeenTimer();
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showToast('Error loading data', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadDashboardData() {
        try {
            const response = await fetch('/api/dashboard/overview');
            const data = await response.json();

            this.updateDashboardStats(data.stats);
            this.updateTvOverview(data.tvs);
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }

    updateDashboardStatsFromTvs() {
        const online = this.tvs.filter(tv => tv.status === 'online').length;
        const offline = this.tvs.filter(tv => tv.status !== 'online').length;

        this.updateDashboardStats({
            total_tvs: this.tvs.length,
            online_tvs: online,
            offline_tvs: offline,
            total_images: this.images.length
        });
    }

    async loadTvs() {
        try {
            const response = await fetch('/api/tvs');
            this.tvs = await response.json();
            this.updateTvList();
            this.populateTvFilters();
            this.populateMqttTvFilter();
        } catch (error) {
            console.error('Error loading TVs:', error);
        }
    }

    async loadImages() {
        try {
            const response = await fetch('/api/images');
            this.images = await response.json();
            this.updateImageGrid();

            // Assignments may have changed; refresh any open Images sections
            this.playlists = {};
            this.expandedPlaylists.forEach(tvId => this.loadPlaylist(tvId));
        } catch (error) {
            console.error('Error loading images:', error);
        }
    }

    updateDashboardStats(stats) {
        document.getElementById('total-tvs').textContent = stats.total_tvs;
        document.getElementById('online-tvs').textContent = stats.online_tvs;
        document.getElementById('offline-tvs').textContent = stats.offline_tvs;
        document.getElementById('total-images').textContent = stats.total_images;
    }

    updateTvOverview(tvs) {
        const grid = document.getElementById('tv-overview-grid');
        grid.innerHTML = '';

        tvs.forEach(tv => {
            const card = this.createTvOverviewCard(tv);
            grid.appendChild(card);
        });
    }

    createTvOverviewCard(tv) {
        const card = document.createElement('div');
        card.className = 'tv-card';
        
        const statusClass = tv.status === 'online' ? 'online' : 'offline';
        const statusIcon = tv.status === 'online' ? 'fa-circle' : 'fa-exclamation-triangle';
        
        // Get current image for thumbnail - check both field names for compatibility
        const currentImageId = tv.current_image_id || tv.current_image;
        const currentImage = currentImageId ? this.images.find(img => img._id === currentImageId) : null;
        const thumbnailHtml = currentImage ? 
            `<img src="/api/images/${currentImage._id}/attachment?width=160" alt="${this.escapeHtml(currentImage.original_name)}" class="tv-current-thumbnail">` :
            `<div class="tv-no-image"><i class="fas fa-image"></i></div>`;
        
        card.innerHTML = `
            <div class="tv-card-header">
                <div class="tv-card-title">${tv.name}</div>
                <div class="tv-card-location">${tv.location}</div>
            </div>
            <div class="tv-card-body">
                <div class="tv-status">
                    <span class="status-dot ${statusClass}"></span>
                    <span>${this.formatTvStatus(tv)}</span>
                </div>
                <div class="tv-current-section">
                    <div class="tv-current-thumbnail-container">
                        ${thumbnailHtml}
                    </div>
                    <div class="tv-current-info">
                        <div class="tv-current-label">Currently Playing:</div>
                        <div class="tv-current-name" title="${currentImage ? this.escapeHtml(currentImage.original_name) : ''}">${currentImage ? this.escapeHtml(currentImage.original_name) : 'None'}</div>
                    </div>
                </div>
                <div class="tv-system-metrics" id="system-metrics-${tv._id}">
                    <div class="metrics-left">
                        <div class="system-metric">
                            <i class="fas fa-thermometer-half"></i>
                            <span class="metric-label">Temp:</span>
                            <span class="metric-value" id="temp-${tv._id}">${this.formatMetricValue(tv.system_metrics?.temperature, '°C', '--°C')}</span>
                        </div>
                        <div class="system-metric">
                            <i class="fas fa-microchip"></i>
                            <span class="metric-label">CPU:</span>
                            <span class="metric-value" id="cpu-${tv._id}">${this.formatMetricValue(tv.system_metrics?.cpu_usage, '%', '--%')}</span>
                        </div>
                        <div class="system-metric">
                            <i class="fas fa-memory"></i>
                            <span class="metric-label">RAM:</span>
                            <span class="metric-value" id="memory-${tv._id}">${this.formatMetricValue(tv.system_metrics?.memory_usage, '%', '--%')}</span>
                        </div>
                    </div>
                    <div class="metrics-right">
                        <div class="system-metric">
                            <i class="fas fa-server"></i>
                            <span class="metric-label">Device:</span>
                            <span class="metric-value" id="device-uptime-${tv._id}">${this.formatUptime(tv.system_metrics?.device_uptime_seconds)}</span>
                        </div>
                        <div class="system-metric">
                            <i class="fas fa-clock"></i>
                            <span class="metric-label">App:</span>
                            <span class="metric-value" id="app-uptime-${tv._id}">${this.formatUptime(tv.system_metrics?.app_uptime_seconds)}</span>
                        </div>
                    </div>
                </div>
                <div class="tv-controls">
                    <button class="btn btn-sm btn-success" onclick="app.controlTv('${tv._id}', 'play')">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-sm btn-warning" onclick="app.controlTv('${tv._id}', 'pause')">
                        <i class="fas fa-pause"></i>
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="app.controlTv('${tv._id}', 'next')">
                        <i class="fas fa-forward"></i>
                    </button>
                </div>
            </div>
        `;
        
        return card;
    }

    updateTvList() {
        const list = document.getElementById('tv-list');
        list.innerHTML = '';

        this.tvs.forEach(tv => {
            const item = this.createTvListItem(tv);
            list.appendChild(item);
        });
        
        // Load version info for all TVs after DOM is updated
        setTimeout(() => {
            this.tvs.forEach(tv => {
                this.loadTvVersionInfo(tv);
            });
        }, 100);
    }

    createTvListItem(tv) {
        const item = document.createElement('div');
        item.className = 'tv-list-item';

        const statusClass = tv.status === 'online' ? 'online' : 'offline';

        const currentImageId = tv.current_image_id || tv.current_image;
        const currentImage = currentImageId ? this.images.find(img => img._id === currentImageId) : null;
        const thumbnailHtml = currentImage ?
            `<img src="/api/images/${currentImage._id}/attachment?width=160" alt="${this.escapeHtml(currentImage.original_name)}" class="tv-thumbnail">` :
            `<div class="tv-thumbnail-placeholder"><i class="fas fa-image"></i><span>No Image</span></div>`;

        const tvIdShort = tv._id.replace('tv_', '');
        const tvIdTruncated = tvIdShort.substring(0, 8);

        item.innerHTML = `
            <div class="tv-card-layout">
                <div class="tv-card-header">
                    <div class="tv-card-title-section">
                        <div class="tv-card-title">${tv.name}</div>
                        <div class="tv-card-location"><i class="fas fa-map-marker-alt"></i> ${tv.location}</div>
                    </div>
                    <div class="tv-card-status-row">
                        <span class="status-badge ${statusClass}">${this.formatTvStatus(tv)}</span>
                        <div class="last-seen-container">
                            <i class="fas fa-signal"></i>
                            <span class="last-seen-value" id="last-seen-${tv._id}">${this.formatTimeSince(tv.last_heartbeat)}</span>
                        </div>
                    </div>
                </div>

                <div class="tv-quick-info">
                    <span class="info-pill"><span class="pill-label">IP:</span> <span class="pill-value">${tv.ip_address}</span></span>
                    <span class="info-pill" id="tv-version-pill-${tv._id}"><span class="pill-label">v</span><span class="pill-value version-loading">...</span></span>
                    <span class="info-pill"><span class="pill-label"></span><span class="pill-value">${this.formatOrientation(tv.config?.orientation || 'landscape')}</span></span>
                </div>

                <div class="tv-current-display">
                    <div class="tv-thumbnail-container">
                        <div class="tv-preview-wrapper">
                            ${thumbnailHtml}
                            <img src="" class="tv-live-stream hidden" id="live-stream-${tv._id}" alt="Live preview">
                            <span class="live-indicator hidden" id="live-indicator-${tv._id}">● LIVE</span>
                        </div>
                        <button class="preview-toggle-btn" id="preview-toggle-${tv._id}"
                                onclick="app.toggleLivePreview('${tv._id}', '${tv.ip_address}')"
                                title="Toggle live preview">
                            <i class="fas fa-video"></i>
                        </button>
                    </div>
                    <div class="tv-display-info">
                        <div class="tv-current-image" id="tv-current-${tv._id}">
                            <span class="detail-label">Currently Showing</span>
                            <span class="detail-value" title="${currentImage ? this.escapeHtml(currentImage.original_name) : ''}">${currentImage ? this.escapeHtml(currentImage.original_name) : 'None'}</span>
                        </div>
                        <div class="tv-id-row">
                            <span class="detail-label">TV ID</span>
                            <span class="tv-id-display" title="${tvIdShort}">${tvIdTruncated}... <i class="fas fa-copy copy-btn" onclick="app.copyToClipboard('${tvIdShort}')"></i></span>
                        </div>
                    </div>
                </div>

                <div class="tv-system-info" id="system-info-${tv._id}">
                    <div class="system-info-grid">
                        <div class="system-info-column">
                            <div class="system-info-item">
                                <i class="fas fa-thermometer-half metric-icon"></i>
                                <span class="detail-label">Temperature</span>
                                <span class="detail-value" id="temp-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.temperature, '°C', '--°C')}</span>
                            </div>
                            <div class="system-info-item">
                                <i class="fas fa-microchip metric-icon"></i>
                                <span class="detail-label">CPU</span>
                                <span class="detail-value" id="cpu-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.cpu_usage, '%', '--%')}</span>
                            </div>
                            <div class="system-info-item">
                                <i class="fas fa-memory metric-icon"></i>
                                <span class="detail-label">Memory</span>
                                <span class="detail-value" id="memory-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.memory_usage, '%', '--%')}</span>
                            </div>
                            <div class="system-info-sub">
                                <span id="memory-bytes-${tv._id}">${this.formatBytes(tv.system_metrics?.memory_used)} / ${this.formatBytes(tv.system_metrics?.memory_total)}</span>
                            </div>
                            <div class="system-info-item">
                                <i class="fas fa-hdd metric-icon"></i>
                                <span class="detail-label">Disk</span>
                                <span class="detail-value" id="disk-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.disk_usage, '%', '--%')}</span>
                            </div>
                            <div class="system-info-sub">
                                <span id="disk-bytes-${tv._id}">${this.formatBytes(tv.system_metrics?.disk_used)} / ${this.formatBytes(tv.system_metrics?.disk_total)}</span>
                            </div>
                        </div>
                        <div class="system-info-column">
                            <div class="system-info-item">
                                <i class="fas fa-server metric-icon"></i>
                                <span class="detail-label">Device Uptime</span>
                                <span class="detail-value" id="device-uptime-detail-${tv._id}">${this.formatUptime(tv.system_metrics?.device_uptime_seconds)}</span>
                            </div>
                            <div class="system-info-item">
                                <i class="fas fa-clock metric-icon"></i>
                                <span class="detail-label">App Uptime</span>
                                <span class="detail-value" id="app-uptime-detail-${tv._id}">${this.formatUptime(tv.system_metrics?.app_uptime_seconds)}</span>
                            </div>
                            <div class="system-info-item">
                                <i class="fas fa-chart-line metric-icon"></i>
                                <span class="detail-label">Load Average</span>
                                <span class="detail-value" id="load-detail-${tv._id}">${tv.system_metrics?.load_average?.toFixed(2) ?? '--'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                ${this.renderTvPlaylist(tv)}

                <div class="tv-actions">
                    <button class="btn btn-sm btn-primary" onclick="app.editTv('${tv._id}')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-sm btn-success" onclick="app.controlTv('${tv._id}', 'play')">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-sm btn-warning" onclick="app.controlTv('${tv._id}', 'pause')">
                        <i class="fas fa-pause"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="app.shuffleTvImages('${tv._id}')">
                        <i class="fas fa-random"></i> Shuffle
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteTv('${tv._id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;

        return item;
    }

    // Expandable "Images" section on a TV Management card
    renderTvPlaylist(tv) {
        const expanded = this.expandedPlaylists.has(tv._id);
        const playlist = this.playlists[tv._id];
        const summary = playlist
            ? `${playlist.filter(img => img.enabled).length} of ${playlist.length} in rotation`
            : '';

        return `
            <div class="tv-playlist">
                <button class="tv-playlist-toggle" onclick="app.togglePlaylist('${tv._id}')">
                    <i class="fas fa-chevron-${expanded ? 'down' : 'right'}"></i>
                    <span>Images</span>
                    <span class="tv-playlist-summary">${summary}</span>
                </button>
                ${expanded ? this.renderTvPlaylistBody(tv, playlist) : ''}
            </div>
        `;
    }

    renderTvPlaylistBody(tv, playlist) {
        if (!playlist) {
            return '<div class="tv-playlist-body"><div class="tv-playlist-empty">Loading images…</div></div>';
        }
        if (playlist.length === 0) {
            return '<div class="tv-playlist-body"><div class="tv-playlist-empty">No images assigned to this TV</div></div>';
        }

        const selected = this.playlistSelection[tv._id] || new Set();
        const allEnabled = playlist.every(img => img.enabled);
        const isPaused = tv.slideshow_state === 'paused';

        const tiles = playlist.map(img => {
            const isCurrent = img._id === tv.current_image;
            const name = this.escapeHtml(img.original_name);
            const classes = ['playlist-tile',
                img.enabled ? '' : 'disabled',
                selected.has(img._id) ? 'selected' : '',
                isCurrent ? 'current' : ''].filter(Boolean).join(' ');

            return `
                <div class="${classes}" onclick="app.togglePlaylistSelection('${tv._id}', '${img._id}')" title="${name}">
                    <div class="playlist-thumb">
                        <img src="/api/images/${img._id}/attachment?width=160" alt="${name}" loading="lazy">
                        ${isCurrent ? `<span class="playlist-badge now">${isPaused ? 'Holding' : 'Now showing'}</span>` : ''}
                        ${img.enabled ? '' : '<span class="playlist-badge off">Off</span>'}
                        <span class="playlist-check"><i class="fas fa-check"></i></span>
                    </div>
                    <div class="playlist-tile-name">${name}</div>
                    <div class="playlist-tile-actions">
                        <button class="btn btn-sm ${img.enabled ? 'btn-secondary' : 'btn-success'}"
                                title="${img.enabled ? 'Take out of rotation' : 'Put back in rotation'}"
                                onclick="event.stopPropagation(); app.setPlaylistImageEnabled('${tv._id}', '${img._id}', ${!img.enabled})">
                            <i class="fas fa-eye${img.enabled ? '' : '-slash'}"></i>
                        </button>
                        <button class="btn btn-sm btn-primary" title="Show now" ${img.enabled ? '' : 'disabled'}
                                onclick="event.stopPropagation(); app.showPlaylistImage('${tv._id}', '${img._id}', false)">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="btn btn-sm btn-warning" title="Show and hold (pause on it)" ${img.enabled ? '' : 'disabled'}
                                onclick="event.stopPropagation(); app.showPlaylistImage('${tv._id}', '${img._id}', true)">
                            <i class="fas fa-thumbtack"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="tv-playlist-body">
                <div class="tv-playlist-toolbar">
                    <span class="tv-playlist-hint">Click images to select them</span>
                    <button class="btn btn-sm btn-primary" ${selected.size ? '' : 'disabled'}
                            onclick="app.cycleOnlySelected('${tv._id}')">
                        <i class="fas fa-sync-alt"></i> Cycle only selected (${selected.size})
                    </button>
                    <button class="btn btn-sm btn-secondary" ${allEnabled ? 'disabled' : ''}
                            onclick="app.enableAllPlaylist('${tv._id}')">
                        <i class="fas fa-eye"></i> Enable all
                    </button>
                    ${isPaused ? `
                        <button class="btn btn-sm btn-success" onclick="app.controlTv('${tv._id}', 'play')">
                            <i class="fas fa-play"></i> Resume rotation
                        </button>` : ''}
                </div>
                <div class="tv-playlist-grid">${tiles}</div>
            </div>
        `;
    }

    async togglePlaylist(tvId) {
        if (this.expandedPlaylists.has(tvId)) {
            this.expandedPlaylists.delete(tvId);
            this.updateTvList();
            return;
        }

        this.expandedPlaylists.add(tvId);
        this.updateTvList();
        await this.loadPlaylist(tvId);
    }

    async loadPlaylist(tvId) {
        try {
            const response = await fetch(`/api/tvs/${tvId}/playlist`);
            if (!response.ok) throw new Error((await response.json()).error || response.statusText);
            this.playlists[tvId] = await response.json();
        } catch (error) {
            console.error('Error loading playlist:', error);
            this.showToast(`Couldn't load images: ${error.message}`, 'error');
            this.playlists[tvId] = this.playlists[tvId] || [];
        }
        this.updateTvList();
    }

    togglePlaylistSelection(tvId, imageId) {
        const selected = this.playlistSelection[tvId] || (this.playlistSelection[tvId] = new Set());
        if (selected.has(imageId)) {
            selected.delete(imageId);
        } else {
            selected.add(imageId);
        }
        this.updateTvList();
    }

    async savePlaylistEnabled(tvId, enabledIds, successMessage) {
        try {
            const response = await fetch(`/api/tvs/${tvId}/playlist`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled_ids: enabledIds })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || response.statusText);

            this.showToast(successMessage, 'success');
            delete this.playlistSelection[tvId];
            await this.loadPlaylist(tvId);
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    setPlaylistImageEnabled(tvId, imageId, enabled) {
        const enabledIds = (this.playlists[tvId] || [])
            .filter(img => (img._id === imageId ? enabled : img.enabled))
            .map(img => img._id);
        return this.savePlaylistEnabled(tvId, enabledIds, enabled ? 'Image back in rotation' : 'Image taken out of rotation');
    }

    cycleOnlySelected(tvId) {
        const selected = [...(this.playlistSelection[tvId] || [])];
        return this.savePlaylistEnabled(tvId, selected, `Now cycling ${selected.length} selected image(s)`);
    }

    enableAllPlaylist(tvId) {
        const allIds = (this.playlists[tvId] || []).map(img => img._id);
        return this.savePlaylistEnabled(tvId, allIds, 'All images back in rotation');
    }

    async showPlaylistImage(tvId, imageId, hold) {
        try {
            const response = await fetch(`/api/tvs/${tvId}/playlist/${imageId}/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hold })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || response.statusText);
            this.showToast(result.message, 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    updateImageGrid() {
        const grid = document.getElementById('image-grid');
        grid.innerHTML = '';

        const imagesToShow = this.getFilteredImages();

        if (imagesToShow.length === 0) {
            grid.innerHTML = `<div class="image-grid-empty">${this.images.length ? 'No images match the current filter' : 'No images uploaded yet'}</div>`;
            return;
        }

        imagesToShow.forEach(image => {
            const card = this.createImageCard(image);
            grid.appendChild(card);
        });
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
    }

    createImageCard(image) {
        const card = document.createElement('div');
        card.className = 'image-card';

        const tvNames = image.assigned_tvs.map(tvId => this.tvs.find(tv => tv._id === tvId)?.name || tvId);
        const assignedTvsText = tvNames.length > 0
            ? `Assigned to ${tvNames.join(', ')}`
            : 'Not assigned';
        const name = this.escapeHtml(image.original_name);
        const dimensions = image.metadata?.width ? ` • ${image.metadata.width}x${image.metadata.height}` : '';

        card.innerHTML = `
            <img src="/api/images/${image._id}/attachment?width=400" alt="${name}" class="image-preview" loading="lazy" decoding="async">
            <div class="image-info">
                <div class="image-name" title="${name}">${name}</div>
                <div class="image-meta">${this.formatFileSize(image.size)}${dimensions}</div>
                <div class="image-assignments">${this.escapeHtml(assignedTvsText)}</div>
                <div class="image-actions">
                    <button class="btn btn-sm btn-primary" onclick="app.assignImage('${image._id}')">
                        <i class="fas fa-tv"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteImage('${image._id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;

        // Swap in a placeholder if the image can't load (set here, not inline,
        // so the SVG's quotes can't break the <img> tag)
        const preview = card.querySelector('.image-preview');
        preview.addEventListener('error', () => {
            preview.src = IMAGE_PLACEHOLDER;
        }, { once: true });

        return card;
    }

    populateTvFilters() {
        const select = document.getElementById('filter-tv');
        select.innerHTML = '<option value="">All TVs</option>';
        
        this.tvs.forEach(tv => {
            const option = document.createElement('option');
            option.value = tv._id;
            option.textContent = tv.name;
            select.appendChild(option);
        });
    }

    switchSection(section) {
        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${section}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.classList.remove('active');
        });
        document.getElementById(`${section}-section`).classList.add('active');

        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            tvs: 'TV Management',
            images: 'Image Library',
            upload: 'Upload Images',
            layers: 'Layer Control',
            'alert-templates': 'Alert Templates',
            mqtt: 'MQTT Activity'
        };
        document.getElementById('page-title').textContent = titles[section];

        this.currentSection = section;

        // Initialize alert templates section on first visit
        if (section === 'alert-templates' && typeof atInitTemplates === 'function') {
            atInitTemplates();
        }
    }

    // TV Management
    showTvModal(tv = null) {
        const modal = document.getElementById('tv-modal');
        const title = document.getElementById('tv-modal-title');
        const form = document.getElementById('tv-form');
        
        if (tv) {
            title.textContent = 'Edit TV';
            document.getElementById('tv-name').value = tv.name;
            document.getElementById('tv-location').value = tv.location;
            document.getElementById('tv-ip').value = tv.ip_address;
            document.getElementById('tv-transition').value = tv.config?.transition_effect || 'fade';
            document.getElementById('tv-duration').value = tv.config?.display_duration || 5000;
            document.getElementById('tv-orientation').value = tv.config?.orientation || 'landscape';
            form.dataset.tvId = tv._id;
        } else {
            title.textContent = 'Add TV';
            form.reset();
            delete form.dataset.tvId;
        }
        
        modal.classList.add('show');
    }

    async handleTvFormSubmit(e) {
        e.preventDefault();
        
        const form = e.target;
        const isEdit = !!form.dataset.tvId;
        
        const orientation = document.getElementById('tv-orientation').value;
        const resolution = orientation === 'portrait' ? '1080x1920' : '1920x1080';
        
        const tvData = {
            name: document.getElementById('tv-name').value,
            location: document.getElementById('tv-location').value,
            ip_address: document.getElementById('tv-ip').value,
            config: {
                transition_effect: document.getElementById('tv-transition').value,
                display_duration: parseInt(document.getElementById('tv-duration').value),
                orientation: orientation,
                resolution: resolution
            }
        };

        try {
            const url = isEdit ? `/api/tvs/${form.dataset.tvId}` : '/api/tvs';
            const method = isEdit ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tvData)
            });

            if (response.ok) {
                this.showToast(isEdit ? 'TV updated successfully' : 'TV created successfully', 'success');
                this.closeModal();
                await this.loadTvs();
                await this.loadDashboardData();
            } else {
                const error = await response.json();
                this.showToast(error.error || 'Failed to save TV', 'error');
            }
        } catch (error) {
            console.error('Error saving TV:', error);
            this.showToast('Failed to save TV', 'error');
        }
    }

    async editTv(tvId) {
        const tv = this.tvs.find(t => t._id === tvId);
        if (tv) {
            this.showTvModal(tv);
        }
    }

    async deleteTv(tvId) {
        if (!confirm('Are you sure you want to delete this TV?')) {
            return;
        }

        try {
            const response = await fetch(`/api/tvs/${tvId}`, { method: 'DELETE' });
            
            if (response.ok) {
                this.showToast('TV deleted successfully', 'success');
                await this.loadTvs();
                await this.loadDashboardData();
            } else {
                const error = await response.json();
                this.showToast(error.error || 'Failed to delete TV', 'error');
            }
        } catch (error) {
            console.error('Error deleting TV:', error);
            this.showToast('Failed to delete TV', 'error');
        }
    }

    async controlTv(tvId, action) {
        const tv = this.tvs.find(t => t._id === tvId);

        // Primary: MQTT via backend
        try {
            const response = await fetch(`/api/tvs/${tvId}/control/${action}`, { method: 'POST' });
            if (response.ok) {
                this.showToast(`TV ${action} command sent`, 'success');
                return;
            }
        } catch (error) {
            console.warn('MQTT control failed:', error);
        }

        // Backup: Direct HTTP to TV endpoint
        if (tv?.ip_address && tv.ip_address !== 'Unknown') {
            try {
                const response = await fetch(`http://${tv.ip_address}:8080/api/control`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action })
                });
                if (response.ok) {
                    this.showToast(`TV ${action} command sent (direct)`, 'success');
                    return;
                }
            } catch (error) {
                console.warn('Direct HTTP control also failed:', error);
            }
        }

        this.showToast(`Failed to ${action} TV`, 'error');
    }

    async shuffleTvImages(tvId) {
        try {
            const response = await fetch(`/api/images/shuffle/${tvId}`, { method: 'POST' });
            
            if (response.ok) {
                this.showToast('Images shuffled successfully', 'success');
                await this.loadImages();
            } else {
                const error = await response.json();
                this.showToast(error.error || 'Failed to shuffle images', 'error');
            }
        } catch (error) {
            console.error('Error shuffling images:', error);
            this.showToast('Failed to shuffle images', 'error');
        }
    }

    // Image Management
    assignImage(imageId) {
        this.currentImageId = imageId;
        this.showAssignmentModal();
    }

    showAssignmentModal() {
        const modal = document.getElementById('assignment-modal');
        const list = document.getElementById('tv-assignment-list');
        
        list.innerHTML = '';
        
        this.tvs.forEach(tv => {
            const item = document.createElement('div');
            item.className = 'tv-assignment-item';
            
            const currentImage = this.images.find(img => img._id === this.currentImageId);
            const isAssigned = currentImage && currentImage.assigned_tvs.includes(tv._id);
            
            item.innerHTML = `
                <input type="checkbox" id="tv-${tv._id}" value="${tv._id}" ${isAssigned ? 'checked' : ''}>
                <label for="tv-${tv._id}">
                    <strong>${tv.name}</strong><br>
                    <small>${tv.location}</small>
                </label>
            `;
            
            list.appendChild(item);
        });
        
        modal.classList.add('show');
    }

    async confirmImageAssignment() {
        const checkboxes = document.querySelectorAll('#tv-assignment-list input[type="checkbox"]:checked');
        const tvIds = Array.from(checkboxes).map(cb => cb.value);
        
        if (tvIds.length === 0) {
            this.showToast('Please select at least one TV', 'warning');
            return;
        }

        try {
            const response = await fetch(`/api/images/${this.currentImageId}/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tv_ids: tvIds })
            });

            if (response.ok) {
                this.showToast('Image assigned successfully', 'success');
                this.closeModal();
                await this.loadImages();
                await this.loadDashboardData();
            } else {
                const error = await response.json();
                this.showToast(error.error || 'Failed to assign image', 'error');
            }
        } catch (error) {
            console.error('Error assigning image:', error);
            this.showToast('Failed to assign image', 'error');
        }
    }

    async deleteImage(imageId) {
        if (!confirm('Are you sure you want to delete this image?')) {
            return;
        }

        try {
            const response = await fetch(`/api/images/${imageId}`, { method: 'DELETE' });
            
            if (response.ok) {
                this.showToast('Image deleted successfully', 'success');
                await this.loadImages();
                await this.loadDashboardData();
            } else {
                const error = await response.json();
                this.showToast(error.error || 'Failed to delete image', 'error');
            }
        } catch (error) {
            console.error('Error deleting image:', error);
            this.showToast('Failed to delete image', 'error');
        }
    }

    searchImages() {
        this.updateImageGrid();
    }

    filterImagesByTv() {
        this.updateImageGrid();
    }

    // Images matching both the search box and the TV filter
    getFilteredImages() {
        const query = (document.getElementById('search-images')?.value || '').trim().toLowerCase();
        const tvId = document.getElementById('filter-tv')?.value || '';

        return this.images.filter(image =>
            (!tvId || image.assigned_tvs.includes(tvId)) &&
            (!query ||
                image.original_name.toLowerCase().includes(query) ||
                (image.metadata?.description || '').toLowerCase().includes(query))
        );
    }

    // Upload functionality
    setupUploadArea() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const browseBtn = document.getElementById('browse-btn');

        browseBtn.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            this.handleFileSelection(e.target.files);
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            this.handleFileSelection(e.dataTransfer.files);
        });
    }

    async handleFileSelection(files) {
        if (files.length === 0) return;

        const formData = new FormData();
        Array.from(files).forEach(file => {
            formData.append('images', file);
        });

        this.showUploadQueue(files);

        try {
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                this.showToast(result.message, 'success');
                await this.loadImages();
                await this.loadDashboardData();
                this.hideUploadQueue();
            } else {
                const error = await response.json();
                this.showToast(error.error || 'Failed to upload images', 'error');
            }
        } catch (error) {
            console.error('Error uploading images:', error);
            this.showToast('Failed to upload images', 'error');
        }
    }

    showUploadQueue(files) {
        const queue = document.getElementById('upload-queue');
        const items = document.getElementById('queue-items');
        
        items.innerHTML = '';
        
        Array.from(files).forEach(file => {
            const item = document.createElement('div');
            item.className = 'queue-item';
            
            item.innerHTML = `
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${this.formatFileSize(file.size)}</div>
                </div>
                <div class="upload-progress">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
            `;
            
            items.appendChild(item);
        });
        
        queue.style.display = 'block';
    }

    hideUploadQueue() {
        document.getElementById('upload-queue').style.display = 'none';
    }

    // Utility functions
    closeModal() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('show');
        });
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.display = show ? 'flex' : 'none';
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatMetricValue(value, unit, defaultText) {
        if (value === null || value === undefined) return defaultText;
        return `${Math.round(value * 10) / 10}${unit}`;
    }

    formatOrientation(orientation) {
        const orientationMap = {
            'landscape': 'Landscape',
            'portrait': 'Portrait (90°)',
            'inverted_landscape': 'Inverted Landscape (180°)',
            'inverted_portrait': 'Inverted Portrait (270°)'
        };
        return orientationMap[orientation] || orientation;
    }

    formatUptime(seconds) {
        if (seconds === null || seconds === undefined) return '--';

        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    formatBytes(bytes) {
        if (bytes === null || bytes === undefined) return '--';
        const gb = bytes / (1024 * 1024 * 1024);
        return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    }

    formatTimeSince(timestamp) {
        if (!timestamp) return 'Never';
        const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ${minutes % 60}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }

    // Connection status plus the Pi's slideshow state, e.g. "online · playing"
    formatTvStatus(tv) {
        return tv.status === 'online' && tv.slideshow_state
            ? `${tv.status} · ${tv.slideshow_state}`
            : tv.status;
    }

    startLastSeenTimer() {
        // Matches the server's TV_HEARTBEAT_TIMEOUT default (Pi heartbeats every 30s)
        const heartbeatTimeoutMs = 120000;

        setInterval(() => {
            let wentOffline = false;

            this.tvs.forEach(tv => {
                const el = document.getElementById(`last-seen-${tv._id}`);
                if (el) {
                    el.textContent = this.formatTimeSince(tv.last_heartbeat);
                }

                const age = Date.now() - Date.parse(tv.last_heartbeat);
                if (tv.status === 'online' && !(age < heartbeatTimeoutMs)) {
                    tv.status = 'offline';
                    wentOffline = true;
                }
            });

            if (wentOffline) {
                this.updateTvOverview(this.tvs);
                this.updateTvList();
                this.updateDashboardStatsFromTvs();
            }
        }, 1000);
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Copied to clipboard', 'success');
        }).catch(() => {
            this.showToast('Failed to copy', 'error');
        });
    }

    toggleLivePreview(tvId, ipAddress) {
        const staticImg = document.querySelector(`#live-stream-${tvId}`)?.parentElement?.querySelector('.tv-thumbnail');
        const staticPlaceholder = document.querySelector(`#live-stream-${tvId}`)?.parentElement?.querySelector('.tv-thumbnail-placeholder');
        const liveStream = document.getElementById(`live-stream-${tvId}`);
        const indicator = document.getElementById(`live-indicator-${tvId}`);
        const btn = document.getElementById(`preview-toggle-${tvId}`);

        if (!liveStream) return;

        if (liveStream.classList.contains('hidden')) {
            staticImg?.classList.add('hidden');
            staticPlaceholder?.classList.add('hidden');
            liveStream.classList.remove('hidden');
            indicator?.classList.remove('hidden');
            btn?.classList.add('active');
            liveStream.src = `http://${ipAddress}:8080/api/stream`;
            this.showToast('Live preview enabled', 'success');
        } else {
            liveStream.classList.add('hidden');
            staticImg?.classList.remove('hidden');
            staticPlaceholder?.classList.remove('hidden');
            indicator?.classList.add('hidden');
            btn?.classList.remove('active');
            liveStream.src = '';
            this.showToast('Live preview disabled', 'info');
        }
    }

    updateTvStatus(topic, payload) {
        const tvId = this.extractTvIdFromTopic(topic);
        const tv = this.tvs.find(t => t._id.replace('tv_', '') === tvId);

        // Debug: log matching attempt
        console.log('updateTvStatus:', {
            tvId,
            foundTv: tv ? tv._id : 'NOT FOUND',
            tvIds: this.tvs.map(t => t._id)
        });

        if (!tv) {
            console.warn(`TV ${tvId} not found in this.tvs, skipping update`);
            return;
        }

        // Heartbeat contains everything we need - consolidate on this
        if (topic.includes('/heartbeat')) {
            tv.status = 'online';
            tv.last_heartbeat = new Date().toISOString();

            if (payload.system_metrics) {
                tv.system_metrics = payload.system_metrics;
            }

            this.updateTvOverview(this.tvs);
            this.updateTvList();
            this.updateDashboardStatsFromTvs();
        }
        // Status messages update slideshow state only, not connection status
        else if (topic.includes('/status')) {
            tv.slideshow_state = payload.status;
            tv.status = 'online';
            tv.last_heartbeat = new Date().toISOString();

            this.updateTvOverview(this.tvs);
            this.updateTvList();
            this.updateDashboardStatsFromTvs();
        }
    }

    updateSystemMetrics(tvId, metrics) {
        // Format temperature with color coding
        const tempElement = document.getElementById(`temp-${tvId}`);
        const tempDetailElement = document.getElementById(`temp-detail-${tvId}`);
        
        if (metrics.temperature !== null && metrics.temperature !== undefined) {
            const temp = Math.round(metrics.temperature * 10) / 10;
            const tempText = `${temp}°C`;
            const tempClass = temp > 70 ? 'temp-high' : temp > 60 ? 'temp-medium' : 'temp-normal';
            
            if (tempElement) {
                tempElement.textContent = tempText;
                tempElement.className = `metric-value ${tempClass}`;
            }
            if (tempDetailElement) {
                tempDetailElement.textContent = tempText;
                tempDetailElement.className = `detail-value ${tempClass}`;
            }
        }

        // Update CPU usage with color coding
        const cpuElement = document.getElementById(`cpu-${tvId}`);
        const cpuDetailElement = document.getElementById(`cpu-detail-${tvId}`);
        
        if (metrics.cpu_usage !== null && metrics.cpu_usage !== undefined) {
            const cpu = Math.round(metrics.cpu_usage * 10) / 10;
            const cpuText = `${cpu}%`;
            const cpuClass = cpu > 80 ? 'cpu-high' : cpu > 50 ? 'cpu-medium' : 'cpu-normal';
            
            if (cpuElement) {
                cpuElement.textContent = cpuText;
                cpuElement.className = `metric-value ${cpuClass}`;
            }
            if (cpuDetailElement) {
                cpuDetailElement.textContent = cpuText;
                cpuDetailElement.className = `detail-value ${cpuClass}`;
            }
        }

        // Update memory usage with color coding
        const memoryElement = document.getElementById(`memory-${tvId}`);
        const memoryDetailElement = document.getElementById(`memory-detail-${tvId}`);
        
        if (metrics.memory_usage !== null && metrics.memory_usage !== undefined) {
            const memory = Math.round(metrics.memory_usage * 10) / 10;
            const memoryText = `${memory}%`;
            const memoryClass = memory > 85 ? 'memory-high' : memory > 70 ? 'memory-medium' : 'memory-normal';
            
            if (memoryElement) {
                memoryElement.textContent = memoryText;
                memoryElement.className = `metric-value ${memoryClass}`;
            }
            if (memoryDetailElement) {
                memoryDetailElement.textContent = memoryText;
                memoryDetailElement.className = `detail-value ${memoryClass}`;
            }
        }

        // Update disk usage (detailed view only)
        const diskDetailElement = document.getElementById(`disk-detail-${tvId}`);
        
        if (metrics.disk_usage !== null && metrics.disk_usage !== undefined && diskDetailElement) {
            const disk = Math.round(metrics.disk_usage * 10) / 10;
            const diskText = `${disk}%`;
            const diskClass = disk > 90 ? 'disk-high' : disk > 75 ? 'disk-medium' : 'disk-normal';
            
            diskDetailElement.textContent = diskText;
            diskDetailElement.className = `detail-value ${diskClass}`;
        }
    }

    updateTvCurrentImage(topic, payload) {
        // Update TV current image in real-time when Pi changes images
        const tvId = this.extractTvIdFromTopic(topic);
        // Find TV by matching the _id field (without prefix) against the extracted MQTT topic ID
        const tv = this.tvs.find(t => t._id.replace('tv_', '') === tvId);
        
        if (tv) {
            // Update both field names for compatibility
            tv.current_image_id = payload.image_id;
            tv.current_image = payload.image_id;
            
            // Update current image display in TV card
            const currentImageElement = document.getElementById(`tv-current-${tv._id}`);
            if (currentImageElement) {
                const currentImage = payload.image_id ? this.images.find(img => img._id === payload.image_id) : null;
                currentImageElement.innerHTML = `
                    <span class="detail-label">Currently Showing</span>
                    <span class="detail-value" title="${currentImage ? this.escapeHtml(currentImage.original_name) : ''}">${currentImage ? this.escapeHtml(currentImage.original_name) : 'None'}</span>
                `;
            }
            
            // Update thumbnail using same logic as dashboard
            const thumbnailContainer = document.querySelector(`#tv-version-pill-${tv._id}`)?.closest('.tv-card-layout')?.querySelector('.tv-thumbnail-container');
            if (thumbnailContainer) {
                const currentImage = payload.image_id ? this.images.find(img => img._id === payload.image_id) : null;
                thumbnailContainer.innerHTML = currentImage ? 
                    `<img src="/api/images/${currentImage._id}/attachment?width=160" alt="${this.escapeHtml(currentImage.original_name)}" class="tv-thumbnail">` :
                    `<div class="tv-thumbnail-placeholder"><i class="fas fa-image"></i><span>No Image</span></div>`;
            }
            
            // Also refresh dashboard overview
            this.updateTvOverview(this.tvs);

            // Move the "Now showing" badge in an open Images section
            if (this.expandedPlaylists.has(tv._id)) {
                this.updateTvList();
            }
        }
    }

    extractTvIdFromTopic(topic) {
        const parts = topic.split('/');
        return parts[2]; // signage/tv/{id}/status
    }

    getTvNameById(tvId) {
        // Try matching with and without tv_ prefix
        const tv = this.tvs.find(t =>
            t._id === tvId ||
            t._id === `tv_${tvId}` ||
            t._id.replace('tv_', '') === tvId
        );
        return tv ? tv.name : null;
    }

    populateMqttTvFilter() {
        const select = document.getElementById('mqtt-tv-filter');
        if (!select) return;

        // Keep the "All TVs" option, clear the rest
        select.innerHTML = '<option value="all">All TVs</option>';

        this.tvs.forEach(tv => {
            const option = document.createElement('option');
            option.value = tv._id.replace('tv_', '');
            option.textContent = tv.name;
            select.appendChild(option);
        });
    }

    // Theme Management
    initTheme() {
        this.applyTheme();
        this.updateThemeIcon();
    }

    toggleTheme() {
        this.darkTheme = !this.darkTheme;
        localStorage.setItem('darkTheme', this.darkTheme);
        this.applyTheme();
        this.updateThemeIcon();
    }

    applyTheme() {
        if (this.darkTheme) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }

    updateThemeIcon() {
        const themeToggle = document.getElementById('theme-toggle');
        const icon = themeToggle.querySelector('i');
        
        if (this.darkTheme) {
            icon.className = 'fas fa-sun';
            themeToggle.title = 'Switch to light theme';
        } else {
            icon.className = 'fas fa-moon';
            themeToggle.title = 'Switch to dark theme';
        }
    }

    // MQTT Activity Functions
    addMqttMessage(topic, payload) {
        if (this.mqttPaused) return;

        const message = {
            timestamp: new Date(),
            topic: topic,
            payload: payload
        };

        // Determine if this is a digital signage message
        const isSignage = topic.startsWith('signage/');
        const messageType = isSignage ? 'signage' : 'general';

        // Add message to appropriate array
        this.mqttMessages[messageType].unshift(message);

        // Keep only the latest messages
        if (this.mqttMessages[messageType].length > this.maxMqttMessages) {
            this.mqttMessages[messageType] = this.mqttMessages[messageType].slice(0, this.maxMqttMessages);
        }

        // Update the display if we're on the MQTT section
        if (this.currentSection === 'mqtt') {
            this.updateMqttDisplay();
        }
    }

    updateMqttDisplay() {
        this.updateMqttPanel('general');
        this.updateMqttPanel('signage');
    }

    updateMqttPanel(type) {
        const container = document.getElementById(`${type}-mqtt-messages`);
        const countElement = document.getElementById(`${type}-count`);
        let messages = this.mqttMessages[type];
        const totalCount = this.mqttMessages[type].length;

        // Filter signage messages by TV if filter is set
        if (type === 'signage' && this.mqttTvFilter !== 'all') {
            messages = messages.filter(msg => {
                const tvId = this.extractTvIdFromTopic(msg.topic);
                return tvId === this.mqttTvFilter;
            });
        }

        // Filter general messages by topic prefix if filter is set
        if (type === 'general' && this.mqttTopicFilter) {
            messages = messages.filter(msg =>
                msg.topic === this.mqttTopicFilter ||
                msg.topic.startsWith(this.mqttTopicFilter + '/')
            );
        }

        // Update message count
        const filteredCount = messages.length;
        const isFiltered = (type === 'signage' && this.mqttTvFilter !== 'all') ||
                          (type === 'general' && this.mqttTopicFilter);
        if (isFiltered) {
            countElement.textContent = `${filteredCount} of ${totalCount} messages`;
        } else {
            countElement.textContent = `${messages.length} message${messages.length !== 1 ? 's' : ''}`;
        }

        // Clear existing messages
        container.innerHTML = '';

        if (messages.length === 0) {
            const noMessages = document.createElement('div');
            noMessages.className = 'no-messages';
            if (type === 'signage' && this.mqttTvFilter !== 'all') {
                const tvName = this.getTvNameById(this.mqttTvFilter) || this.mqttTvFilter;
                noMessages.textContent = `No messages from ${tvName}`;
            } else if (type === 'general' && this.mqttTopicFilter) {
                noMessages.textContent = `No messages matching ${this.mqttTopicFilter}`;
            } else {
                noMessages.textContent = type === 'signage'
                    ? 'No digital signage MQTT activity detected'
                    : 'No MQTT activity detected';
            }
            container.appendChild(noMessages);
            return;
        }

        // Add messages
        messages.forEach(message => {
            const messageElement = this.createMqttMessageElement(message, type);
            container.appendChild(messageElement);
        });
    }

    createMqttMessageElement(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `mqtt-message ${type}`;

        const timestamp = document.createElement('div');
        timestamp.className = 'mqtt-timestamp';
        timestamp.textContent = message.timestamp.toLocaleTimeString();

        // Create topic header with TV pill for signage messages
        const topicHeader = document.createElement('div');
        topicHeader.className = 'mqtt-topic-header';

        // Add TV name pill for signage topics
        if (type === 'signage') {
            const tvId = this.extractTvIdFromTopic(message.topic);
            const tvName = this.getTvNameById(tvId);
            if (tvName) {
                const tvPill = document.createElement('span');
                tvPill.className = 'mqtt-tv-pill';
                tvPill.textContent = tvName;
                topicHeader.appendChild(tvPill);
            }
        }

        const topic = document.createElement('span');
        topic.className = 'mqtt-topic';
        // Show simplified topic for signage messages
        if (type === 'signage') {
            const parts = message.topic.split('/');
            // Transform signage/tv/{uuid}/status to tv/.../status
            if (parts.length >= 4) {
                const shortId = parts[2].substring(0, 8);
                topic.textContent = `tv/${shortId}.../${parts.slice(3).join('/')}`;
                topic.title = message.topic; // Full topic in tooltip
            } else {
                topic.textContent = message.topic;
            }
        } else {
            topic.textContent = message.topic;
        }
        topicHeader.appendChild(topic);

        const payload = document.createElement('div');
        payload.className = 'mqtt-payload';

        try {
            // Try to format JSON payload nicely
            if (typeof message.payload === 'object') {
                payload.textContent = JSON.stringify(message.payload, null, 2);
            } else if (typeof message.payload === 'string') {
                try {
                    const parsed = JSON.parse(message.payload);
                    payload.textContent = JSON.stringify(parsed, null, 2);
                } catch {
                    payload.textContent = message.payload;
                }
            } else {
                payload.textContent = String(message.payload);
            }
        } catch (error) {
            payload.textContent = String(message.payload);
        }

        messageDiv.appendChild(timestamp);
        messageDiv.appendChild(topicHeader);
        messageDiv.appendChild(payload);

        return messageDiv;
    }

    clearMqttLogs() {
        this.mqttMessages.general = [];
        this.mqttMessages.signage = [];
        this.updateMqttDisplay();
    }

    toggleMqttPause() {
        this.mqttPaused = !this.mqttPaused;
        const button = document.getElementById('toggle-mqtt-pause');
        const icon = button.querySelector('i');

        if (this.mqttPaused) {
            icon.className = 'fas fa-play';
            button.innerHTML = '<i class="fas fa-play"></i> Resume';
        } else {
            icon.className = 'fas fa-pause';
            button.innerHTML = '<i class="fas fa-pause"></i> Pause';
        }
    }

    // Topic Tree Functions
    buildTopicTree() {
        const tree = {};
        this.mqttMessages.general.forEach(msg => {
            const parts = msg.topic.split('/');
            let current = tree;
            parts.forEach(part => {
                if (!current[part]) {
                    current[part] = { count: 0, children: {} };
                }
                current[part].count++;
                current = current[part].children;
            });
        });
        return tree;
    }

    renderTopicTree(tree, parentPath = '', depth = 0) {
        const entries = Object.entries(tree);
        if (entries.length === 0) return '';

        let html = '<ul class="topic-tree-list">';

        entries.sort((a, b) => b[1].count - a[1].count);

        for (const [name, node] of entries) {
            const fullPath = parentPath ? `${parentPath}/${name}` : name;
            const hasChildren = Object.keys(node.children).length > 0;
            const isExpanded = this.mqttExpandedBranches.has(fullPath);
            const isSelected = this.mqttTopicFilter === fullPath;

            html += `<li class="topic-node ${isSelected ? 'selected' : ''}">`;
            html += '<div class="topic-node-content">';

            if (hasChildren) {
                html += `<span class="topic-expand" onclick="app.toggleBranch('${fullPath}')">${isExpanded ? '▼' : '▶'}</span>`;
            } else {
                html += '<span class="topic-expand-placeholder"></span>';
            }

            html += `<span class="topic-name" onclick="app.filterByTopic('${fullPath}')">${name}</span>`;
            html += `<span class="topic-count">${node.count}</span>`;
            html += '</div>';

            if (hasChildren && isExpanded) {
                html += this.renderTopicTree(node.children, fullPath, depth + 1);
            }

            html += '</li>';
        }

        html += '</ul>';
        return html;
    }

    toggleTopicTree() {
        this.mqttTopicTreeVisible = !this.mqttTopicTreeVisible;
        const treeContainer = document.getElementById('mqtt-topic-tree');
        const toggleBtn = document.getElementById('toggle-topic-tree');

        if (this.mqttTopicTreeVisible) {
            treeContainer.classList.remove('hidden');
            toggleBtn.classList.add('active');
            this.updateTopicTreeDisplay();
        } else {
            treeContainer.classList.add('hidden');
            toggleBtn.classList.remove('active');
        }
    }

    toggleBranch(path) {
        if (this.mqttExpandedBranches.has(path)) {
            this.mqttExpandedBranches.delete(path);
        } else {
            this.mqttExpandedBranches.add(path);
        }
        this.updateTopicTreeDisplay();
    }

    filterByTopic(prefix) {
        if (this.mqttTopicFilter === prefix) {
            this.mqttTopicFilter = null;
        } else {
            this.mqttTopicFilter = prefix;
        }
        this.updateTopicTreeDisplay();
        this.updateMqttDisplay();
    }

    clearTopicFilter() {
        this.mqttTopicFilter = null;
        this.updateTopicTreeDisplay();
        this.updateMqttDisplay();
    }

    updateTopicTreeDisplay() {
        const treeContainer = document.getElementById('mqtt-topic-tree');
        if (!this.mqttTopicTreeVisible) return;

        const tree = this.buildTopicTree();
        const totalCount = this.mqttMessages.general.length;

        let html = '<div class="topic-tree-header">';
        html += `<span class="topic-all ${!this.mqttTopicFilter ? 'selected' : ''}" onclick="app.clearTopicFilter()">● All Topics (${totalCount})</span>`;
        if (this.mqttTopicFilter) {
            html += `<button class="topic-clear-btn" onclick="app.clearTopicFilter()" title="Clear filter">✕</button>`;
        }
        html += '</div>';

        html += this.renderTopicTree(tree);
        treeContainer.innerHTML = html;

        this.updateFilterStatus();
    }

    updateFilterStatus() {
        const statusEl = document.getElementById('mqtt-filter-status');
        if (!statusEl) return;

        if (this.mqttTopicFilter) {
            const filteredCount = this.mqttMessages.general.filter(
                msg => msg.topic.startsWith(this.mqttTopicFilter)
            ).length;
            statusEl.textContent = `📍 ${this.mqttTopicFilter} (${filteredCount} messages)`;
            statusEl.classList.add('active');
        } else {
            statusEl.textContent = '';
            statusEl.classList.remove('active');
        }
    }

    // Version Management
    async loadVersionInfo() {
        let fallbackToDefault = false;
        
        try {
            // Get server version information for the modal and header
            const response = await fetch('/api/version');
            if (response.ok) {
                this.serverVersion = await response.json();
                // Use the management UI version from server response
                this.updateVersionDisplay(this.serverVersion.management_ui_version || 'unknown');
            } else {
                fallbackToDefault = true;
            }
        } catch (error) {
            console.error('Error loading server version info:', error);
            fallbackToDefault = true;
        }
        
        if (fallbackToDefault) {
            this.serverVersion = { 
                commit_hash: 'unknown', 
                branch: 'unknown', 
                build_time: 'unknown',
                management_ui_version: 'unknown',
                version: 'unknown',
                is_dirty: false
            };
            this.updateVersionDisplay('0.3.0');
        }
    }

    updateVersionDisplay(version) {
        const versionDisplay = document.getElementById('version-display');
        if (versionDisplay) {
            versionDisplay.textContent = `v${version}`;
            versionDisplay.className = 'version-short';
        }
    }

    showVersionModal() {
        const modalHtml = `
            <div id="version-modal" class="modal show">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Version Information</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="version-section">
                            <h4>Management UI</h4>
                            <div class="version-details">
                                <div class="version-item">
                                    <strong>Version:</strong> ${this.serverVersion?.management_ui_version || 'unknown'}
                                </div>
                                <div class="version-item">
                                    <strong>Package:</strong> digital-signage-management
                                </div>
                            </div>
                        </div>
                        <div class="version-section">
                            <h4>Management Server</h4>
                            <div class="version-details">
                                <div class="version-item">
                                    <strong>Version:</strong> ${this.serverVersion?.version || 'unknown'}
                                </div>
                                <div class="version-item">
                                    <strong>Commit:</strong> ${this.serverVersion?.commit_hash || 'unknown'}
                                </div>
                                <div class="version-item">
                                    <strong>Branch:</strong> ${this.serverVersion?.branch || 'unknown'}
                                </div>
                                <div class="version-item">
                                    <strong>Build Time:</strong> ${this.serverVersion?.build_time || 'unknown'}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary modal-cancel">Close</button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing version modal if any
        const existingModal = document.getElementById('version-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Setup close handlers
        const modal = document.getElementById('version-modal');
        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.remove();
        });
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
        });

        // Load TV versions
        this.loadTvVersions();
    }

    async loadTvVersions() {
        const tvVersionsList = document.getElementById('tv-versions-list');
        if (!tvVersionsList) return;

        try {
            const versions = await Promise.all(
                this.tvs.map(async (tv) => {
                    try {
                        const response = await fetch(`http://${tv.ip_address}:8080/api/version`, {
                            method: 'GET',
                            timeout: 5000
                        });
                        if (response.ok) {
                            const versionData = await response.json();
                            return {
                                tv: tv,
                                version: versionData.data,
                                status: 'success'
                            };
                        } else {
                            return {
                                tv: tv,
                                status: 'error',
                                error: 'Failed to fetch'
                            };
                        }
                    } catch (error) {
                        return {
                            tv: tv,
                            status: 'error',
                            error: error.message
                        };
                    }
                })
            );

            // Update the display
            tvVersionsList.innerHTML = '';
            versions.forEach(result => {
                const tvVersionDiv = document.createElement('div');
                tvVersionDiv.className = 'tv-version-item';
                
                if (result.status === 'success') {
                    tvVersionDiv.innerHTML = `
                        <div class="tv-version-header">
                            <strong>${result.tv.name}</strong>
                            <span class="version-status success">Online</span>
                        </div>
                        <div class="tv-version-details">
                            <div class="version-item">
                                <strong>Version:</strong> ${result.version.version}
                            </div>
                            <div class="version-item">
                                <strong>Commit:</strong> ${result.version.commit_short} (${result.version.commit_hash.substring(0, 12)}...)
                            </div>
                            <div class="version-item">
                                <strong>Branch:</strong> ${result.version.branch}
                            </div>
                            <div class="version-item">
                                <strong>Build Time:</strong> ${result.version.build_time}
                            </div>
                        </div>
                    `;
                } else {
                    tvVersionDiv.innerHTML = `
                        <div class="tv-version-header">
                            <strong>${result.tv.name}</strong>
                            <span class="version-status error">Offline</span>
                        </div>
                        <div class="tv-version-details">
                            <div class="version-item error">
                                Unable to fetch version: ${result.error}
                            </div>
                        </div>
                    `;
                }
                
                tvVersionsList.appendChild(tvVersionDiv);
            });

        } catch (error) {
            tvVersionsList.innerHTML = `<div class="error">Error loading TV versions: ${error.message}</div>`;
        }
    }

    refreshTvVersions() {
        const tvVersionsList = document.getElementById('tv-versions-list');
        if (tvVersionsList) {
            tvVersionsList.innerHTML = '<div class="loading">Loading TV version information...</div>';
            this.loadTvVersions();
        }
    }

    // Load version info for individual TV in the TV Management section
    async loadTvVersionInfo(tv) {
        const versionElement = document.getElementById(`tv-version-pill-${tv._id}`);
        if (!versionElement) return;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`http://${tv.ip_address}:8080/api/version`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                }
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const versionData = await response.json();
                const version = versionData.data;
                versionElement.innerHTML = `<span class="pill-label">v</span><span class="pill-value">${version.version}</span>`;
                versionElement.title = `${version.version} (${version.commit_short})`;
                tv.versionInfo = version;
            } else {
                versionElement.innerHTML = `<span class="pill-label">v</span><span class="pill-value version-error">--</span>`;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                versionElement.innerHTML = `<span class="pill-label">v</span><span class="pill-value version-error">--</span>`;
            } else {
                versionElement.innerHTML = `<span class="pill-label">v</span><span class="pill-value version-error">--</span>`;
            }
            console.log(`Version fetch failed for TV ${tv.name} (${tv.ip_address}):`, error.message);
        }
    }

    // Show detailed version information for a specific TV
    showTvVersionDetails(tvId) {
        const tv = this.tvs.find(t => t._id === tvId);
        if (!tv) return;

        const modalHtml = `
            <div id="tv-version-detail-modal" class="modal show">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${tv.name} - Version Details</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="version-section">
                            <h4>Raspberry Pi Endpoint</h4>
                            <div class="version-details">
                                ${tv.versionInfo ? `
                                    <div class="version-item">
                                        <strong>Version:</strong> ${tv.versionInfo.version}
                                    </div>
                                    <div class="version-item">
                                        <strong>Commit:</strong> ${tv.versionInfo.commit_hash}
                                    </div>
                                    <div class="version-item">
                                        <strong>Short Hash:</strong> ${tv.versionInfo.commit_short}
                                    </div>
                                    <div class="version-item">
                                        <strong>Branch:</strong> ${tv.versionInfo.branch}
                                    </div>
                                    <div class="version-item">
                                        <strong>Build Time:</strong> ${tv.versionInfo.build_time}
                                    </div>
                                    <div class="version-item">
                                        <strong>IP Address:</strong> ${tv.ip_address}
                                    </div>
                                ` : `
                                    <div class="version-item error">
                                        Version information unavailable. TV may be offline.
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary modal-cancel">Close</button>
                        <button type="button" class="btn btn-primary" onclick="app.refreshTvVersionInfo('${tvId}')">Refresh</button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('tv-version-detail-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Setup close handlers
        const modal = document.getElementById('tv-version-detail-modal');
        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.remove();
        });
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.remove();
        });
    }

    // Refresh version info for a specific TV
    async refreshTvVersionInfo(tvId) {
        const tv = this.tvs.find(t => t._id === tvId);
        if (!tv) return;

        // Update the version display in the list
        await this.loadTvVersionInfo(tv);
        
        // Close and reopen the modal with updated info
        const modal = document.getElementById('tv-version-detail-modal');
        if (modal) {
            modal.remove();
            this.showTvVersionDetails(tvId);
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DigitalSignageApp();
});