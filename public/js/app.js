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
        
        // Get current image for thumbnail
        const currentImage = tv.current_image_id ? this.images.find(img => img._id === tv.current_image_id) : null;
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
    }

    createTvListItem(tv) {
        const item = document.createElement('div');
        item.className = 'tv-list-item';
        
        const statusClass = tv.status === 'online' ? 'online' : 'offline';
        
        item.innerHTML = `
            <div class="tv-info">
                <div class="tv-name">${tv.name}</div>
                <div class="tv-details">
                    <span class="status-dot ${statusClass}"></span>
                    <strong>TV ID:</strong> ${tv.tv_id} • <strong>Location:</strong> ${tv.location} • <strong>IP:</strong> ${tv.ip_address} • <strong>Status:</strong> ${tv.status}
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
            document.getElementById('tv-id').value = tv.tv_id || '';
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
            tv_id: document.getElementById('tv-id').value,
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

    updateTvStatus(topic, payload) {
        // Update TV status in real-time based on MQTT messages
        const tvId = this.extractTvIdFromTopic(topic);
        // Find TV by matching the tv_id field (without prefix) against the extracted MQTT topic ID
        const tv = this.tvs.find(t => t.tv_id === tvId);
        
        if (tv) {
            if (topic.includes('/status')) {
                tv.status = payload.status;
            } else if (topic.includes('/heartbeat')) {
                tv.status = 'online';
                tv.last_heartbeat = new Date().toISOString();
            }
            
            // Refresh displays
            this.updateTvOverview(this.tvs);
            this.updateTvList();
            this.loadDashboardData();
        }
    }

    updateTvCurrentImage(topic, payload) {
        // Update TV current image in real-time when Pi changes images
        const tvId = this.extractTvIdFromTopic(topic);
        // Find TV by matching the tv_id field (without prefix) against the extracted MQTT topic ID
        const tv = this.tvs.find(t => t.tv_id === tvId);
        
        if (tv) {
            tv.current_image_id = payload.image_id;
            
            // Refresh TV displays to show new thumbnail
            this.updateTvOverview(this.tvs);
            this.updateTvList();
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
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DigitalSignageApp();
});