# Contributing to Vaultend

Thank you for your interest in contributing to Vaultend! This guide covers the main ways you can help.

---

## Translations (i18n)

The easiest way to contribute. No deep code knowledge required.

### How to add a new language

1. Fork this repository
2. Copy `src/i18n/locales/en.ts` to `src/i18n/locales/{lang}.ts` (e.g., `ja.ts`, `zh.ts`, `de.ts`)
3. Translate all string values (keep the keys unchanged)
4. Open `src/i18n/index.ts` and:
   - Add `import {lang} from './locales/{lang}';`
   - Add `'{lang}'` to the `SupportedLocale` type
   - Add `{lang}` to the `locales` record
   - Update `detectObsidianLocale()` to detect the new locale
5. Open `src/ui/PluginSettingTab.ts` and add the new language to the locale dropdown
6. Submit a PR

### Translation tips

- The `{{variable}}` placeholders must remain as-is (e.g., `{{count}}`, `{{error}}`)
- Test your translation by building the plugin (`npm run build`) and loading it in Obsidian
- If a string doesn't have a natural translation, keep the English term (e.g., "Quick Ask")

### Currently supported languages

| Language | Code | Status |
|----------|------|--------|
| English | `en` | Complete |
| Korean | `ko` | Complete |

---

## Bug Reports

Open an [issue](https://github.com/dhwang0803-glitch/Vaultend/issues) with:

- Obsidian version and platform (Windows/macOS/Linux/iOS/Android)
- Vaultend version (Settings > Community Plugins > Vaultend)
- Steps to reproduce
- Expected vs actual behavior
- Console errors if any (`Ctrl+Shift+I` > Console tab)

---

## Feature Requests

Open an [issue](https://github.com/dhwang0803-glitch/Vaultend/issues) with the "enhancement" label. Describe the use case, not just the solution.

---

## Pull Requests

### Setup

```bash
git clone https://github.com/dhwang0803-glitch/Vaultend.git
cd Vaultend
npm install
npm run dev    # Watch mode for development
```

### Before submitting

- `npm run build` passes without errors
- `npm run lint` passes without warnings
- `npm run test` passes all tests
- Test the change in Obsidian (desktop and/or mobile)

### Branch strategy

- Create feature branches from `development` (not `main`)
- PR target: `development`
- `main` is the stable release branch

### Code style

- TypeScript with strict type checking
- Clean Architecture: dependencies point inward (domain < application < adapters < ui)
- Follow existing patterns in the codebase

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
