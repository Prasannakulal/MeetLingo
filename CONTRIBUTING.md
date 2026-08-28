# Contributing to MeetLingo

Thank you for your interest in contributing! 🎉

## How to Contribute

### Reporting Bugs
1. Check [existing issues](../../issues) to avoid duplicates
2. Open a new issue with a clear title and description
3. Include browser version, OS, and steps to reproduce

### Suggesting Features
1. Open an issue with the **[Feature Request]** tag
2. Describe the problem it solves and your proposed solution

### Submitting Code

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/your-username/MeetLingo.git
   cd MeetLingo
   ```
3. **Create a branch** for your change:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** and test them manually (see README for dev setup)
5. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add support for French language"
   ```
6. **Push** your branch and **open a Pull Request**

## Commit Message Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `docs:` | Documentation only |
| `style:` | Formatting, no logic change |
| `refactor:` | Code restructure, no behaviour change |
| `chore:` | Build tasks, dependencies |

## Development Setup

1. Load the extension unpacked from the project root in `chrome://extensions`
2. No build step needed for development
3. Reload the extension after any change

## Code Style

- Use vanilla JS (no frameworks in content scripts)
- Keep content scripts lean — heavy logic belongs in the background service worker
- Document any new message types in code comments

## API Keys

> ⚠️ **Never commit real API keys.** Users supply their own DeepL/Google Translate keys through the extension popup. Test with your own key locally.

## Need Help?

Open an issue or start a [Discussion](../../discussions).
