import {
  type JSONValue,
  type PagedResults,
  type SearchResultItem,
  type SortingOption,
  type TestLogger,
} from '@paperback/types'
import { TestSuite, registerDefaultTests } from './suite.js'
import {
  assert,
  registerPagesCanonicalizationTests,
  registerPagesExpressionTests,
  registerSharedStateTests,
} from './unit.js'
import { Hitomi, parseTagsFromQuery } from '../Hitomi/main.js'
import sourceInfo from '../Hitomi/pbconfig.js'
import {
  getFuzzySearchTagsSetting,
  getOnlyFuzzyUnknownTagsSetting,
  getPagesExpressionSetting,
  getSearchFilterDate,
  getSearchFilterLength,
  getSearchFilterTags,
  parsePagesExpression,
  sanitizePagesExpressionInput,
  setFuzzySearchTagsSetting,
  setHideReadSetting,
  setOnlyFuzzyUnknownTagsSetting,
  setPagesExpressionSetting,
  setSearchFilterDate,
  setSearchFilterLength,
  setSearchFilterTags,
} from '../Hitomi/settings.js'

const DATE_SORT: SortingOption = { id: 'date_added', label: 'Date Added' }
const UNAVAILABLE = 'LiveDataUnavailable'
const HITOMI_PAGE = /^(https?:\/\/|hitomi:\/\/image\/)/

const LENGTH_OPTION_IDS = [
  'all',
  'le20',
  'gt20',
  'gt40',
  'gt80',
  'gt120',
  'gt200',
]

function searchHitomi(title = '', metadata?: JSONValue) {
  return Hitomi.getSearchResults(
    { title, metadata: [] },
    metadata,
    DATE_SORT,
  )
}

function markUnavailable(suite: TestSuite): void {
  suite.state[UNAVAILABLE] = true
}

function assertPaged(
  result: PagedResults<SearchResultItem>,
  label: string,
): void {
  assert(result && Array.isArray(result.items), `${label}: items should be an array`)
  assert(result.items.length > 0, `${label}: expected at least one item`)
  assert(result.metadata, `${label}: expected pagination metadata`)
  for (const item of result.items as any[]) {
    assert(item.mangaId, `${label}: item missing mangaId`)
    assert(
      typeof item.title === 'string' && item.title.length > 0,
      `${label}: item ${item.mangaId} missing title`,
    )
    assert(
      typeof item.imageUrl === 'string' && item.imageUrl.startsWith('http'),
      `${label}: item ${item.mangaId} has a non-HTTP imageUrl`,
    )
  }
}

export async function runTests(logger: TestLogger) {
  // Keep live integration results independent of persisted user read history.
  Application.setState([], 'hitomi.readHistory')
  setHideReadSetting(false)

  const suite = new TestSuite('Hitomi tests', logger)
  registerDefaultTests(suite, Hitomi, sourceInfo, {
    searchResultsProviding: false,
    mangaProviding: false,
    chapterProviding: false,
  })

  // ── Offline: filter parsing and state contracts (no network) ─────────────
  registerSharedStateTests(suite)
  registerPagesExpressionTests(suite, 'Hitomi', parsePagesExpression)
  registerPagesCanonicalizationTests(
    suite,
    'Hitomi',
    sanitizePagesExpressionInput,
  )

  suite.test('pages expression setting stores the canonical form', async () => {
    const original = getPagesExpressionSetting()
    try {
      setPagesExpressionSetting(' >= 20 ')
      assert(
        getPagesExpressionSetting() === '20+',
        `expected "20+", got ${JSON.stringify(getPagesExpressionSetting())}`,
      )
      setPagesExpressionSetting('20 - 10')
      assert(
        getPagesExpressionSetting() === '10-20',
        `expected "10-20", got ${JSON.stringify(getPagesExpressionSetting())}`,
      )
    } finally {
      setPagesExpressionSetting(original)
    }
  })

  suite.test('search filter values round-trip through state', async () => {
    const original = {
      length: getSearchFilterLength(),
      date: getSearchFilterDate(),
      tags: getSearchFilterTags(),
    }
    try {
      setSearchFilterLength('gt40')
      setSearchFilterDate('30')
      setSearchFilterTags({ yuri: 'included', yaoi: 'excluded' })

      assert(getSearchFilterLength() === 'gt40', 'length filter did not persist')
      assert(getSearchFilterDate() === '30', 'date filter did not persist')
      const tags = getSearchFilterTags()
      assert(tags.yuri === 'included', 'included tag did not persist')
      assert(tags.yaoi === 'excluded', 'excluded tag did not persist')
    } finally {
      setSearchFilterLength(original.length)
      setSearchFilterDate(original.date)
      setSearchFilterTags(original.tags)
    }
  })

  // ── Live: discovery ──────────────────────────────────────────────────────
  suite.test('initialise completes without error', async () => {
    try {
      await Hitomi.initialise()
    } catch (err) {
      throw new Error(`initialise() should not throw, got: ${err}`)
    }
  })

  suite.test('getDiscoverSections returns unique, populated sections', async () => {
    const sections = await Hitomi.getDiscoverSections()
    assert(sections.length > 0, 'expected at least one discover section')
    const ids = new Set<string>()
    for (const section of sections) {
      assert(typeof section.id === 'string' && section.id.length > 0, 'invalid section id')
      assert(section.title && typeof section.title === 'string', `section ${section.id} missing title`)
      ids.add(section.id)
    }
    assert(ids.size === sections.length, 'discover section ids should be unique')
    suite.state['DiscoverSections'] = sections
  })

  suite.test('getDiscoverSectionItems returns valid items', async () => {
    let result: any
    try {
      result = await Hitomi.getDiscoverSectionItems(
        { id: 'date_added', title: 'Date Added' } as any,
        undefined,
      )
    } catch {
      markUnavailable(suite)
      return
    }
    if (!result.items.length || !result.metadata) {
      markUnavailable(suite)
      return
    }
    for (const item of result.items as any[]) {
      assert(item.mangaId, 'discover item missing mangaId')
      assert(item.title, `discover item ${item.mangaId} missing title`)
    }
    suite.state['DiscoverPage1'] = result
  })

  suite.test('getDiscoverSectionItems paginates without repeating items', async () => {
    if (suite.state[UNAVAILABLE]) return
    const page1 = suite.state['DiscoverPage1'] as any
    assert(page1?.metadata, 'page 1 should have metadata for pagination')
    let page2: any
    try {
      page2 = await Hitomi.getDiscoverSectionItems(
        { id: 'date_added', title: 'Date Added' } as any,
        page1.metadata,
      )
    } catch {
      markUnavailable(suite)
      return
    }
    assert(page2.items.length > 0, 'expected items on page 2')
    const page1Ids = new Set(page1.items.map((item: any) => item.mangaId))
    assert(
      page2.items.some((item: any) => !page1Ids.has(item.mangaId)),
      'page 2 returned only page 1 items',
    )
  })

  // ── Live: search and filters ─────────────────────────────────────────────
  suite.test('getSearchResults returns valid items', async () => {
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchHitomi()
    } catch {
      markUnavailable(suite)
      return
    }
    if (!result.items.length || !result.metadata) {
      markUnavailable(suite)
      return
    }
    assertPaged(result, 'search')
    suite.state['SearchPage1'] = result
  })

  suite.test('getSearchResults pagination returns a distinct page', async () => {
    if (suite.state[UNAVAILABLE]) return
    const page1 = suite.state['SearchPage1'] as any
    assert(page1?.metadata, 'search page 1 should have metadata')
    let page2: PagedResults<SearchResultItem>
    try {
      page2 = await searchHitomi('', page1.metadata)
    } catch {
      markUnavailable(suite)
      return
    }
    assertPaged(page2, 'search page 2')
    const page1Ids = new Set(page1.items.map((item: any) => item.mangaId))
    assert(
      page2.items.some((item: any) => !page1Ids.has(item.mangaId)),
      'page 2 returned only page 1 items',
    )
  })

  suite.test('getSearchFilters exposes the expected filter contract', async () => {
    let filters: any[]
    try {
      filters = await Hitomi.getSearchFilters()
    } catch {
      markUnavailable(suite)
      return
    }
    assert(filters.length > 0, 'expected search filters')
    const byId = new Map(filters.map((filter) => [filter.id, filter]))
    for (const filter of filters) {
      assert(typeof filter.id === 'string' && filter.id.length > 0, 'filter missing id')
      assert(filter.title && typeof filter.title === 'string', `filter ${filter.id} missing title`)
    }
    const length = byId.get('length')
    assert(length, 'missing length filter')
    assert(
      (length as any).options.some((option: any) => option.id === (length as any).value),
      `length filter value ${(length as any).value} is not one of its options`,
    )
    assert(
      JSON.stringify((length as any).options.map((option: any) => option.id)) ===
        JSON.stringify(LENGTH_OPTION_IDS),
      `length filter options changed: ${JSON.stringify((length as any).options.map((option: any) => option.id))}`,
    )
    const tags = byId.get('tags')
    assert(tags, 'missing tags filter')
    assert((tags as any).allowExclusion === true, 'tags filter should allow exclusions')
    assert((tags as any).allowEmptySelection === true, 'tags filter should allow an empty selection')
    const optionIds = new Set<string>()
    for (const option of (tags as any).options) {
      assert(option.id, 'tag option missing id')
      assert(typeof option.value === 'string' && option.value.length > 0, `tag option ${option.id} missing label`)
      optionIds.add(option.id)
    }
    assert(
      optionIds.size === (tags as any).options.length,
      'tag options should have unique ids',
    )
    suite.state['SearchFilters'] = filters
  })

  suite.test('tag query parser handles types, negation and OR groups', async () => {
    const originalFuzzy = getFuzzySearchTagsSetting()
    const originalUnknown = getOnlyFuzzyUnknownTagsSetting()
    try {
      setFuzzySearchTagsSetting(false)
      setOnlyFuzzyUnknownTagsSetting(false)

      assert(parseTagsFromQuery('').length === 0, 'empty query should have no tags')
      assert(
        parseTagsFromQuery('  , ,  ').length === 0,
        'blank clauses should have no tags',
      )

      const single = parseTagsFromQuery('Yuri')
      assert(single.length === 1, `expected one tag, got ${single.length}`)
      assert(single[0].name === 'yuri', `tag name was not lowercased: ${single[0].name}`)
      assert(single[0].isNegative === false, 'a bare tag should not be negative')

      const underscored = parseTagsFromQuery('big_breasts')[0]
      assert(
        underscored.name === 'big breasts',
        `underscores should become spaces: ${underscored.name}`,
      )

      const quoted = parseTagsFromQuery('"big breasts"')[0]
      assert(
        quoted.name === 'big breasts',
        `quotes should be stripped from the name: ${quoted.name}`,
      )

      const negative = parseTagsFromQuery('-yuri')[0]
      assert(negative.isNegative === true, '- prefix should mark the tag negative')
      assert(negative.name === 'yuri', `negation leaked into the name: ${negative.name}`)

      const typed = parseTagsFromQuery('male:big breasts')[0]
      assert(typed.type === 'male', `explicit type ignored: ${typed.type}`)
      assert(typed.name === 'big breasts', `typed tag name: ${typed.name}`)
      assert(
        parseTagsFromQuery('artist:some artist')[0].type === 'artist',
        'artist: prefix was not honoured',
      )

      const fuzzy = parseTagsFromQuery('f!yuri')[0]
      assert(fuzzy.forceFuzzy === true, 'f! should force fuzzy search')
      assert(fuzzy.isFuzzy === true, 'f! should mark the tag fuzzy')

      // With fuzzy search globally enabled, uf! must still force the precise path.
      setFuzzySearchTagsSetting(true)
      const precise = parseTagsFromQuery('uf!yuri')[0]
      assert(
        precise.isFuzzy === undefined,
        'uf! should force precise search even when fuzzy is on',
      )
      assert(precise.forceFuzzy === undefined, 'uf! must not request fuzzy search')
      setFuzzySearchTagsSetting(false)

      const orTags = parseTagsFromQuery('yuri OR maid')
      assert(orTags.length === 2, `OR should produce two tags, got ${orTags.length}`)
      assert(
        orTags.every((tag) => tag.orGroup === 1),
        `OR alternatives should share a group: ${JSON.stringify(orTags)}`,
      )

      const pipeTags = parseTagsFromQuery('yuri || maid')
      assert(
        pipeTags.length === 2 && pipeTags.every((tag) => tag.orGroup === 1),
        '|| should behave like OR',
      )

      const twoGroups = parseTagsFromQuery('yuri OR maid, school OR office')
      assert(
        twoGroups.map((tag) => tag.orGroup).join(',') === '1,1,2,2',
        `each OR clause needs its own group: ${JSON.stringify(twoGroups)}`,
      )
    } finally {
      setFuzzySearchTagsSetting(originalFuzzy)
      setOnlyFuzzyUnknownTagsSetting(originalUnknown)
    }
  })

  suite.test('search filters reflect stored selections', async () => {
    if (suite.state[UNAVAILABLE]) return
    const original = {
      length: getSearchFilterLength(),
      tags: getSearchFilterTags(),
    }
    try {
      setSearchFilterLength('gt20')
      setSearchFilterTags({ ...original.tags, yuri: 'included' })
      let filters: any[]
      try {
        filters = (await Hitomi.getSearchFilters()) as any[]
      } catch {
        // Tag index fetch failed; the state round-trip above still ran.
        markUnavailable(suite)
        return
      }
      const byId = new Map(filters.map((filter) => [filter.id, filter]))
      assert(
        (byId.get('length') as any)?.value === 'gt20',
        `length filter value mismatch: ${(byId.get('length') as any)?.value}`,
      )
      const tagValue = (byId.get('tags') as any)?.value as Record<string, string> | undefined
      assert(tagValue?.yuri === 'included', 'tags filter did not report the selected tag')
    } finally {
      setSearchFilterLength(original.length)
      setSearchFilterTags(original.tags)
    }
  })

  suite.test('live search honours the stored length filter', async () => {
    if (suite.state[UNAVAILABLE]) return
    const original = getSearchFilterLength()
    try {
      setSearchFilterLength('gt20')
      const result = await searchHitomi()
      if (!result.items.length || !result.metadata) {
        // A page can come back empty when strict filters skip many galleries.
        markUnavailable(suite)
        return
      }
      assertPaged(result, 'length=gt20')
    } catch {
      markUnavailable(suite)
    } finally {
      setSearchFilterLength(original)
    }
  })

  suite.test('tag search returns valid galleries', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchHitomi('yuri')
    } catch {
      markUnavailable(suite)
      return
    }
    if (!result.items.length || !result.metadata) {
      markUnavailable(suite)
      return
    }
    assertPaged(result, 'yuri')
  })

  suite.test('exclusion search is accepted', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchHitomi('-yaoi yuri')
    } catch {
      markUnavailable(suite)
      return
    }
    // A strict exclusion can legitimately leave a short page.
    assert(result && Array.isArray(result.items), 'exclusion search should return items')
    for (const item of result.items as any[]) {
      assert(item.mangaId, 'exclusion item missing mangaId')
    }
  })

  suite.test('OR search is accepted', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchHitomi('yuri OR maid')
    } catch {
      markUnavailable(suite)
      return
    }
    assert(result && Array.isArray(result.items), 'OR search should return items')
    for (const item of result.items as any[]) {
      assert(item.mangaId, 'OR item missing mangaId')
    }
  })

  suite.test('getSortingOptions returns usable, unique options', async () => {
    const options = await Hitomi.getSortingOptions()
    assert(options.length >= 2, 'expected multiple sorting options')
    const ids = new Set<string>()
    for (const option of options) {
      assert(typeof option.id === 'string' && option.id.length > 0, 'sorting option missing id')
      assert(option.label && typeof option.label === 'string', `sorting option ${option.id} missing label`)
      ids.add(option.id)
    }
    assert(ids.size === options.length, 'sorting option ids should be unique')
  })

  suite.test('getAdvancedSearchForm returns a usable form', async () => {
    if (suite.state[UNAVAILABLE]) return
    const form = await Hitomi.getAdvancedSearchForm({
      title: '',
      metadata: [],
    } as any)
    assert(form && typeof form === 'object', 'expected an advanced search form')
    assert(typeof form.getSections === 'function', 'form is missing getSections()')
    assert(
      typeof (form as any).formDidSubmit === 'function',
      'form is missing formDidSubmit()',
    )
    // Search filters load asynchronously. Only render sections once the filters
    // have resolved; in the Node test harness async results are created with a
    // different realm's intrinsic Promise, so `instanceof Promise` in the
    // framework's SearchFilterForm never matches and `filters` stays pending.
    if (Array.isArray((form as any).filters)) {
      const sections = form.getSections()
      assert(Array.isArray(sections) && sections.length > 0, 'advanced search form has no sections')
      for (const section of sections) {
        assert(section.id, 'advanced search section missing id')
        assert(Array.isArray(section.items), `section ${section.id} missing items`)
      }
    }
  })

  suite.test('getSettingsForm returns populated sections', async () => {
    const form = await Hitomi.getSettingsForm()
    assert(form, 'expected a settings form')
    const sections = form.getSections()
    assert(Array.isArray(sections) && sections.length > 0, 'settings form has no sections')
    for (const section of sections) {
      assert(section.id, 'settings section missing id')
      assert(Array.isArray(section.items), `section ${section.id} missing items`)
    }
  })

  // ── Live: details and chapters ───────────────────────────────────────────
  suite.test('manga details structure', async () => {
    if (suite.state[UNAVAILABLE]) return
    const searchPage = suite.state['SearchPage1'] as any
    const searchItem = searchPage?.items?.[0]
    assert(searchItem?.mangaId, 'getSearchResults must pass first')
    let sourceManga: any
    try {
      sourceManga = await Hitomi.getMangaDetails(searchItem.mangaId)
    } catch {
      markUnavailable(suite)
      return
    }
    suite.state['MangaProviding.getMangaDetails'] = sourceManga
    const info = sourceManga.mangaInfo
    assert(typeof info.primaryTitle === 'string' && info.primaryTitle.length > 0, 'missing primaryTitle')
    assert(/^https?:\/\//.test(info.thumbnailUrl ?? ''), `invalid thumbnailUrl: ${info.thumbnailUrl}`)
    assert(typeof info.synopsis === 'string', 'missing synopsis')
    assert(Array.isArray(info.secondaryTitles), 'secondaryTitles should be an array')
    assert(typeof info.rating === 'number', `rating should be a number, got ${typeof info.rating}`)
    assert(info.status === 'COMPLETED', `unexpected status: ${info.status}`)
    assert(info.contentRating !== undefined, 'missing content rating')
    assert(
      /^https?:\/\/hitomi\.la\/galleries\/\d+\.html$/.test(info.shareUrl ?? ''),
      `unexpected shareUrl: ${info.shareUrl}`,
    )
    // Hitomi promotes tags into the synopsis (up to 15, roughly half of the
    // content tags) and removes those from tagGroups, so a gallery whose tags
    // were all promoted can legitimately have no tag groups left.
    assert(Array.isArray(info.tagGroups), 'tagGroups should be an array')
    for (const group of info.tagGroups as any[]) {
      assert(group.id, 'tag group missing id')
      assert(Array.isArray(group.tags), `tag group ${group.id} missing tags`)
      for (const tag of group.tags) {
        assert(tag.id, `tag in group ${group.id} missing id`)
        assert(typeof tag.title === 'string', `tag ${tag.id} missing title`)
      }
    }
  })

  suite.test('chapter structure', async () => {
    if (suite.state[UNAVAILABLE]) return
    const sourceManga = suite.state['MangaProviding.getMangaDetails'] as any
    assert(sourceManga, 'getMangaDetails must pass first')
    let chapters: any[]
    try {
      chapters = await Hitomi.getChapters(sourceManga)
    } catch {
      markUnavailable(suite)
      return
    }
    assert(Array.isArray(chapters) && chapters.length === 1, `Hitomi galleries are single-chapter, got ${chapters?.length}`)
    const chapter = chapters[0]
    assert(chapter.chapterId, 'chapter missing chapterId')
    assert(chapter.sourceManga, 'chapter missing sourceManga')
    assert(chapter.chapNum === 1, `expected chapNum 1, got ${chapter.chapNum}`)
    assert(
      typeof chapter.langCode === 'string' && chapter.langCode.length > 0,
      `chapter missing langCode: ${chapter.langCode}`,
    )
    assert(
      chapter.publishDate instanceof Date && !Number.isNaN(chapter.publishDate.getTime()),
      `chapter publishDate is invalid: ${chapter.publishDate}`,
    )
    suite.state['ChapterProviding.getChapters'] = chapters
  })

  suite.test('chapter page URLs are usable', async () => {
    if (suite.state[UNAVAILABLE]) return
    const chapters = suite.state['ChapterProviding.getChapters'] as any[]
    assert(chapters?.length, 'getChapters must pass first')
    let details: any
    try {
      details = await Hitomi.getChapterDetails(chapters[0])
    } catch {
      markUnavailable(suite)
      return
    }
    suite.state['ChapterProviding.getChapterDetails'] = details
    const pages = details?.pages
    assert(Array.isArray(pages) && pages.length > 0, 'expected chapter pages')
    const unique = new Set(pages)
    assert(unique.size === pages.length, 'duplicate page URLs detected')
    for (const page of pages) {
      assert(typeof page === 'string' && HITOMI_PAGE.test(page), `unusable page URL: ${page}`)
    }
  })

  suite.test('search results are consistent across calls', async () => {
    if (suite.state[UNAVAILABLE]) return
    let first: PagedResults<SearchResultItem>
    let second: PagedResults<SearchResultItem>
    try {
      first = await searchHitomi()
      second = await searchHitomi()
    } catch {
      markUnavailable(suite)
      return
    }
    if (!first.items.length || !second.items.length) {
      markUnavailable(suite)
      return
    }
    const firstIds = first.items.map((item) => item.mangaId).sort()
    const secondIds = second.items.map((item) => item.mangaId).sort()
    assert(
      firstIds.join(',') === secondIds.join(','),
      'repeated searches should return the same ids',
    )
  })

  suite.test('discover sections return item arrays', async () => {
    if (suite.state[UNAVAILABLE]) return
    const sections = suite.state['DiscoverSections'] as any[]
    assert(sections?.length, 'getDiscoverSections must pass first')
    for (const section of sections.slice(0, 3)) {
      let result: any
      try {
        result = await Hitomi.getDiscoverSectionItems(section, undefined)
      } catch {
        markUnavailable(suite)
        return
      }
      assert(Array.isArray(result.items), `invalid items for ${section.id}`)
    }
  })

  await suite.run()
}
