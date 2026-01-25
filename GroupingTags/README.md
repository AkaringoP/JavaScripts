# Danbooru Grouping Tags

A professional-grade UserScript that transforms the Danbooru tag input experience. It introduces a powerful grouping system, intelligent sorting, and a state-of-the-art visual interface to help users manage complex tag lists with ease.

## ✨ Key Features

### 1️⃣ Smart Tag Editing & Groups Syntax
Experience a seamless way to organize tags directly in the edit window using the `GroupName[ tag1 tag2 ]` syntax.
- **Intelligent Syntax**: Groups are automatically parsed, highlighted, and kept visually distinct with the **Phantom UI**.
- **Edit Assist**: Features bracket auto-completion, `Tab` key escapes, and smart merging to prevent duplicate groups.
- **Auto-Sorting**: Character tags are prioritized at the front of each group via Danbooru API integration.
- <img width="651" height="308" alt="image" src="https://github.com/user-attachments/assets/3237a7fa-0726-4896-aa18-96d88a25a76c" />


### 2️⃣ Integrated Sidebar Management
Manage your groupings visually without leaving the sidebar.
- **Quick Assignment**: Use the dedicated **circle buttons** next to tags in the sidebar to instantly add/remove tags from specific groups.
- **Visual Feedback**: Sidebar indicators show which tags belong to which group at a glance, keeping your workflow organized.
- <img width="400" height="445" alt="image" src="https://github.com/user-attachments/assets/1b2378a6-700e-4d89-a0e9-ac4264521a54" />


### 3️⃣ Universal Gist Synchronization
Your data, everywhere. Sync your entire configuration and grouping data using a private GitHub Gist.
- **Cross-Device Sync**: Seamlessly move between different browsers or devices while keeping your groups intact.
- **User Collaboration**: Share your Gist ID to sync grouping logic across different users or team members.
- **Reliable Storage**: High-capacity syncing via "Sharding" ensures even massive tag lists are backed up safely.

## � Usage

### 1️⃣ Advanced Tag Editor
The script enhances the standard tag input field with a powerful grouping syntax:
- **Group Creation**: Type `GroupName[` and the script completes it to `GroupName[ | ]`, placing your cursor inside.
- **Adding Tags**: Type your tags inside the brackets.
- **Quick Exit**: Press `Tab` to jump out of the group brackets instantly.
- **Smart Appending**: If you type `GroupName[` again for an existing group, the cursor simply jumps to the end of that group so you can append more tags.
- **Seamless Submission**: When you click Submit, the script saves your grouping structure to the local database, but sends only the plain tags to the server (preserving Danbooru's native tag format).

### 2️⃣ Sidebar Management
On post pages, a new visual interface appears in the sidebar tag list:
- **Group Indicators**: Tags belonging to a group are marked with colored circle indicators.
- **Quick Actions**: Click the indicator area to:
    - Assign the tag to an existing group.
    - Create a completely new group for the tag.
    - Remove the tag from its current group.

### 3️⃣ Cloud Sync (Gist)
Sync your group definitions across devices and share them with other users using GitHub Gist.
> **Note**: This feature requires a GitHub Personal Access Token (PAT).

#### 🔑 How to get a Personal Access Token (PAT)
1.  Log in to GitHub and go to **Settings > Developer settings > Personal access tokens > Tokens (classic)**.
2.  Click **Generate new token (classic)**.
3.  **Note**: Give it a recognizable name (e.g., `Danbooru Grouping Tags`).
4.  **Expiration**: Choose "No expiration" (recommended) or your preferred duration.
5.  **Scopes**: Check only **`gist`** (Create gists). ✅
6.  Click **Generate token** and **copy the code** starting with `ghp_...`.
7.  In the script's settings (Cloud icon), paste this token when prompted.

## �🚀 Installation

1.  Install a UserScript manager like [Tampermonkey](https://www.tampermonkey.net/).
2.  Click the **[Install]** link below:
    -   **[Install groupingtags.user.js](https://github.com/AkaringoP/JavaScripts/raw/build/groupingtags.user.js)**

## 🛠️ Development

This project is built with modern web technologies:

- **Language**: TypeScript
- **Bundler**: Vite + [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey)
- **Testing**: Vitest
- **Style**: GTS (Google TypeScript Style)
- **CI/CD**: GitHub Actions

### Setup
```bash
npm install
```

### Build
```bash
npm run build
```

### Testing
```bash
npm run test
```

## 📜 License
MIT
