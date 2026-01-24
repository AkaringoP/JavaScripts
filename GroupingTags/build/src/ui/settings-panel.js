/**
 * @fileoverview Settings Panel UI
 * Handles manual sync, import, and displaying connection status.
 */
import { detectDarkTheme } from '../utils';
export class SettingsPanel {
    /**
     * Displays the Settings Modal.
     */
    static show() {
        const isDark = detectDarkTheme();
        const bgColor = isDark ? '#222' : '#fff';
        const textColor = isDark ? '#eee' : '#333';
        // Panel Overlay
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        });
        // Panel Window
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            backgroundColor: bgColor, color: textColor,
            padding: '20px', borderRadius: '10px',
            width: '400px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column', gap: '16px'
        });
        SettingsPanel.renderPanelContent(panel, isDark);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        // Click Outside to Close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
    }
    /**
     * Renders the internal content of the panel.
     * @param panel - The container element.
     * @param isDark - Theme preference.
     */
    static async renderPanelContent(panel, isDark) {
        const { AuthManager } = await import('../core/auth');
        const token = await AuthManager.getToken(true); // Silent check
        const gistId = AuthManager.getGistId();
        const isConnected = !!(token && gistId);
        // Clear loading state if any
        panel.innerHTML = '';
        // Header
        const header = document.createElement('h3');
        header.textContent = '⚙️ Grouping Tags Settings';
        header.style.margin = '0 0 10px 0';
        header.style.borderBottom = '1px solid #888';
        header.style.paddingBottom = '10px';
        panel.appendChild(header);
        // Auth Box
        const authBox = document.createElement('div');
        authBox.innerHTML = `
          <div style="font-size: 13px; margin-bottom: 4px;"><strong>My Gist ID:</strong></div>
          <div style="background: ${isDark ? '#333' : '#eee'}; padding: 6px; border-radius: 4px; font-family: monospace; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
            <span style="overflow: hidden; text-overflow: ellipsis;">${gistId || 'Not Connected'}</span>
            ${!isConnected ? '🔴' : '🟢'}
          </div>
        `;
        panel.appendChild(authBox);
        // Sync Section
        const syncBtn = document.createElement('button');
        syncBtn.textContent = '☁️ Sync Now (Upload/Download)';
        Object.assign(syncBtn.style, {
            padding: '10px', backgroundColor: '#28a745', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold',
            marginTop: '10px', opacity: isConnected ? '1' : '0.5',
            pointerEvents: isConnected ? 'auto' : 'none'
        });
        if (!isConnected) {
            syncBtn.title = "Gist connection required.";
        }
        syncBtn.onclick = async () => {
            if (!gistId)
                return alert("No Gist ID found.");
            syncBtn.disabled = true;
            syncBtn.textContent = '🔄 Syncing...';
            try {
                // Dynamic Import
                const { getLocalDataByShard } = await import('../db');
                const { SyncManager } = await import('../core/sync-manager');
                for (let i = 0; i < 10; i++) {
                    const localData = await getLocalDataByShard(i);
                    await SyncManager.syncShard(i, localData, false);
                }
                alert("Sync completed! ✅");
            }
            catch (e) {
                alert(`Sync failed: ${e}`);
            }
            finally {
                syncBtn.disabled = false;
                syncBtn.textContent = '☁️ Sync Now (Upload/Download)';
            }
        };
        panel.appendChild(syncBtn);
        // Import Section
        const importBox = document.createElement('div');
        importBox.style.marginTop = '15px';
        const label = document.createElement('div');
        label.textContent = "📥 Import External Gist";
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '8px';
        importBox.appendChild(label);
        const input = document.createElement('input');
        input.placeholder = "Paste Gist URL or ID here...";
        Object.assign(input.style, {
            width: '100%', padding: '8px', marginBottom: '8px',
            boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc'
        });
        importBox.appendChild(input);
        const importBtn = document.createElement('button');
        importBtn.textContent = "Start Import";
        Object.assign(importBtn.style, {
            width: '100%', padding: '8px', backgroundColor: '#007bff', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            opacity: isConnected ? '1' : '0.5',
            pointerEvents: isConnected ? 'auto' : 'none'
        });
        importBtn.onclick = async () => {
            const val = input.value.trim();
            if (!val)
                return;
            const { ImportManager, mergeGroups } = await import('../core/import-manager');
            const { getLocalDataByShard, savePostTagData } = await import('../db');
            const { ConflictModal } = await import('./components/conflict-modal');
            importBtn.disabled = true;
            importBtn.textContent = "⏳ Fetching...";
            try {
                let targetId = val;
                const urlMatch = val.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
                if (urlMatch)
                    targetId = urlMatch[1];
                const remoteData = await ImportManager.fetchExternalGist(targetId);
                let allLocal = {};
                for (let i = 0; i < 10; i++) {
                    const shard = await getLocalDataByShard(i);
                    Object.assign(allLocal, shard);
                }
                const diffs = ImportManager.compareWithLocal(allLocal, remoteData);
                const conflicts = diffs.filter(d => d.status === 'CONFLICT');
                const newItems = diffs.filter(d => d.status === 'NEW');
                for (const n of newItems) {
                    n.remote.isImported = true;
                    await savePostTagData(n.remote);
                }
                if (conflicts.length > 0) {
                    const overlay = panel.parentElement;
                    if (overlay)
                        document.body.removeChild(overlay);
                    ConflictModal.show(conflicts, async (res) => {
                        let count = 0;
                        for (const c of conflicts) {
                            let final = c.remote;
                            if (res === 'MERGE' && c.local)
                                final = { ...c.local, groups: mergeGroups(c.local.groups, c.remote.groups), isImported: true };
                            else if (res === 'OVERWRITE')
                                final.isImported = true;
                            if (res !== 'KEEP') {
                                await savePostTagData(final);
                                count++;
                            }
                        }
                        alert(`Resolved! (New: ${newItems.length}, ${res === 'MERGE' ? 'Merged' : 'Overwritten'}: ${count})`);
                    });
                }
                else {
                    alert(`Done! Imported ${newItems.length} new items.`);
                }
            }
            catch (e) {
                alert("Import Error: " + e);
            }
            finally {
                importBtn.disabled = false;
                importBtn.textContent = 'Start Import';
            }
        };
        importBox.appendChild(importBtn);
        panel.appendChild(importBox);
        // Close Button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.marginTop = '20px';
        closeBtn.onclick = () => {
            const overlay = panel.parentElement;
            if (overlay)
                document.body.removeChild(overlay);
        };
        panel.appendChild(closeBtn);
    }
}
//# sourceMappingURL=settings-panel.js.map