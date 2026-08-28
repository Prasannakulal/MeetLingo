# MeetLingo - Real-Time Meeting Translator

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-4885C2?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore/detail/meetl1ngo/plkkbgdfhmhmppddcjjbngljdpncpndk)
[![Microsoft Edge Add-ons](https://img.shields.io/badge/Microsoft%20Edge-0078D4?style=for-the-badge&logo=microsoft-edge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/meetl1ngo/mjnnljndnbpcdpnmkknhdfokpobpnbhh)

MeetLingo is an AI-powered Chrome extension that provides real-time, multilingual translation for Google Meet and Microsoft Teams. Break down language barriers with instant captions and translated subtitles appearing directly in your video conferencing interface.

## 🚀 Features

- **Real-Time Translation**: Watch live translated captions appear as participants speak
- **Dual Language Display**: See both original and translated text simultaneously
- **High Accuracy**: Powered by DeepL for industry-leading translation quality
- **Works in Both Modes**:
  - 🎙️ **Real-time captions** (for Live Captions)
  - 🌐 **Translated captions** (for Translate captions)
- **Clean UI**: Minimalist, non-intrusive overlay that doesn't block your view
- **Customizable Settings**:
  - Choose your target language
  - Adjust caption opacity and text size
  - Toggle dual-language display
  - Manage font settings
  - Dark mode support
- **Keyboard Shortcuts**:
  - Toggle overlay: `Ctrl + E` (Windows/Linux), `Cmd + E` (Mac)
  - Open settings: `Ctrl + Shift + ,` (Windows/Linux), `Cmd + Shift + ,` (Mac)
  - Toggle dark mode: `Ctrl + Alt + D` (Windows/Linux), `Cmd + Option + D` (Mac)
  - Reset settings: `Ctrl + Alt + R` (Windows/Linux), `Cmd + Option + R` (Mac)
- **Platform Support**:
  - Google Meet
  - Microsoft Teams (Desktop app)
- **Privacy-First**: Runs locally, no user data is collected

## 🛠️ Installation

### For Google Chrome

1. Open Chrome and navigate to [Chrome Web Store](https://chrome.google.com/webstore)
2. Search for "MeetLingo - Real-Time Meeting Translator"
3. Click "Add to Chrome"
4. Click "Add extension" to confirm

### For Microsoft Edge

1. Open Edge and navigate to [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons)
2. Search for "MeetLingo - Real-Time Meeting Translator"
3. Click "Get"
4. Click "Add extension" to confirm

### Manual Installation (Developer Mode)

1. Download or clone the repository
2. Open Chrome/Edge and navigate to `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked"
5. Select the `src` folder in the downloaded repository

## ⚙️ Usage

### Starting Translation

#### Google Meet

1. Join a Google Meet call
2. Turn on captions: Click the "CC" icon in the bottom-right controls
3. The extension will automatically detect captions and start translating
4. You'll see translated captions appear in the chat sidebar

#### Microsoft Teams

1. Join a Microsoft Teams meeting
2. Turn on live captions: Click the "More actions" (•••) button → "Turn on live captions"
3. The extension will automatically detect captions and start translating
4. You'll see translated captions appear in the chat sidebar

### Using the Extension

Once captions are enabled, MeetLingo works automatically:

- **Listen**: The extension listens for speech
- **Translate**: DeepL translates the text in real-time
- **Display**: Translated captions appear in the chat sidebar

### Keyboard Shortcuts

| Action | Windows/Linux | Mac | Purpose |
|--------|---------------|-----|---------|
| Toggle overlay | `Ctrl + E` | `Cmd + E` | Show/hide translated captions |
| Open settings | `Ctrl + Shift + ,` | `Cmd + Shift + ,` | Open settings modal |
| Toggle dark mode | `Ctrl + Alt + D` | `Cmd + Option + D` | Switch between light/dark themes |
| Reset settings | `Ctrl + Alt + R` | `Cmd + Option + R` | Restore default settings |

## 🔧 Settings

Click the extension icon in your browser toolbar to open the settings panel:

- **Target Language**: Select your preferred language (English, Hindi, Spanish, French, German)
- **Caption Size**: Adjust the font size for better readability
- **Caption Opacity**: Control the transparency of captions
- **Dual-Language Mode**: Toggle between showing only translated text or both original and translated text
- **Font Settings**: Customize font family and line height
- **Dark Mode**: Enable dark theme for low-light environments

## 📊 Translation Modes

MeetLingo supports two translation modes:

### 1. Real-Time Captions (Live Captions)
**Best for:** Live meetings, real-time understanding

- Translates spoken audio as it happens
- Lower latency, more conversational
- Ideal for following along during meetings

**How to enable:**
1. Open settings in extension
2. Under "Supported Platforms", click **"Google Meet: Open Live Captions Settings"**
3. This will open Google Meet's settings in a new tab
4. Select **"English"** as your caption language
5. Turn on Live Captions in the call

### 2. Translated Captions (Translate captions)
**Best for:** Pre-recorded video, archived content

- Translates text from videos with existing captions
- Slightly higher latency but better for stored content
- Works with both auto-generated and user-uploaded captions

**How to enable:**
1. Open settings in extension
2. Under "Supported Platforms", click **"Google Meet: Open Translate Captions Settings"**
3. This will open Google Meet's settings in a new tab
4. Select **"English"** as your caption language
5. Turn on Translate captions in the call

## 🏢 Supported Platforms

### Google Meet

- ✅ Live Captions
- ✅ Translate captions

### Microsoft Teams

- ✅ Live captions (desktop app only)

## 🧪 Development

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/prasannakulal/MeetLingo.git
   cd MeetLingo
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the build process:
   ```bash
   npm run build
   ```

### Development Mode

To run in development mode with hot-reload:

```bash
npm run dev
```

Then load the `src` folder as an unpacked extension in your browser.

## 📦 Building for Production

To create a production build:

```bash
npm run build
```

This will generate the extension files in the `dist` folder.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

##  🙏 Acknowledgments

- [DeepL](https://www.deepl.com/) - For high-quality language translation
- [Google Translate API](https://cloud.google.com/translate) - For translation services
- [Google Meet](https://meet.google.com/) - Video conferencing platform
- [Microsoft Teams](https://www.microsoft.com/en/microsoft-teams/) - Video conferencing platform

## 🔐 Security & API Keys

MeetLingo requires users to supply their own API keys (DeepL or Google Translate). Keys are stored locally in browser storage and **never sent anywhere except the official translation APIs**.

> ⚠️ Never share your API key publicly. See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

Made with ❤️ for language learners and multilingual teams everywhere.

