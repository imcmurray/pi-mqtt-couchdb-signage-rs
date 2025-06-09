// Digital Signage Management App
class DigitalSignageApp {
    constructor() {
        this.ws = null;
        this.currentSection = 'dashboard';
        this.tvs = [];
        this.images = [];
        this.currentImageId = null;
        this.darkTheme = localStorage.getItem('darkTheme') === 'true';
        this.mqttMessages = {
            general: [],
            signage: []
        };
        this.mqttPaused = false;
        this.maxMqttMessages = 100;
        
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

    async loadTvs() {
        try {
            const response = await fetch('/api/tvs');
            this.tvs = await response.json();
            this.updateTvList();
            this.populateTvFilters();
        } catch (error) {
            console.error('Error loading TVs:', error);
        }
    }

    async loadImages() {
        try {
            const response = await fetch('/api/images');
            this.images = await response.json();
            this.updateImageGrid();
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
            `<img src="/api/images/${currentImage._id}/attachment" alt="${currentImage.original_name}" class="tv-current-thumbnail">` :
            `<div class="tv-no-image"><i class="fas fa-image"></i></div>`;
        
        card.innerHTML = `
            <div class="tv-card-header">
                <div class="tv-card-title">${tv.name}</div>
                <div class="tv-card-location">${tv.location}</div>
            </div>
            <div class="tv-card-body">
                <div class="tv-status">
                    <span class="status-dot ${statusClass}"></span>
                    <span>${tv.status}</span>
                </div>
                <div class="tv-current-section">
                    <div class="tv-current-thumbnail-container">
                        ${thumbnailHtml}
                    </div>
                    <div class="tv-current-info">
                        <div class="tv-current-label">Currently Playing:</div>
                        <div class="tv-current-name">${currentImage ? currentImage.original_name : 'None'}</div>
                    </div>
                </div>
                <div class="tv-system-metrics" id="system-metrics-${tv._id}">
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
        
        // Get current image for thumbnail - check both field names for compatibility
        const currentImageId = tv.current_image_id || tv.current_image;
        const currentImage = currentImageId ? this.images.find(img => img._id === currentImageId) : null;
        const thumbnailHtml = currentImage ? 
            `<img src="/api/images/${currentImage._id}/attachment" alt="${currentImage.original_name}" class="tv-thumbnail">` :
            `<div class="tv-thumbnail-placeholder"><i class="fas fa-image"></i><span>No Image</span></div>`;
        
        item.innerHTML = `
            <div class="tv-card-layout">
                <div class="tv-thumbnail-container">
                    ${thumbnailHtml}
                </div>
                <div class="tv-info">
                    <div class="tv-name">${tv.name}</div>
                    <div class="tv-details-grid">
                        <div class="tv-detail-item">
                            <span class="detail-label">Location:</span>
                            <span class="detail-value">${tv.location}</span>
                        </div>
                        <div class="tv-detail-item">
                            <span class="detail-label">IP Address:</span>
                            <span class="detail-value">${tv.ip_address}</span>
                        </div>
                        <div class="tv-detail-item">
                            <span class="detail-label">TV ID:</span>
                            <span class="detail-value">${tv._id.replace('tv_', '')}</span>
                        </div>
                        <div class="tv-detail-item">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">
                                <span class="status-dot ${statusClass}"></span>
                                ${tv.status}
                            </span>
                        </div>
                    </div>
                    <div class="tv-version-info" id="tv-version-${tv._id}">
                        <span class="detail-label">Version:</span>
                        <span class="version-loading">Loading...</span>
                    </div>
                    <div class="tv-current-image" id="tv-current-${tv._id}">
                        <span class="detail-label">Current Image:</span>
                        <span class="detail-value">${currentImage ? currentImage.original_name : 'None'}</span>
                    </div>
                    <div class="tv-system-info" id="system-info-${tv._id}">
                        <div class="system-info-grid">
                            <div class="system-info-item">
                                <span class="detail-label">Temperature:</span>
                                <span class="detail-value" id="temp-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.temperature, '°C', '--°C')}</span>
                            </div>
                            <div class="system-info-item">
                                <span class="detail-label">CPU Usage:</span>
                                <span class="detail-value" id="cpu-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.cpu_usage, '%', '--%')}</span>
                            </div>
                            <div class="system-info-item">
                                <span class="detail-label">Memory:</span>
                                <span class="detail-value" id="memory-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.memory_usage, '%', '--%')}</span>
                            </div>
                            <div class="system-info-item">
                                <span class="detail-label">Disk Usage:</span>
                                <span class="detail-value" id="disk-detail-${tv._id}">${this.formatMetricValue(tv.system_metrics?.disk_usage, '%', '--%')}</span>
                            </div>
                        </div>
                    </div>
                </div>
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

    updateImageGrid(filteredImages = null) {
        const grid = document.getElementById('image-grid');
        grid.innerHTML = '';

        const imagesToShow = filteredImages || this.images;

        imagesToShow.forEach(image => {
            const card = this.createImageCard(image);
            grid.appendChild(card);
        });
    }

    createImageCard(image) {
        const card = document.createElement('div');
        card.className = 'image-card';
        
        const assignedTvsText = image.assigned_tvs.length > 0 
            ? `Assigned to ${image.assigned_tvs.length} TV(s)`
            : 'Not assigned';
        
        card.innerHTML = `
            <img src="/api/images/${image._id}/attachment" alt="${image.original_name}" class="image-preview" 
                 onerror="this.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"150\" viewBox=\"0 0 200 150\"><rect width=\"200\" height=\"150\" fill=\"%23f8f9fa\"/><text x=\"100\" y=\"75\" text-anchor=\"middle\" fill=\"%23666\" font-family=\"Arial\" font-size=\"12\">No Preview</text></svg>'">
            <div class="image-info">
                <div class="image-name">${image.original_name}</div>
                <div class="image-meta">${this.formatFileSize(image.size)} • ${image.metadata.width}x${image.metadata.height}</div>
                <div class="image-assignments">${assignedTvsText}</div>
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
            mqtt: 'MQTT Activity'
        };
        document.getElementById('page-title').textContent = titles[section];

        this.currentSection = section;
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
        
        const tvData = {
            name: document.getElementById('tv-name').value,
            location: document.getElementById('tv-location').value,
            ip_address: document.getElementById('tv-ip').value,
            config: {
                transition_effect: document.getElementById('tv-transition').value,
                display_duration: parseInt(document.getElementById('tv-duration').value)
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
        try {
            const response = await fetch(`/api/tvs/${tvId}/control/${action}`, { method: 'POST' });
            
            if (response.ok) {
                this.showToast(`TV ${action} command sent`, 'success');
            } else {
                const error = await response.json();
                this.showToast(error.error || `Failed to ${action} TV`, 'error');
            }
        } catch (error) {
            console.error(`Error controlling TV (${action}):`, error);
            this.showToast(`Failed to ${action} TV`, 'error');
        }
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

    searchImages(query) {
        if (!query.trim()) {
            this.updateImageGrid();
            return;
        }

        const filtered = this.images.filter(image => 
            image.original_name.toLowerCase().includes(query.toLowerCase()) ||
            (image.metadata?.description?.toLowerCase().includes(query.toLowerCase()) || false)
        );
        
        this.updateImageGrid(filtered);
    }

    filterImagesByTv(tvId) {
        if (!tvId) {
            this.updateImageGrid();
            return;
        }

        const filtered = this.images.filter(image => image.assigned_tvs.includes(tvId));
        this.updateImageGrid(filtered);
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

    updateTvStatus(topic, payload) {
        // Update TV status in real-time based on MQTT messages
        const tvId = this.extractTvIdFromTopic(topic);
        // Find TV by matching the _id field (without prefix) against the extracted MQTT topic ID
        const tv = this.tvs.find(t => t._id.replace('tv_', '') === tvId);
        
        if (tv) {
            if (topic.includes('/status')) {
                tv.status = payload.status;
            } else if (topic.includes('/heartbeat')) {
                tv.status = 'online';
                tv.last_heartbeat = new Date().toISOString();
                
                // Store system metrics in TV object for persistence across DOM updates
                if (payload.system_metrics) {
                    tv.system_metrics = payload.system_metrics;
                }
            }
            
            // Refresh displays (this will use the stored system_metrics)
            this.updateTvOverview(this.tvs);
            this.updateTvList();
            this.loadDashboardData();
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
                    <span class="detail-label">Current Image:</span>
                    <span class="detail-value">${currentImage ? currentImage.original_name : 'None'}</span>
                `;
            }
            
            // Update thumbnail using same logic as dashboard
            const thumbnailContainer = document.querySelector(`#tv-version-${tv._id}`).closest('.tv-card-layout').querySelector('.tv-thumbnail-container');
            if (thumbnailContainer) {
                const currentImage = payload.image_id ? this.images.find(img => img._id === payload.image_id) : null;
                thumbnailContainer.innerHTML = currentImage ? 
                    `<img src="/api/images/${currentImage._id}/attachment" alt="${currentImage.original_name}" class="tv-thumbnail">` :
                    `<div class="tv-thumbnail-placeholder"><i class="fas fa-image"></i><span>No Image</span></div>`;
            }
            
            // Also refresh dashboard overview
            this.updateTvOverview(this.tvs);
        }
    }

    extractTvIdFromTopic(topic) {
        const parts = topic.split('/');
        return parts[2]; // signage/tv/{id}/status
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
        const messages = this.mqttMessages[type];

        // Update message count
        countElement.textContent = `${messages.length} message${messages.length !== 1 ? 's' : ''}`;

        // Clear existing messages
        container.innerHTML = '';

        if (messages.length === 0) {
            const noMessages = document.createElement('div');
            noMessages.className = 'no-messages';
            noMessages.textContent = type === 'signage' 
                ? 'No digital signage MQTT activity detected'
                : 'No MQTT activity detected';
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

        const topic = document.createElement('div');
        topic.className = 'mqtt-topic';
        topic.textContent = message.topic;

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
        messageDiv.appendChild(topic);
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

    // Version Management
    async loadVersionInfo() {
        try {
            // Get server version information for the modal
            const response = await fetch('/api/version');
            if (response.ok) {
                this.serverVersion = await response.json();
            } else {
                this.serverVersion = { commit_hash: 'unknown', branch: 'unknown', build_time: 'unknown' };
            }
        } catch (error) {
            console.error('Error loading server version info:', error);
            this.serverVersion = { commit_hash: 'unknown', branch: 'unknown', build_time: 'unknown' };
        }
        
        // Always show the management UI version from package.json
        this.updateVersionDisplay('0.1.0');
    }

    updateVersionDisplay(version) {
        const versionDisplay = document.getElementById('version-display');
        versionDisplay.textContent = `v${version}`;
        versionDisplay.className = 'version-short';
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
                                    <strong>Version:</strong> 1.0.0
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
        const versionElement = document.getElementById(`tv-version-${tv._id}`);
        if (!versionElement) return;

        try {
            // Use a proper timeout implementation with AbortController
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
                versionElement.innerHTML = `<span class="detail-label">Version:</span> <span class="detail-value">${version.version} (${version.commit_short})</span>`;
                
                // Store version data for detailed view
                tv.versionInfo = version;
            } else {
                versionElement.innerHTML = `<span class="detail-label">Version:</span> <span class="detail-value version-error">Offline</span>`;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                versionElement.innerHTML = `<span class="detail-label">Version:</span> <span class="detail-value version-error">Timeout</span>`;
            } else {
                versionElement.innerHTML = `<span class="detail-label">Version:</span> <span class="detail-value version-error">Unavailable</span>`;
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