/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Hitomi",
  description: "Extension that pulls content from hitomi.la",
  version: "1.6.9",
  icon: "icon.png",
  language: "multi",
  contentRating: ContentRating.ADULT,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "pisshammy",
      website: "cashapp: $0hammy0",
    },
  ],
} satisfies ExtensionInfo;
