// Alert Templates Management
let atAllTemplates = [];
let atCurrentTemplate = null;
let atInitialized = false;

// Initialize templates (called from app.js when section becomes active)
function atInitTemplates() {
    if (atInitialized) return;
    atInitialized = true;
    atLoadTemplates();
    atLoadStats();
}

async function atLoadTemplates() {
    try {
        const response = await fetch('/api/alerts/templates');
        const data = await response.json();

        if (data.success) {
            atAllTemplates = data.data;
            atRenderTemplates(atAllTemplates);
        } else {
            atShowError('Failed to load templates');
        }
    } catch (error) {
        console.error('Error loading templates:', error);
        atShowError('Error loading templates');
    }
}

async function atLoadStats() {
    try {
        const response = await fetch('/api/alerts/templates/stats');
        const data = await response.json();

        if (data.success) {
            document.getElementById('at-stat-total').textContent = data.data.total;
            document.getElementById('at-stat-builtin').textContent = data.data.builtin;
            document.getElementById('at-stat-custom').textContent = data.data.custom;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function atRenderTemplates(templates) {
    const grid = document.getElementById('at-templates-grid');

    if (templates.length === 0) {
        grid.innerHTML = `
            <div class="at-empty-state">
                <h3>No templates found</h3>
                <p>Try adjusting your filters or create a new template</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = templates.map(template => `
        <div class="at-template-card" onclick="atViewTemplate('${template.template_id}')">
            <div class="at-template-header">
                <div class="at-template-name">${template.name}</div>
            </div>

            <div class="at-template-badges">
                <span class="at-badge ${template.is_builtin ? 'at-badge-builtin' : 'at-badge-custom'}">
                    ${template.is_builtin ? 'Built-in' : 'Custom'}
                </span>
                <span class="at-badge at-badge-${template.alert_type.toLowerCase()}">
                    ${template.alert_type}
                </span>
                <span class="at-badge at-badge-category">${atCapitalize(template.category)}</span>
            </div>

            ${template.description ? `<div class="at-template-description">${template.description}</div>` : ''}

            ${template.variables.length > 0 ? `
                <div class="at-template-variables">
                    <h4>Variables (${template.variables.length}):</h4>
                    <div class="at-variable-chips">
                        ${template.variables.map(v => `<span class="at-variable-chip">\${${v}}</span>`).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="at-template-actions" onclick="event.stopPropagation()">
                <button class="btn btn-primary btn-sm" onclick="atOpenQuickSend('${template.template_id}')">
                    Quick-Send
                </button>
                ${!template.is_builtin ? `
                    <button class="btn btn-secondary btn-sm" onclick="atEditTemplate('${template.template_id}')">
                        Edit
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="atDeleteTemplate('${template.template_id}')">
                        Delete
                    </button>
                ` : `
                    <button class="btn btn-secondary btn-sm" onclick="atDuplicateTemplate('${template.template_id}')">
                        Duplicate
                    </button>
                `}
            </div>
        </div>
    `).join('');
}

function atFilterTemplates() {
    const category = document.getElementById('at-filter-category').value;
    const type = document.getElementById('at-filter-type').value;
    const alertType = document.getElementById('at-filter-alert-type').value;

    let filtered = atAllTemplates;

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

    atRenderTemplates(filtered);
}

async function atSearchTemplates() {
    const query = document.getElementById('at-search-input').value.trim();

    if (!query) {
        atRenderTemplates(atAllTemplates);
        return;
    }

    try {
        const response = await fetch(`/api/alerts/templates/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.success) {
            atRenderTemplates(data.data);
        }
    } catch (error) {
        console.error('Error searching templates:', error);
    }
}

function atViewTemplate(templateId) {
    const template = atAllTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    alert(`Template: ${template.name}\n\nCategory: ${template.category}\nType: ${template.alert_type}\n\nTitle: ${template.title_template}\nMessage: ${template.message_template}\n\nVariables: ${template.variables.join(', ') || 'None'}`);
}

function atOpenCreateModal() {
    atCurrentTemplate = null;
    document.getElementById('at-modal-title').textContent = 'Create Template';
    document.getElementById('at-template-form').reset();
    document.getElementById('at-template-modal').classList.add('show');
}

function atEditTemplate(templateId) {
    const template = atAllTemplates.find(t => t.template_id === templateId);
    if (!template || template.is_builtin) return;

    atCurrentTemplate = template;
    document.getElementById('at-modal-title').textContent = 'Edit Template';
    document.getElementById('at-template-name').value = template.name;
    document.getElementById('at-template-category').value = template.category;
    document.getElementById('at-template-alert-type').value = template.alert_type;
    document.getElementById('at-template-title').value = template.title_template;
    document.getElementById('at-template-message').value = template.message_template;
    document.getElementById('at-template-description').value = template.description || '';

    document.getElementById('at-template-modal').classList.add('show');
}

async function atSaveTemplate(event) {
    event.preventDefault();

    const templateData = {
        name: document.getElementById('at-template-name').value,
        category: document.getElementById('at-template-category').value,
        alert_type: document.getElementById('at-template-alert-type').value,
        title_template: document.getElementById('at-template-title').value,
        message_template: document.getElementById('at-template-message').value,
        description: document.getElementById('at-template-description').value,
        created_by: 'admin'
    };

    try {
        let response;
        if (atCurrentTemplate) {
            response = await fetch(`/api/alerts/templates/${atCurrentTemplate.template_id}`, {
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
            atCloseModal();
            atLoadTemplates();
            atLoadStats();
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast(`Template ${atCurrentTemplate ? 'updated' : 'created'} successfully!`, 'success');
            } else {
                alert(`Template ${atCurrentTemplate ? 'updated' : 'created'} successfully!`);
            }
        } else {
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast(`Error: ${data.error}`, 'error');
            } else {
                alert(`Error: ${data.error}`);
            }
        }
    } catch (error) {
        console.error('Error saving template:', error);
        if (typeof app !== 'undefined' && app.showToast) {
            app.showToast('Error saving template', 'error');
        } else {
            alert('Error saving template');
        }
    }
}

async function atDeleteTemplate(templateId) {
    const template = atAllTemplates.find(t => t.template_id === templateId);
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
            atLoadTemplates();
            atLoadStats();
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast('Template deleted successfully!', 'success');
            } else {
                alert('Template deleted successfully!');
            }
        } else {
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast(`Error: ${data.error}`, 'error');
            } else {
                alert(`Error: ${data.error}`);
            }
        }
    } catch (error) {
        console.error('Error deleting template:', error);
        if (typeof app !== 'undefined' && app.showToast) {
            app.showToast('Error deleting template', 'error');
        } else {
            alert('Error deleting template');
        }
    }
}

async function atDuplicateTemplate(templateId) {
    const template = atAllTemplates.find(t => t.template_id === templateId);
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
            atLoadTemplates();
            atLoadStats();
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast('Template duplicated successfully!', 'success');
            } else {
                alert('Template duplicated successfully!');
            }
        } else {
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast(`Error: ${data.error}`, 'error');
            } else {
                alert(`Error: ${data.error}`);
            }
        }
    } catch (error) {
        console.error('Error duplicating template:', error);
        if (typeof app !== 'undefined' && app.showToast) {
            app.showToast('Error duplicating template', 'error');
        } else {
            alert('Error duplicating template');
        }
    }
}

function atOpenQuickSend(templateId) {
    const template = atAllTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    const modal = document.getElementById('at-quick-send-modal');
    const content = document.getElementById('at-quick-send-content');

    document.getElementById('at-quick-send-title').textContent = `Quick-Send: ${template.name}`;

    const variableInputs = template.variables.map(variable => `
        <div class="form-group">
            <label>${atCapitalize(variable.replace(/_/g, ' '))} *</label>
            <input type="text" id="at-var-${variable}" class="form-input" required>
        </div>
    `).join('');

    content.innerHTML = `
        <form id="at-quick-send-form" onsubmit="atSendFromTemplate(event, '${templateId}')">
            ${variableInputs || '<p>This template has no variables.</p>'}

            <div class="form-group">
                <label>Target Type *</label>
                <select id="at-target-type" class="form-select" onchange="atUpdateTargetFields()">
                    <option value="all">All TVs</option>
                    <option value="specific">Specific TVs</option>
                    <option value="location">By Location</option>
                </select>
            </div>

            <div class="form-group" id="at-target-ids-group" style="display: none;">
                <label>TV IDs (comma-separated)</label>
                <input type="text" id="at-target-ids" class="form-input" placeholder="tv_001, tv_002">
            </div>

            <div class="form-group" id="at-target-location-group" style="display: none;">
                <label>Location</label>
                <input type="text" id="at-target-location" class="form-input" placeholder="Building A">
            </div>

            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="atCloseQuickSendModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Send Alert</button>
            </div>
        </form>
    `;

    modal.classList.add('show');
}

function atUpdateTargetFields() {
    const targetType = document.getElementById('at-target-type').value;
    document.getElementById('at-target-ids-group').style.display = targetType === 'specific' ? 'block' : 'none';
    document.getElementById('at-target-location-group').style.display = targetType === 'location' ? 'block' : 'none';
}

async function atSendFromTemplate(event, templateId) {
    event.preventDefault();

    const template = atAllTemplates.find(t => t.template_id === templateId);
    if (!template) return;

    const variables = {};
    template.variables.forEach(variable => {
        const input = document.getElementById(`at-var-${variable}`);
        if (input) {
            variables[variable] = input.value;
        }
    });

    const targetType = document.getElementById('at-target-type').value;
    const payload = {
        variables,
        target_type: targetType,
        created_by: 'admin'
    };

    if (targetType === 'specific') {
        const ids = document.getElementById('at-target-ids').value;
        payload.target_ids = ids.split(',').map(id => id.trim()).filter(id => id);
    } else if (targetType === 'location') {
        payload.target_location = document.getElementById('at-target-location').value;
    }

    try {
        const response = await fetch(`/api/alerts/templates/${templateId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            atCloseQuickSendModal();
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast(`Alert sent! Delivered to ${data.data.delivered_count} of ${data.data.target_count} TVs`, 'success');
            } else {
                alert(`Alert sent successfully!\nDelivered to ${data.data.delivered_count} of ${data.data.target_count} TVs`);
            }
        } else {
            if (typeof app !== 'undefined' && app.showToast) {
                app.showToast(`Error: ${data.error}`, 'error');
            } else {
                alert(`Error: ${data.error}`);
            }
        }
    } catch (error) {
        console.error('Error sending alert:', error);
        if (typeof app !== 'undefined' && app.showToast) {
            app.showToast('Error sending alert', 'error');
        } else {
            alert('Error sending alert');
        }
    }
}

function atCloseModal() {
    document.getElementById('at-template-modal').classList.remove('show');
}

function atCloseQuickSendModal() {
    document.getElementById('at-quick-send-modal').classList.remove('show');
}

function atCapitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function atShowError(message) {
    const grid = document.getElementById('at-templates-grid');
    grid.innerHTML = `
        <div class="at-empty-state">
            <h3>Error</h3>
            <p>${message}</p>
        </div>
    `;
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        atCloseModal();
        atCloseQuickSendModal();
    }
});
