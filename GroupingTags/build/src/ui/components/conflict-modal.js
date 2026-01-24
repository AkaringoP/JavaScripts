/**
 * @fileoverview Conflict Resolution Modal
 * Present when importing data that conflicts with existing local data.
 */
import { detectDarkTheme } from '../../utils';
export class ConflictModal {
    /**
     * Shows the Conflict Resolution Modal.
     * @param diffs - List of conflicting data items.
     * @param onResolve - Callback with the chosen resolution action.
     */
    static show(diffs, onResolve) {
        const isDark = detectDarkTheme();
        const bgColor = isDark ? '#222' : '#fff';
        const textColor = isDark ? '#eee' : '#333';
        const borderColor = isDark ? '#444' : '#ccc';
        // 1. Overlay
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex',
            justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(2px)'
        });
        // 2. Window
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: bgColor, color: textColor,
            padding: '24px', borderRadius: '12px',
            width: '550px', maxHeight: '85vh', overflow: 'hidden',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column'
        });
        // 3. Header
        const title = document.createElement('h2');
        title.textContent = `⚠️ Data Conflict Detected (${diffs.length} items)`;
        title.style.margin = '0 0 16px 0';
        title.style.fontSize = '20px';
        title.style.borderBottom = `1px solid ${borderColor}`;
        title.style.paddingBottom = '12px';
        const desc = document.createElement('p');
        desc.textContent = "The external data differs from your local data.\nPlease choose how to resolve this conflict.";
        desc.style.whiteSpace = 'pre-wrap';
        desc.style.marginBottom = '20px';
        desc.style.lineHeight = '1.5';
        desc.style.color = isDark ? '#ccc' : '#666';
        // 4. Conflict List (Scrollable)
        const list = document.createElement('div');
        Object.assign(list.style, {
            flex: '1', overflowY: 'auto', marginBottom: '24px',
            border: `1px solid ${borderColor}`, borderRadius: '6px',
            backgroundColor: isDark ? '#1a1a1a' : '#f9f9f9', padding: '10px'
        });
        diffs.slice(0, 50).forEach(d => {
            const item = document.createElement('div');
            item.style.padding = '8px';
            item.style.borderBottom = `1px solid ${isDark ? '#333' : '#eee'}`;
            item.style.fontSize = '12px';
            const pid = document.createElement('strong');
            pid.textContent = `Post #${d.postId}`;
            const info = document.createElement('span');
            // Simple summary of groups
            const localGroups = Object.keys(d.local?.groups || {}).join(', ');
            const remoteGroups = Object.keys(d.remote.groups).join(', ');
            info.textContent = ` | Local: [${localGroups}] vs Remote: [${remoteGroups}]`;
            info.style.marginLeft = '10px';
            info.style.color = isDark ? '#aaa' : '#777';
            item.appendChild(pid);
            item.appendChild(info);
            list.appendChild(item);
        });
        if (diffs.length > 50) {
            const more = document.createElement('div');
            more.textContent = `...and ${diffs.length - 50} more items`;
            more.style.textAlign = 'center';
            more.style.padding = '8px';
            more.style.color = '#888';
            list.appendChild(more);
        }
        // 5. Buttons
        const btnContainer = document.createElement('div');
        Object.assign(btnContainer.style, {
            display: 'flex', gap: '12px', justifyContent: 'flex-end'
        });
        const close = () => document.body.removeChild(overlay);
        // Keep Local (Skip)
        const btnKeep = this.createBtn('Cancel (Keep Local)', '#777', () => {
            close();
            onResolve('KEEP');
        });
        // Overwrite (Remote wins)
        const btnOverwrite = this.createBtn('Overwrite (Use Remote)', '#d9534f', () => {
            if (confirm('Are you sure you want to overwrite your local data with the remote data?')) {
                close();
                onResolve('OVERWRITE');
            }
        });
        // Merge (Union) - Main Action
        const btnMerge = this.createBtn('Merge (Recommended)', '#0075ff', () => {
            close();
            onResolve('MERGE');
        });
        btnMerge.style.fontWeight = 'bold';
        btnContainer.append(btnKeep, btnOverwrite, btnMerge);
        modal.append(title, desc, list, btnContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }
    static createBtn(text, bgColor, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
            backgroundColor: bgColor, color: 'white',
            padding: '10px 20px', border: 'none', borderRadius: '6px',
            cursor: 'pointer', fontSize: '14px', transition: 'opacity 0.2s'
        });
        btn.onmouseover = () => btn.style.opacity = '0.9';
        btn.onmouseout = () => btn.style.opacity = '1';
        btn.onclick = onClick;
        return btn;
    }
}
//# sourceMappingURL=conflict-modal.js.map