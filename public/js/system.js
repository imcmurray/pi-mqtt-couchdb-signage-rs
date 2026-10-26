// The System page: ntfy notifications, fleet versions and backups
const systemPage = {
    async api(path, options = {}) {
        const response = await fetch(`/api/system${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || response.statusText);
        return body;
    },

    escape(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    },

    when(iso) {
        return iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
    },

    async load() {
        await Promise.all([this.loadNotifications(), this.loadFleet(), this.loadBackups()]);
    },

    async loadNotifications() {
        try {
            const settings = await this.api('/notifications');
            const status = document.getElementById('notifyStatus');
            status.textContent = settings.configured
                ? `Sending to ${settings.topic}${settings.from_environment ? ' (set by NTFY_URL)' : ''}${settings.enabled ? '' : ' · paused'}`
                : 'No topic set: nothing is sent';
            status.className = `system-status ${settings.configured && settings.enabled ? 'ok' : 'warn'}`;
            document.getElementById('notifyForm').hidden = settings.from_environment;
            document.getElementById('notifyEnabled').checked = settings.enabled;
            document.getElementById('notifyStates').innerHTML = settings.states.length
                ? settings.states.map(s => `<div class="system-row"><span class="dot ${s.state}"></span>
                    <span>${this.escape(s.title || s.key)}</span><small>since ${this.when(s.since)}</small></div>`).join('')
                : '<div class="system-row muted">Nothing reported yet</div>';
        } catch (error) {
            document.getElementById('notifyStatus').textContent = error.message;
        }
    },

    async saveTopic() {
        const url = document.getElementById('notifyUrl').value.trim();
        try {
            await this.api('/notifications', { method: 'PUT', body: JSON.stringify({ ntfy_url: url }) });
            document.getElementById('notifyUrl').value = '';
            await this.loadNotifications();
        } catch (error) {
            alert(`Couldn't save the topic: ${error.message}`);
        }
    },

    async setEnabled(enabled) {
        await this.api('/notifications', { method: 'PUT', body: JSON.stringify({ enabled }) }).catch(error => alert(error.message));
        await this.loadNotifications();
    },

    async test() {
        try {
            alert((await this.api('/notifications/test', { method: 'POST' })).message);
        } catch (error) {
            alert(error.message);
        }
    },

    async loadFleet() {
        try {
            const fleet = await this.api('/fleet');
            const rows = fleet.tvs.map(tv => {
                const version = tv.version
                    ? `<span class="version ${tv.up_to_date ? 'ok' : 'warn'}">${this.escape(tv.version)}${tv.up_to_date ? ' ✓' : ' ⚠'}</span>`
                    : `<span class="version muted">${tv.status === 'online' ? 'unknown' : '—'}</span>`;
                return `<div class="system-row"><span class="dot ${tv.status === 'online' ? 'ok' : 'bad'}"></span>
                    <span><strong>${this.escape(tv.name)}</strong> <small>${this.escape(tv.ip_address || '')}</small></span>${version}</div>`;
            }).join('');
            document.getElementById('fleetTable').innerHTML =
                `<div class="system-row muted">Manager <span class="version">${this.escape(fleet.manager_version)}</span></div>${rows}`;
        } catch (error) {
            document.getElementById('fleetTable').textContent = error.message;
        }
    },

    async loadBackups() {
        try {
            const backups = await this.api('/backups');
            const last = backups.last;
            const status = document.getElementById('backupStatus');
            status.textContent = last
                ? (last.ok ? `Last backup ${this.when(last.at)} · ${(last.size / 1e6).toFixed(1)} MB` : `Last backup failed ${this.when(last.at)}: ${last.error}`)
                : `Nightly at ${backups.schedule}; keeps ${backups.keep}`;
            status.className = `system-status ${last && !last.ok ? 'bad' : 'ok'}`;
            document.getElementById('backupList').innerHTML = backups.backups.length
                ? backups.backups.map(b => `<div class="system-row"><i class="fas fa-file-archive"></i>
                    <a href="/api/system/backups/${encodeURIComponent(b.file)}">${this.escape(b.file)}</a>
                    <small>${(b.size / 1e6).toFixed(1)} MB</small></div>`).join('')
                : '<div class="system-row muted">No backups yet</div>';
        } catch (error) {
            document.getElementById('backupStatus').textContent = error.message;
        }
    },

    async backupNow() {
        const button = document.getElementById('backupNow');
        button.disabled = true;
        button.textContent = 'Backing up…';
        try {
            await this.api('/backups', { method: 'POST' });
        } catch (error) {
            alert(error.message);
        }
        button.disabled = false;
        button.textContent = 'Back up now';
        await this.loadBackups();
    }
};

document.addEventListener('section-changed', event => {
    if (event.detail.section === 'system') systemPage.load();
});
