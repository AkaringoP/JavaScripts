/**
 * @fileoverview Login Modal Component
 * Provides a user-friendly guide for generating and entering a GitHub PAT.
 */

import { AuthManager } from '../../core/auth';
import { detectDarkTheme } from '../../utils';

export class LoginModal {
    /**
     * Shows the Login Modal.
     * @param onSuccess - Callback function triggered after successful token save.
     */
    static show(onSuccess: () => void) {
        const isDark = detectDarkTheme();
        const bgColor = isDark ? '#222' : '#fff';
        const textColor = isDark ? '#eee' : '#333';

        // 1. Overlay
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        });

        // 2. Modal Window
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: bgColor, color: textColor,
            padding: '24px', borderRadius: '12px',
            width: '500px', maxWidth: '90%',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', gap: '16px',
            fontFamily: 'sans-serif'
        });

        // 3. Content
        modal.innerHTML = `
            <h2 style="margin: 0 0 10px 0; border-bottom: 2px solid #0075ff; padding-bottom: 8px;">🔑 GitHub Connection Setup</h2>
            
            <div style="font-size: 14px; line-height: 1.5; color: ${isDark ? '#ccc' : '#555'};">
                <p style="margin-bottom: 12px;">
                    To save data to Gist (Cloud), a <strong>Personal Access Token</strong> is required.<br>
                    This token acts as a password, so please keep it safe.
                </p>
                
                <div style="background: ${isDark ? '#333' : '#f5f5f5'}; padding: 12px; borderRadius: 8px; border: 1px solid ${isDark ? '#444' : '#ddd'};">
                    <strong style="display:block; margin-bottom: 8px; color: ${isDark ? '#fff' : '#000'};">🛠️ How to generate a Token (One-time setup)</strong>
                    <ol style="margin: 0; padding-left: 20px; font-size: 13px;">
                        <li style="margin-bottom: 4px;">Log in to GitHub and go to <strong>Settings > Developer settings</strong>.</li>
                        <li style="margin-bottom: 4px;">Select <strong>Personal access tokens > Tokens (classic)</strong>.</li>
                        <li style="margin-bottom: 4px;">Click <strong>Generate new token (classic)</strong>.</li>
                        <li style="margin-bottom: 4px;">Enter a recognizable name like <strong>"Danbooru Tags"</strong> in the Note.</li>
                        <li style="margin-bottom: 4px;">Set Expiration to <strong>No expiration (Recommended)</strong>.</li>
                        <li style="margin-bottom: 4px; color: #ff6b6b; font-weight: bold;">Check ONLY the <strong>'gist'</strong> scope checkbox. ✅</li>
                        <li style="margin-bottom: 4px;">Copy the generated code starting with <code>ghp_...</code> and paste it below.</li>
                    </ol>
                </div>
            </div>
        `;

        // 4. Input Area
        const inputContainer = document.createElement('div');
        inputContainer.style.display = 'flex';
        inputContainer.style.gap = '8px';
        inputContainer.style.marginTop = '8px';

        const input = document.createElement('input');
        input.placeholder = "ghp_xxxxxxxxxxxxxxxxxxxx";
        input.type = "password"; // Hide token visually
        Object.assign(input.style, {
            flex: '1', padding: '10px', borderRadius: '6px',
            border: '1px solid #888', backgroundColor: isDark ? '#444' : '#fff', color: textColor,
            fontFamily: 'monospace'
        });

        // Toggle Visibility
        const toggleVis = document.createElement('button');
        toggleVis.textContent = '👁️';
        Object.assign(toggleVis.style, {
            padding: '0 10px', borderRadius: '6px', border: '1px solid #888',
            backgroundColor: isDark ? '#444' : '#f0f0f0', cursor: 'pointer'
        });
        toggleVis.onclick = () => {
            input.type = input.type === 'password' ? 'text' : 'password';
        };

        // Save Button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Connect';
        Object.assign(saveBtn.style, {
            width: '100%', padding: '12px', borderRadius: '6px', border: 'none',
            backgroundColor: '#0075ff', color: 'white', fontWeight: 'bold', fontSize: '15px',
            cursor: 'pointer', marginTop: '4px'
        });

        saveBtn.onclick = async () => {
            const token = input.value.trim();
            if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
                alert("Invalid token format. (Must start with ghp_ or github_pat_)");
                return;
            }

            // Save Token
            await AuthManager.setToken(token);

            // Close and Callback
            document.body.removeChild(overlay);
            onSuccess();
        };

        // Close logic
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        inputContainer.appendChild(input);
        inputContainer.appendChild(toggleVis);

        modal.appendChild(inputContainer);
        modal.appendChild(saveBtn);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Focus
        input.focus();
    }
}
