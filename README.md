# Hitomi and NHentai Extensions

Paperback 0.9 extensions for:

- [Hitomi](https://hitomi.la)
- [NHentai](https://nhentai.net)

## Install in Paperback

Open the [Paperback installation page](https://pisshammy.github.io/HammyExtensions)

Then tap **Add Repository to Paperback**.

Otherwise, add this repository's GitHub Pages URL in Paperback under **Settings → Extensions → Add Repository**:

```text
https://pisshammy.github.io/HammyExtensions
```

The repository is published automatically by GitHub Actions whenever `main` is updated.

## Support

Source problems are handled in the [**OTHER-REPOS**](https://discord.com/invite/inkdex) channel of the [**Inkdex Discord**](https://discord.com/invite/inkdex) server, where the HammyExtension support chat lives. (TBD)

Include the affected source, the page or title that failed, and screenshots or request details when possible, it makes fixes much faster.

## Development

Requirements: Node.js 20 or newer.

```bash
npm ci
npm run tsc
npm run bundle
npm test
```

The generated Paperback repository is written to `bundles/`. It is intentionally ignored by Git because GitHub Actions publishes it to GitHub Pages.

To run the local development server:

```bash
npm run dev
```

## Disclaimer

These extensions are independent projects and are not affiliated with Paperback, Hitomi, or NHentai. Site names and logos belong to their respective owners.

Looking for more Paperback repos? Find them at this compilation site (0.8 & 0.9): https://paperbackextensionrepo.xyz