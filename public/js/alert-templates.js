// Alert Templates Management
let allTemplates = [];
let currentTemplate = null;

// Load templates on page load
document.addEventListener('DOMContentLoaded', () => {
    loadTemplates();
    loadStats();
});

async function loadTemplates() {
    try {
        const response = await fetch('/api/alerts/templates');
        const data = await response.json();

        if (data.success) {
            allTemplates = data.data;
            renderTemplates(allTemplates);
        } else {
            showError('Failed to load templates');
        }
    } catch (error) {
        console.error('Error loading templates:', error);
        showError('Error loading templates');
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/alerts/templates/stats');
        const data = await response.json();

        if (data.success) {
            document.getElementById('stat-total').textContent = data.data.total;
            document.getElementById('stat-builtin').textContent = data.data.builtin;
            document.getElementById('stat-custom').textContent = data.data.custom;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function renderTemplates(templates) {
    const grid = document.getElementById('templates-grid');

    if (templates.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <h3>No templates found</h3>
                <p>Try adjusting your filters or create a new template</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = templates.map(template => `
        <div class="template-card" onclick="viewTemplate('${template.template_id}')">
            <div class="template-header">
                <div class="template-name">${template.name}</div>
            </div>

            <div class="template-badges">
                <span class="badge ${template.is_builtin ? 'badge-builtin' : 'badge-custom'}">
                    ${template.is_builtin ? 'Built-in' : 'Custom'}
                </span>
                <span class="badge badge-${template.alert_type.toLowerCase()}">
                    ${template.alert_type}
                </span>
                <span class="badge badge-category">${capitalize(template.category)}</span>
            </div>

            ${template.description ? `<div class="template-description">${template.description}</div>` : ''}

            ${template.variables.length > 0 ? `
                <div class="template-variables">
                    <h4>Variables (${template.variables.length}):</h4>
                    <div class="variable-chips">
                        ${template.variables.map(v => `<span class="variable-chip">\${${v}}</span>`).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="template-actions" onclick="event.stopPropagation()">
                <button class="btn btn-primary btn-small" onclick="openQuickSend('${template.template_id}')">
                    Quick-Send
                </button>
                ${!template.is_builtin ? `
                    <button class="btn btn-secondary btn-small" onclick="editTemplate('${template.template_id}')">
                        Edit
                    </button>
                    <button class="btn btn-danger btn-small" onclick="deleteTemplate('${template.template_id}')">
                        Delete
                    </button>
                ` : `
                    <button class="btn btn-secondary btn-small" onclick="duplicateTemplate('${template.template_id}')">
                        Duplicate
                    </button>
                `}
            </div>
        </div>
    `).join('');
}

function filterTemplates() {
    const category = document.getElementById('filter-category').value;
    const type = document.getElementById('filter-type').value;
    const alertType = document.getElementById('filter-alert-type').value;

    let filtered = allTemplates;

    if (category) {
        filtered = filtered.filter(t => t.category === category);
    }

    if (type) {
        const isBuiltin = type === 'builtin';
        filtered = filtered.filter(t => t.is_builtin === isBuiltin);
    }

    if (alertType) {
        filtered = filtered.filter(t => t.alert_type === alertType);
    }

    renderTemplates(filtered);
}

async function searchTemplates() {
    const query = document.getElementById('search-input').value.trim();

    if (!query) {
        renderTemplates(allTemplates);
        return;
    }

    try {
        const response = await fetch(`/api/alerts/templates/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.success) {
            renderTemplates(data.data);
        }
    } catch (error) {
        console.error('Error searching templates:', error);
    }
}

function viewTemplate(templateId) {
    const template = allTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    alert(`Template: ${template.name}\n\nCategory: ${template.category}\nType: ${template.alert_type}\n\nTitle: ${template.title_template}\nMessage: ${template.message_template}\n\nVariables: ${template.variables.join(', ') || 'None'}`);
}

function openCreateModal() {
    currentTemplate = null;
    document.getElementById('modal-title').textContent = 'Create Template';
    document.getElementById('template-form').reset();
    document.getElementById('template-modal').classList.add('active');
}

function editTemplate(templateId) {
    const template = allTemplates.find(t => t.template_id === templateId);
    if (!template || template.is_builtin) return;

    currentTemplate = template;
    document.getElementById('modal-title').textContent = 'Edit Template';
    document.getElementById('template-name').value = template.name;
    document.getElementById('template-category').value = template.category;
    document.getElementById('template-alert-type').value = template.alert_type;
    document.getElementById('template-title').value = template.title_template;
    document.getElementById('template-message').value = template.message_template;
    document.getElementById('template-description').value = template.description || '';

    document.getElementById('template-modal').classList.add('active');
}

async function saveTemplate(event) {
    event.preventDefault();

    const templateData = {
        name: document.getElementById('template-name').value,
        category: document.getElementById('template-category').value,
        alert_type: document.getElementById('template-alert-type').value,
        title_template: document.getElementById('template-title').value,
        message_template: document.getElementById('template-message').value,
        description: document.getElementById('template-description').value,
        created_by: 'admin'
    };

    try {
        let response;
        if (currentTemplate) {
            response = await fetch(`/api/alerts/templates/${currentTemplate.template_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(templateData)
            });
        } else {
            response = await fetch('/api/alerts/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(templateData)
            });
        }

        const data = await response.json();

        if (data.success) {
            closeModal();
            loadTemplates();
            loadStats();
            alert(`Template ${currentTemplate ? 'updated' : 'created'} successfully!`);
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error saving template:', error);
        alert('Error saving template');
    }
}

async function deleteTemplate(templateId) {
    const template = allTemplates.find(t => t.template_id === templateId);
    if (!template || template.is_builtin) return;

    if (!confirm(`Are you sure you want to delete "${template.name}"?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/alerts/templates/${templateId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            loadTemplates();
            loadStats();
            alert('Template deleted successfully!');
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error deleting template:', error);
        alert('Error deleting template');
    }
}

async function duplicateTemplate(templateId) {
    const template = allTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    const newName = prompt(`Enter name for duplicated template:`, `${template.name} (Copy)`);
    if (!newName) return;

    try {
        const response = await fetch(`/api/alerts/templates/${templateId}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });

        const data = await response.json();

        if (data.success) {
            loadTemplates();
            loadStats();
            alert('Template duplicated successfully!');
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error duplicating template:', error);
        alert('Error duplicating template');
    }
}

function openQuickSend(templateId) {
    const template = allTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    const modal = document.getElementById('quick-send-modal');
    const content = document.getElementById('quick-send-content');

    document.getElementById('quick-send-title').textContent = `Quick-Send: ${template.name}`;

    const variableInputs = template.variables.map(variable => `
        <div class="form-group">
            <label>${capitalize(variable.replace(/_/g, ' '))} *</label>
            <input type="text" id="var-${variable}" required>
        </div>
    `).join('');

    content.innerHTML = `
        <form id="quick-send-form" onsubmit="sendFromTemplate(event, '${templateId}')">
            ${variableInputs || '<p>This template has no variables.</p>'}

            <div class="form-group">
                <label>Target Type *</label>
                <select id="target-type" onchange="updateTargetFields()">
                    <option value="all">All TVs</option>
                    <option value="specific">Specific TVs</option>
                    <option value="location">By Location</option>
                </select>
            </div>

            <div class="form-group" id="target-ids-group" style="display: none;">
                <label>TV IDs (comma-separated)</label>
                <input type="text" id="target-ids" placeholder="tv_001, tv_002">
            </div>

            <div class="form-group" id="target-location-group" style="display: none;">
                <label>Location</label>
                <input type="text" id="target-location" placeholder="Building A">
            </div>

            <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="closeQuickSendModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Send Alert</button>
            </div>
        </form>
    `;

    modal.classList.add('active');
}

function updateTargetFields() {
    const targetType = document.getElementById('target-type').value;
    document.getElementById('target-ids-group').style.display = targetType === 'specific' ? 'block' : 'none';
    document.getElementById('target-location-group').style.display = targetType === 'location' ? 'block' : 'none';
}

async function sendFromTemplate(event, templateId) {
    event.preventDefault();

    const template = allTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    const variables = {};
    template.variables.forEach(variable => {
        const input = document.getElementById(`var-${variable}`);
        if (input) {
            variables[variable] = input.value;
        }
    });

    const targetType = document.getElementById('target-type').value;
    const payload = {
        variables,
        target_type: targetType,
        created_by: 'admin'
    };

    if (targetType === 'specific') {
        const ids = document.getElementById('target-ids').value;
        payload.target_ids = ids.split(',').map(id => id.trim()).filter(id => id);
    } else if (targetType === 'location') {
        payload.target_location = document.getElementById('target-location').value;
    }

    try {
        const response = await fetch(`/api/alerts/templates/${templateId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            closeQuickSendModal();
            alert(`Alert sent successfully!\nDelivered to ${data.data.delivered_count} of ${data.data.target_count} TVs`);
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error sending alert:', error);
        alert('Error sending alert');
    }
}

function closeModal() {
    document.getElementById('template-modal').classList.remove('active');
}

function closeQuickSendModal() {
    document.getElementById('quick-send-modal').classList.remove('active');
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function showError(message) {
    const grid = document.getElementById('templates-grid');
    grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
            <h3>Error</h3>
            <p>${message}</p>
        </div>
    `;
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        closeQuickSendModal();
    }
});
