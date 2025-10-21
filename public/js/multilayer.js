// Multi-Layer Digital Signage Management Interface

class MultiLayerManager {
    constructor() {
        this.selectedTvId = null;
        this.selectedLayerId = null;
        this.layers = [];
        this.ws = null;
        this.apiBase = '/api';

        // Alert management properties
        this.selectedAlertType = 'INFO';
        this.selectedTargetType = 'all';
        this.activeAlerts = [];

        this.init();
    }
    
    async init() {
        await this.loadTVs();
        await this.loadActiveAlerts();
        this.connectWebSocket();
        this.setupEventListeners();
        this.startStatusUpdates();
        this.log('Multi-Layer Manager initialized');
    }
    
    async loadTVs() {
        try {
            const response = await fetch(`${this.apiBase}/tvs`);
            const tvs = await response.json();
            
            const tvSelect = document.getElementById('tvSelect');
            tvSelect.innerHTML = '<option value="">Select a TV...</option>';
            
            tvs.forEach(tv => {
                const option = document.createElement('option');
                option.value = tv._id;
                option.textContent = `${tv.name} (${tv.location})`;
                tvSelect.appendChild(option);
            });
            
            // Auto-select first TV if available
            if (tvs.length > 0 && !this.selectedTvId) {
                this.selectedTvId = tvs[0]._id;
                tvSelect.value = this.selectedTvId;
                await this.loadLayers();
            }
            
            this.log(`Loaded ${tvs.length} TVs`);
        } catch (error) {
            this.log(`Error loading TVs: ${error.message}`, 'error');
        }
    }
    
    async loadLayers() {
        if (!this.selectedTvId) return;
        
        try {
            const response = await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers`);
            this.layers = await response.json();
            
            this.updateLayersList();
            this.updateScreenPreview();
            this.updateLayerCount();
            
            this.log(`Loaded ${this.layers.length} layers for TV ${this.selectedTvId}`);
        } catch (error) {
            this.log(`Error loading layers: ${error.message}`, 'error');
        }
    }
    
    updateLayersList() {
        const layersList = document.getElementById('layersList');
        
        if (this.layers.length === 0) {
            layersList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 24px;">No layers created yet</p>';
            return;
        }
        
        // Sort layers by priority
        const sortedLayers = [...this.layers].sort((a, b) => a.priority - b.priority);
        
        layersList.innerHTML = sortedLayers.map(layer => `
            <div class="layer-item ${layer.isAnimating ? 'animating' : ''}" 
                 onclick="selectLayer('${layer.layer_id}')"
                 style="border-color: ${this.selectedLayerId === layer.layer_id ? 'var(--primary)' : 'var(--border)'}">
                <div class="layer-name">${layer.name}</div>
                <div class="layer-text">${layer.content.text}</div>
                <div class="layer-meta">
                    <span>Y: ${layer.position.y}px</span>
                    <span>H: ${layer.position.height}px</span>
                    <span>P: ${layer.priority}</span>
                    <span>O: ${Math.round(layer.opacity * 100)}%</span>
                    <span style="color: ${layer.visible ? 'var(--success)' : 'var(--danger)'}">
                        ${layer.visible ? '👁️ Visible' : '🙈 Hidden'}
                    </span>
                </div>
                <div class="layer-controls">
                    <button class="btn btn-small btn-secondary" onclick="event.stopPropagation(); editLayer('${layer.layer_id}')">Edit</button>
                    <button class="btn btn-small ${layer.visible ? 'btn-warning' : 'btn-success'}" 
                            onclick="event.stopPropagation(); toggleLayerVisibility('${layer.layer_id}', ${!layer.visible})">
                        ${layer.visible ? 'Hide' : 'Show'}
                    </button>
                    <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); deleteLayer('${layer.layer_id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }
    
    updateScreenPreview() {
        const screenPreview = document.getElementById('screenPreview');
        
        // Clear existing previews
        screenPreview.innerHTML = '';
        
        // Sort layers by priority for proper z-index
        const sortedLayers = [...this.layers].sort((a, b) => a.priority - b.priority);
        
        sortedLayers.forEach(layer => {
            if (!layer.visible) return;
            
            const preview = document.createElement('div');
            preview.className = `layer-preview ${layer.isAnimating ? 'animating' : ''}`;
            preview.onclick = () => this.selectLayer(layer.layer_id);
            
            // Scale position to fit preview (600px wide for 1920px screen)
            const scale = 600 / 1920;
            const scaledX = layer.position.x * scale;
            const scaledY = layer.position.y * scale;
            const scaledWidth = layer.position.width * scale;
            const scaledHeight = layer.position.height * scale;
            
            preview.style.left = `${scaledX}px`;
            preview.style.top = `${scaledY}px`;
            preview.style.width = `${scaledWidth}px`;
            preview.style.height = `${scaledHeight}px`;
            preview.style.zIndex = layer.priority;
            preview.style.opacity = layer.opacity;
            
            // Parse background color
            const bgMatch = layer.content.backgroundColor.match(/rgba?\(([^)]+)\)/);
            if (bgMatch) {
                preview.style.background = layer.content.backgroundColor;
            }
            
            // Truncate text for preview
            const maxLength = scaledWidth > 100 ? 30 : 15;
            const displayText = layer.content.text.length > maxLength 
                ? layer.content.text.substring(0, maxLength) + '...'
                : layer.content.text;
            
            preview.textContent = displayText;
            preview.title = `${layer.name}: ${layer.content.text}`;
            
            screenPreview.appendChild(preview);
        });
    }
    
    updateLayerCount() {
        const count = this.layers.length;
        document.getElementById('layerCount').textContent = `${count} layers`;
        document.getElementById('layerCountText').textContent = count;
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.updateConnectionStatus(true);
            this.log('WebSocket connected');
            
            // Subscribe to layer updates for current TV
            if (this.selectedTvId) {
                this.ws.send(JSON.stringify({
                    type: 'subscribe_layers',
                    tv_id: this.selectedTvId
                }));
            }
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = () => {
            this.updateConnectionStatus(false);
            this.log('WebSocket disconnected, attempting to reconnect...', 'warning');
            
            // Attempt to reconnect after 3 seconds
            setTimeout(() => {
                this.connectWebSocket();
            }, 3000);
        };
        
        this.ws.onerror = (error) => {
            this.log(`WebSocket error: ${error}`, 'error');
        };
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'mqtt_message':
                this.handleMqttMessage(data.topic, data.payload);
                break;
            case 'subscription_confirmed':
                this.log(`Subscribed to TV ${data.tv_id} layer updates`);
                break;
        }
    }
    
    handleMqttMessage(topic, payload) {
        // Refresh layers when changes are received
        if (topic.includes('layer') && topic.includes(this.selectedTvId)) {
            this.loadLayers();
            this.log(`Layer update received: ${payload.action || 'unknown'}`);
        }
    }
    
    updateConnectionStatus(connected) {
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');
        
        if (connected) {
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected';
        } else {
            statusDot.classList.remove('connected');
            statusText.textContent = 'Disconnected';
        }
    }
    
    setupEventListeners() {
        document.getElementById('tvSelect').addEventListener('change', async (e) => {
            this.selectedTvId = e.target.value;
            this.selectedLayerId = null;
            
            if (this.selectedTvId) {
                await this.loadLayers();
                
                // Resubscribe to new TV
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        type: 'subscribe_layers',
                        tv_id: this.selectedTvId
                    }));
                }
            }
        });
    }
    
    selectLayer(layerId) {
        this.selectedLayerId = layerId;
        this.updateLayersList();
        
        const layer = this.layers.find(l => l.layer_id === layerId);
        if (layer) {
            this.log(`Selected layer: ${layer.name}`);
            
            // Populate move controls with current position
            document.getElementById('moveX').value = layer.position.x;
            document.getElementById('moveY').value = layer.position.y;
        }
    }
    
    async createLayer() {
        if (!this.selectedTvId) {
            this.log('Please select a TV first', 'error');
            return;
        }
        
        const name = document.getElementById('layerName').value;
        const text = document.getElementById('layerText').value;
        const y = parseInt(document.getElementById('layerY').value);
        const height = parseInt(document.getElementById('layerHeight').value);
        const fontSize = parseInt(document.getElementById('fontSize').value);
        
        if (!name || !text) {
            this.log('Please fill in layer name and text', 'error');
            return;
        }
        
        const layerData = {
            name,
            layer_type: 'DataRow',
            content: {
                text,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                textColor: 'rgba(255, 255, 255, 1)',
                fontSize,
                alignment: 'left'
            },
            position: {
                x: 0,
                y,
                width: 1920,
                height
            },
            visible: true,
            opacity: 1.0,
            priority: 15
        };
        
        try {
            const response = await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(layerData)
            });
            
            if (response.ok) {
                const layer = await response.json();
                this.log(`Created layer: ${layer.name}`);
                await this.loadLayers();
                
                // Clear form
                document.getElementById('layerForm').reset();
                document.getElementById('layerY').value = 100;
                document.getElementById('layerHeight').value = 50;
                document.getElementById('fontSize').value = 24;
            } else {
                const error = await response.json();
                this.log(`Failed to create layer: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error creating layer: ${error.message}`, 'error');
        }
    }
    
    async animateSelected(animationType) {
        if (!this.selectedLayerId) {
            this.log('Please select a layer first', 'error');
            return;
        }
        
        const duration = parseInt(document.getElementById('animDuration').value);
        
        const animationData = {
            type: animationType,
            duration,
            easing: 'ease-in-out'
        };
        
        // Add distance for slide animations
        if (animationType.startsWith('slide_')) {
            animationData.distance = 100;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers/${this.selectedLayerId}/animate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(animationData)
            });
            
            if (response.ok) {
                this.log(`Started ${animationType} animation`);
            } else {
                const error = await response.json();
                this.log(`Failed to animate: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error animating layer: ${error.message}`, 'error');
        }
    }
    
    async moveSelected(animate = false) {
        if (!this.selectedLayerId) {
            this.log('Please select a layer first', 'error');
            return;
        }
        
        const x = parseInt(document.getElementById('moveX').value);
        const y = parseInt(document.getElementById('moveY').value);
        const duration = parseInt(document.getElementById('animDuration').value);
        
        try {
            const response = await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers/${this.selectedLayerId}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x, y, animate, duration })
            });
            
            if (response.ok) {
                this.log(`${animate ? 'Animated' : 'Moved'} layer to (${x}, ${y})`);
            } else {
                const error = await response.json();
                this.log(`Failed to move layer: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error moving layer: ${error.message}`, 'error');
        }
    }
    
    async toggleLayerVisibility(layerId, visible) {
        try {
            const response = await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers/${layerId}/visibility`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    visible, 
                    transition: { duration: 300 } 
                })
            });
            
            if (response.ok) {
                this.log(`Layer ${visible ? 'shown' : 'hidden'}`);
                await this.loadLayers();
            } else {
                const error = await response.json();
                this.log(`Failed to toggle visibility: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error toggling visibility: ${error.message}`, 'error');
        }
    }
    
    async deleteLayer(layerId) {
        if (!confirm('Are you sure you want to delete this layer?')) return;
        
        try {
            const response = await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers/${layerId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.log('Layer deleted');
                await this.loadLayers();
                
                if (this.selectedLayerId === layerId) {
                    this.selectedLayerId = null;
                }
            } else {
                const error = await response.json();
                this.log(`Failed to delete layer: ${error.error}`, 'error');
            }
        } catch (error) {
            this.log(`Error deleting layer: ${error.message}`, 'error');
        }
    }
    
    async createSampleLayers() {
        if (!this.selectedTvId) {
            this.log('Please select a TV first', 'error');
            return;
        }
        
        const sampleLayers = [
            {
                name: 'Court Schedule Header',
                text: 'TODAY\'S COURT SCHEDULE',
                y: 50,
                height: 60,
                fontSize: 32,
                backgroundColor: 'rgba(0, 0, 128, 0.9)'
            },
            {
                name: 'Court Room 1',
                text: '9:00 AM - Room 101 - Smith vs. Johnson',
                y: 150,
                height: 50,
                fontSize: 24,
                backgroundColor: 'rgba(0, 0, 0, 0.8)'
            },
            {
                name: 'Court Room 2', 
                text: '10:30 AM - Room 205 - State vs. Williams',
                y: 210,
                height: 50,
                fontSize: 24,
                backgroundColor: 'rgba(0, 0, 0, 0.8)'
            },
            {
                name: 'Alert Message',
                text: '⚠️ Court Room 205 Delayed by 30 minutes',
                y: 900,
                height: 60,
                fontSize: 28,
                backgroundColor: 'rgba(255, 0, 0, 0.9)'
            }
        ];
        
        this.log('Creating sample layers...');
        
        for (const sample of sampleLayers) {
            const layerData = {
                name: sample.name,
                layer_type: 'DataRow',
                content: {
                    text: sample.text,
                    backgroundColor: sample.backgroundColor,
                    textColor: 'rgba(255, 255, 255, 1)',
                    fontSize: sample.fontSize,
                    alignment: 'left'
                },
                position: {
                    x: 0,
                    y: sample.y,
                    width: 1920,
                    height: sample.height
                },
                visible: true,
                opacity: 1.0,
                priority: 15
            };
            
            try {
                await fetch(`${this.apiBase}/tvs/${this.selectedTvId}/layers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(layerData)
                });
            } catch (error) {
                this.log(`Error creating sample layer: ${error.message}`, 'error');
            }
        }
        
        await this.loadLayers();
        this.log('Sample layers created');
    }
    
    async hideAllLayers() {
        if (!this.selectedTvId || this.layers.length === 0) return;
        
        for (const layer of this.layers) {
            if (layer.visible) {
                await this.toggleLayerVisibility(layer.layer_id, false);
            }
        }
    }
    
    async showAllLayers() {
        if (!this.selectedTvId || this.layers.length === 0) return;
        
        for (const layer of this.layers) {
            if (!layer.visible) {
                await this.toggleLayerVisibility(layer.layer_id, true);
            }
        }
    }
    
    async deleteAllLayers() {
        if (!this.selectedTvId || this.layers.length === 0) return;
        
        if (!confirm(`Are you sure you want to delete all ${this.layers.length} layers?`)) return;
        
        for (const layer of this.layers) {
            await this.deleteLayer(layer.layer_id);
        }
    }
    
    startStatusUpdates() {
        // Refresh layer status every 5 seconds
        setInterval(() => {
            if (this.selectedTvId) {
                this.loadLayers();
            }
        }, 5000);

        // Refresh active alerts every 10 seconds
        setInterval(() => {
            this.loadActiveAlerts();
        }, 10000);
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
            const typeIcon = alert.type === 'CRITICAL' ? '🚨' : alert.type === 'URGENT' ? '⚠️' : 'ℹ️';
            const typeClass = alert.type.toLowerCase();

            return `
                <div class="active-alert-item ${typeClass}">
                    <div class="alert-header">
                        <span class="alert-icon">${typeIcon}</span>
                        <span class="alert-type-badge ${typeClass}">${alert.type}</span>
                        <span class="alert-time">${createdDate}</span>
                    </div>
                    <div class="alert-title">${alert.title}</div>
                    <div class="alert-message">${alert.message}</div>
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
}

// Global functions for HTML onclick handlers
let manager;

window.onload = () => {
    manager = new MultiLayerManager();
};

function loadTVs() {
    manager.loadTVs();
}

function selectLayer(layerId) {
    manager.selectLayer(layerId);
}

function createLayer() {
    manager.createLayer();
}

function animateSelected(type) {
    manager.animateSelected(type);
}

function moveSelected(animate) {
    manager.moveSelected(animate);
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
                            <div style="font-weight: 500; font-size: 14px;">${item.title}</div>
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

// Auto-refresh queue status every 5 seconds
setInterval(loadQueueStatus, 5000);
setTimeout(loadQueueStatus, 1000);