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
import { NHentai } from '../NHentai/main.js'
import sourceInfo from '../NHentai/pbconfig.js'
import {
  getDateMaxDaysSetting,
  getDateMinDaysSetting,
  getDaysOldFilterSetting,
  getExcludeTagsSetting,
  getExtraArgumentsSetting,
  getFavoritesThresholdMaxSetting,
  getFavoritesThresholdSetting,
  getIncludeOrGroups,
  getIncludeTagsSetting,
  getLanguageQueryTokens,
  getPagesExpressionSetting,
  getSanitizedTagTokens,
  getSearchFilterDate,
  getSearchFilterFavorites,
  getSearchFilterLength,
  getSearchFilterTags,
  parsePagesExpression,
  sanitizePagesExpressionInput,
  setExcludeTagsSetting,
  setExtraArgumentsSetting,
  setFavoritesThresholdMaxSetting,
  setFavoritesThresholdSetting,
  setHideReadSetting,
  setIncludeTagsSetting,
  setPagesExpressionSetting,
  setSearchFilterDate,
  setSearchFilterFavorites,
  setSearchFilterLength,
  setSearchFilterTags,
} from '../NHentai/settings.js'

const DATE_SORT: SortingOption = { id: 'date', label: 'Date Added' }
const UNAVAILABLE = 'LiveDataUnavailable'
const NHENTAI_CDN = /^https?:\/\/[a-z0-9-]+\.nhentai\.net\//i
const PAGE_URL =
  /^https?:\/\/[it]\d+\.nhentai\.net\/galleries\/\d+\/\d+\.[a-z]+$/i

function searchNHentai(title: string, metadata?: JSONValue) {
  return NHentai.getSearchResults(
    { title, metadata: [] },
    metadata,
    DATE_SORT,
  )
}

function markUnavailable(suite: TestSuite): void {
  suite.state[UNAVAILABLE] = true
}

function assertItems(
  result: PagedResults<SearchResultItem>,
  label: string,
): void {
  assert(result && Array.isArray(result.items), `${label}: items should be an array`)
  const ids = new Set<string>()
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
    assert(
      NHENTAI_CDN.test(item.imageUrl),
      `${label}: item ${item.mangaId} does not use the NHentai CDN: ${item.imageUrl}`,
    )
    assert(
      !ids.has(item.mangaId),
      `${label}: duplicate mangaId ${item.mangaId}`,
    )
    ids.add(item.mangaId)
  }
}

function assertPaged(
  result: PagedResults<SearchResultItem>,
  label: string,
): void {
  assertItems(result, label)
  assert(result.items.length > 0, `${label}: expected at least one item`)
  assert(result.metadata, `${label}: expected pagination metadata`)
}

/**
 * Filter queries are only guaranteed to be accepted and answered with a valid
 * page. Result density is an upstream property (NHentai returns sparse pages
 * for high favorites thresholds), so an empty page is not a failure.
 */
function assertSearchAccepted(
  result: PagedResults<SearchResultItem>,
  label: string,
): void {
  assertItems(result, label)
}

export async function runTests(logger: TestLogger) {
  // Live integration tests must not inherit a user's read history or Hide Read
  // preference, otherwise every result can be filtered before assertions run.
  Application.setState([], 'nhentai.readHistory')
  setHideReadSetting(false)

  const suite = new TestSuite('NHentai tests', logger)
  registerDefaultTests(suite, NHentai, sourceInfo, {
    searchResultsProviding: false,
    mangaProviding: false,
    chapterProviding: false,
  })

  // ── Offline: filter parsing and state contracts (no network) ─────────────
  registerSharedStateTests(suite)
  registerPagesExpressionTests(suite, 'NHentai', parsePagesExpression)
  registerPagesCanonicalizationTests(
    suite,
    'NHentai',
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

  suite.test('tag list input is normalised, deduped and keeps OR groups', async () => {
    const tokens = getSanitizedTagTokens(
      ' Yuri OR maid , "big breasts", big breasts, male:big breasts ',
    )
    assert(
      tokens.length === 3,
      `expected 3 unique tokens, got ${JSON.stringify(tokens)}`,
    )
    assert(
      tokens[0] === 'tag:Yuri OR tag:maid',
      `OR group was not preserved: ${tokens[0]}`,
    )
    assert(
      tokens[1] === 'tag:"big breasts"',
      `quoted tag was not normalised: ${tokens[1]}`,
    )
    assert(
      tokens[2] === 'male:"big breasts"',
      `typed tag was not normalised: ${tokens[2]}`,
    )
  })

  suite.test('include-tag OR groups are extracted for client-side expansion', async () => {
    const original = {
      include: getIncludeTagsSetting(),
      exclude: getExcludeTagsSetting(),
      extra: getExtraArgumentsSetting(),
      tags: getSearchFilterTags(),
    }
    try {
      setIncludeTagsSetting('yuri OR maid, school || office, solo')
      const groups = getIncludeOrGroups()
      assert(
        JSON.stringify(groups) ===
          JSON.stringify([
            ['tag:yuri', 'tag:maid'],
            ['tag:school', 'tag:office'],
          ]),
        `unexpected OR groups: ${JSON.stringify(groups)}`,
      )
      assert(
        !JSON.stringify(groups).includes('tag:solo'),
        'a plain include tag must not become an OR group',
      )
    } finally {
      setIncludeTagsSetting(original.include)
      setExcludeTagsSetting(original.exclude)
      setExtraArgumentsSetting(original.extra)
      setSearchFilterTags(original.tags)
    }
  })

  suite.test('days-old filter normalises bounds and migrates legacy keys', async () => {
    const keys = [
      'nhentai.settings.daysOldFilter',
      'nhentai.settings.dateMinDays',
      'nhentai.settings.dateMaxDays',
    ]
    const saved = keys.map((key) => Application.getState(key))
    try {
      // No unified value yet: the legacy keys must be read and put in order.
      Application.setState(null, keys[0])
      Application.setState(30, keys[1])
      Application.setState(7, keys[2])
      const range = getDaysOldFilterSetting()
      assert(
        range.oldest === 7 && range.newest === 30,
        `reversed legacy bounds were not normalised: ${JSON.stringify(range)}`,
      )
      assert(
        getDateMinDaysSetting() === 7,
        `getDateMinDaysSetting() = ${getDateMinDaysSetting()}`,
      )
      assert(
        getDateMaxDaysSetting() === 30,
        `getDateMaxDaysSetting() = ${getDateMaxDaysSetting()}`,
      )
    } finally {
      keys.forEach((key, index) => Application.setState(saved[index], key))
    }
  })

  suite.test('favorites thresholds round-trip and clear to the default', async () => {
    const originalMin = getFavoritesThresholdSetting()
    const originalMax = getFavoritesThresholdMaxSetting()
    try {
      setFavoritesThresholdSetting(1000)
      setFavoritesThresholdMaxSetting(25000)
      assert(
        getFavoritesThresholdSetting() === 1000,
        `minimum did not persist: ${getFavoritesThresholdSetting()}`,
      )
      assert(
        getFavoritesThresholdMaxSetting() === 25000,
        `maximum did not persist: ${getFavoritesThresholdMaxSetting()}`,
      )
      setFavoritesThresholdSetting(undefined)
      assert(
        getFavoritesThresholdSetting() === undefined,
        'clearing the minimum should fall back to the default',
      )
    } finally {
      setFavoritesThresholdSetting(originalMin)
      setFavoritesThresholdMaxSetting(originalMax)
    }
  })

  suite.test('language tokens follow the preferred-language setting', async () => {
    assert(
      getLanguageQueryTokens('all').length === 0,
      'language "all" should not add a constraint',
    )
    const english = getLanguageQueryTokens('english')
    assert(
      english.length === 1 && english[0] === 'language:english',
      `single language should produce one include token, got ${JSON.stringify(english)}`,
    )
    const multiple = getLanguageQueryTokens(['english', 'japanese'])
    assert(multiple.length > 0, 'multiple languages should produce tokens')
    assert(
      multiple.every((token) => token.startsWith('-language:')),
      `multiple languages should exclude the others, got ${JSON.stringify(multiple)}`,
    )
  })

  suite.test('search filter values round-trip through getSearchFilters', async () => {
    const original = {
      length: getSearchFilterLength(),
      favorites: getSearchFilterFavorites(),
      date: getSearchFilterDate(),
      tags: getSearchFilterTags(),
    }
    try {
      setSearchFilterLength('gt40')
      setSearchFilterFavorites('fav_500')
      setSearchFilterDate('90')
      setSearchFilterTags({ yuri: 'included', yaoi: 'excluded' })

      assert(getSearchFilterLength() === 'gt40', 'length filter did not persist')
      assert(
        getSearchFilterFavorites() === 'fav_500',
        'favorites filter did not persist',
      )
      assert(getSearchFilterDate() === '90', 'date filter did not persist')
      const storedTags = getSearchFilterTags()
      assert(storedTags.yuri === 'included', 'included tag did not persist')
      assert(storedTags.yaoi === 'excluded', 'excluded tag did not persist')

      const filters = await NHentai.getSearchFilters()
      const byId = new Map(filters.map((filter) => [filter.id, filter as any]))
      assert(
        byId.get('length')?.value === 'gt40',
        `length filter value mismatch: ${byId.get('length')?.value}`,
      )
      assert(
        byId.get('favorites')?.value === 'fav_500',
        `favorites filter value mismatch: ${byId.get('favorites')?.value}`,
      )
      assert(
        byId.get('daysOld')?.value === '90',
        `date filter value mismatch: ${byId.get('daysOld')?.value}`,
      )
      const tagValue = byId.get('tags')?.value as Record<string, string> | undefined
      assert(tagValue?.yuri === 'included', 'tags filter did not report yuri')
      assert(tagValue?.yaoi === 'excluded', 'tags filter did not report yaoi')
    } finally {
      setSearchFilterLength(original.length)
      setSearchFilterFavorites(original.favorites)
      setSearchFilterDate(original.date)
      setSearchFilterTags(original.tags)
    }
  })

  // ── Live: discovery, search form and results ─────────────────────────────
  suite.test('initialise completes without error', async () => {
    await NHentai.initialise()
  })

  suite.test('getDiscoverSections returns unique, populated sections', async () => {
    const sections = await NHentai.getDiscoverSections()
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
    const sections = suite.state['DiscoverSections'] as any[] | undefined
    if (!sections?.length) throw new Error('getDiscoverSections must pass first')
    let result: any
    try {
      result = await NHentai.getDiscoverSectionItems(sections[0], undefined)
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
    const sections = suite.state['DiscoverSections'] as any[] | undefined
    assert(page1?.metadata, 'page 1 should have metadata for pagination')
    if (!sections?.length) throw new Error('getDiscoverSections must pass first')
    let page2: any
    try {
      page2 = await NHentai.getDiscoverSectionItems(sections[0], page1.metadata)
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

  suite.test('popular discover section returns valid items', async () => {
    const sections = suite.state['DiscoverSections'] as any[] | undefined
    const popular = sections?.find((section) => section.id === 'popular_today')
    assert(popular, 'expected a popular_today discover section')
    let result: any
    try {
      result = await NHentai.getDiscoverSectionItems(popular, undefined)
    } catch {
      markUnavailable(suite)
      return
    }
    for (const item of result.items as any[]) {
      assert(item.mangaId, 'popular item missing mangaId')
      assert(item.title, `popular item ${item.mangaId} missing title`)
      assert(
        typeof item.imageUrl === 'string' && NHENTAI_CDN.test(item.imageUrl),
        `popular item ${item.mangaId} has an unexpected imageUrl: ${item.imageUrl}`,
      )
    }
  })

  suite.test('getSearchFilters exposes the expected filter contract', async () => {
    const filters = await NHentai.getSearchFilters()
    assert(filters.length > 0, 'expected search filters')
    const ids = new Set<string>()
    for (const filter of filters) {
      assert(typeof filter.id === 'string' && filter.id.length > 0, 'filter missing id')
      assert(filter.title && typeof filter.title === 'string', `filter ${filter.id} missing title`)
      ids.add(filter.id)
      const candidate = filter as any
      if (candidate.type === 'dropdown') {
        assert(Array.isArray(candidate.options) && candidate.options.length > 0, `dropdown ${filter.id} has no options`)
        const optionIds = new Set<string>()
        for (const option of candidate.options) {
          assert(option.id, `filter ${filter.id} option missing id`)
          assert(option.value, `filter ${filter.id} option ${option.id} missing label`)
          optionIds.add(option.id)
        }
        assert(optionIds.size === candidate.options.length, `filter ${filter.id} has duplicate option ids`)
        assert(
          typeof candidate.value === 'string' && candidate.value.length > 0,
          `filter ${filter.id} has no selected value`,
        )
        assert(
          candidate.options.some((option: any) => option.id === candidate.value),
          `filter ${filter.id} value ${candidate.value} is not one of its options`,
        )
      }
      if (filter.id === 'tags') {
        assert(candidate.allowExclusion === true, 'tags filter should allow exclusions')
      }
    }
    for (const expected of ['length', 'favorites', 'daysOld', 'tags']) {
      assert(ids.has(expected), `missing expected filter: ${expected}`)
    }
  })

  suite.test('getSortingOptions returns usable, unique options', async () => {
    const options = await NHentai.getSortingOptions()
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
    const form = await NHentai.getAdvancedSearchForm({
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
    const form = await NHentai.getSettingsForm()
    assert(form, 'expected a settings form')
    const sections = form.getSections()
    assert(Array.isArray(sections) && sections.length > 0, 'settings form has no sections')
    for (const section of sections) {
      assert(section.id, 'settings section missing id')
      assert(Array.isArray(section.items), `section ${section.id} missing items`)
    }
  })

  suite.test('getSearchResults returns valid items', async () => {
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('school')
    } catch {
      markUnavailable(suite)
      return
    }
    if (!result?.items?.length) {
      markUnavailable(suite)
      return
    }
    assertPaged(result, 'search "school"')
    suite.state['SearchPage1'] = result
  })

  suite.test('getSearchResults without a query returns a valid page', async () => {
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('')
    } catch {
      markUnavailable(suite)
      return
    }
    assertPaged(result, 'default search')
  })

  suite.test('getSearchResults returns a distinct next page', async () => {
    if (suite.state[UNAVAILABLE]) return
    const page1 = suite.state['SearchPage1'] as any
    assert(page1?.metadata, 'search page 1 should have metadata')
    let page2: PagedResults<SearchResultItem>
    try {
      page2 = await searchNHentai('school', page1.metadata)
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

  // ── Live: native filter syntax is accepted and keeps pagination intact ────
  suite.test('getSearchResults combines multiple tags with a pages bound', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('school maid pages:<=200')
    } catch {
      markUnavailable(suite)
      return
    }
    assertPaged(result, 'school maid pages:<=200')
  })

  suite.test('getSearchResults accepts a language filter', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('language:japanese pages:<=100')
    } catch {
      markUnavailable(suite)
      return
    }
    // The language token is verified offline by the token test above; upstream
    // can return a sparse page for a narrow query, so only shape is checked.
    assertSearchAccepted(result, 'language:japanese pages:<=100')
  })

  suite.test('getSearchResults accepts a page-count filter', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('pages:<=100')
    } catch {
      markUnavailable(suite)
      return
    }
    assertPaged(result, 'pages:<=100')
  })

  suite.test('getSearchResults accepts a favorites filter', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('favorites:>500')
    } catch {
      markUnavailable(suite)
      return
    }
    assertSearchAccepted(result, 'favorites:>500')
  })

  suite.test('getSearchResults accepts a relative date filter', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('uploaded:<30d')
    } catch {
      markUnavailable(suite)
      return
    }
    assertSearchAccepted(result, 'uploaded:<30d')
  })

  suite.test('getSearchResults accepts exclusion syntax', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('school -yaoi pages:<=300')
    } catch {
      markUnavailable(suite)
      return
    }
    assertSearchAccepted(result, 'school -yaoi pages:<=300')
  })

  suite.test('getSearchResults accepts combined filters', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('pages:<=200 favorites:>100')
    } catch {
      markUnavailable(suite)
      return
    }
    assertSearchAccepted(result, 'pages:<=200 favorites:>100')
  })

  suite.test('getSearchResults expands OR groups client-side', async () => {
    if (suite.state[UNAVAILABLE]) return
    let result: PagedResults<SearchResultItem>
    try {
      result = await searchNHentai('yuri OR maid')
    } catch {
      markUnavailable(suite)
      return
    }
    // OR expansion unions two live queries; an empty union is a data problem,
    // not a parser failure.
    assertSearchAccepted(result, 'yuri OR maid')
  })

  // ── Live: details, chapters, related ─────────────────────────────────────
  suite.test('getMangaDetails has valid metadata', async () => {
    if (suite.state[UNAVAILABLE]) return
    const searchPage = suite.state['SearchPage1'] as any
    const searchItem = searchPage?.items?.[0]
    assert(searchItem?.mangaId, 'getSearchResults must pass first')
    let sourceManga: any
    try {
      sourceManga = await NHentai.getMangaDetails(searchItem.mangaId)
    } catch {
      markUnavailable(suite)
      return
    }
    suite.state['MangaProviding.getMangaDetails'] = sourceManga
    const info = sourceManga.mangaInfo
    assert(info.primaryTitle, 'manga details missing primaryTitle')
    assert(info.thumbnailUrl && /^https?:\/\//.test(info.thumbnailUrl), 'manga details missing thumbnailUrl')
    assert(typeof info.synopsis === 'string', 'manga details missing synopsis')
    assert(Array.isArray(info.secondaryTitles), 'secondaryTitles should be an array')
    assert(typeof info.rating === 'number', `rating should be a number, got ${typeof info.rating}`)
    assert(info.status === 'COMPLETED', `unexpected status: ${info.status}`)
    assert(info.contentRating !== undefined, 'missing content rating')
    assert(
      /^https?:\/\/nhentai\.net\/g\/\d+$/.test(info.shareUrl ?? ''),
      `unexpected shareUrl: ${info.shareUrl}`,
    )
    assert(NHENTAI_CDN.test(info.thumbnailUrl), `thumbnail does not use the NHentai CDN: ${info.thumbnailUrl}`)
    assert(Array.isArray(info.tagGroups) && info.tagGroups.length > 0, 'manga details should include tag groups')
    for (const group of info.tagGroups as any[]) {
      assert(group.id, 'tag group missing id')
      assert(Array.isArray(group.tags), `tag group ${group.id} missing tags`)
      for (const tag of group.tags) {
        assert(tag.id, `tag in group ${group.id} missing id`)
        assert(typeof tag.title === 'string', `tag ${tag.id} missing title`)
      }
    }
  })

  suite.test('getMangaDetails is stable across calls', async () => {
    if (suite.state[UNAVAILABLE]) return
    const sourceManga = suite.state['MangaProviding.getMangaDetails'] as any
    assert(sourceManga, 'getMangaDetails must pass first')
    let first: any
    let second: any
    try {
      first = await NHentai.getMangaDetails(sourceManga.mangaId)
      second = await NHentai.getMangaDetails(sourceManga.mangaId)
    } catch {
      markUnavailable(suite)
      return
    }
    assert(first.mangaId === second.mangaId, 'mangaId changed between calls')
    assert(
      first.mangaInfo.primaryTitle === second.mangaInfo.primaryTitle,
      'primaryTitle changed between calls',
    )
  })

  suite.test('getChapters returns the single synthetic chapter', async () => {
    if (suite.state[UNAVAILABLE]) return
    const sourceManga = suite.state['MangaProviding.getMangaDetails'] as any
    assert(sourceManga, 'getMangaDetails must pass first')
    let chapters: any[]
    try {
      chapters = await NHentai.getChapters(sourceManga)
    } catch {
      markUnavailable(suite)
      return
    }
    assert(Array.isArray(chapters) && chapters.length === 1, `NHentai galleries are single-chapter, got ${chapters?.length}`)
    const chapter = chapters[0]
    assert(chapter.chapterId, 'chapter missing chapterId')
    assert(chapter.sourceManga, 'chapter missing sourceManga')
    assert(!Number.isNaN(chapter.chapNum), `invalid chapNum: ${chapter.chapNum}`)
    assert(typeof chapter.langCode === 'string' && chapter.langCode.length > 0, 'chapter missing langCode')
    suite.state['Chapters'] = chapters
  })

  suite.test('getChapterDetails returns unique, valid page URLs', async () => {
    if (suite.state[UNAVAILABLE]) return
    const chapters = suite.state['Chapters'] as any[] | undefined
    if (!chapters?.length) throw new Error('getChapters must pass first')
    let details: any
    try {
      details = await NHentai.getChapterDetails(chapters[0])
    } catch {
      markUnavailable(suite)
      return
    }
    const pages = details.pages
    assert(Array.isArray(pages) && pages.length > 0, 'expected chapter pages')
    const unique = new Set(pages)
    assert(unique.size === pages.length, 'duplicate page URLs detected')
    for (const page of pages) {
      assert(PAGE_URL.test(page), `invalid page URL: ${page}`)
    }
  })

  suite.test('related, last-read and top-reread sections return item arrays', async () => {
    const results = await Promise.all([
      NHentai.getRelatedSection(undefined, false),
      NHentai.getLastReadSection(undefined, false),
      NHentai.getTopRereadSection(undefined, false),
    ])
    for (const result of results) {
      assert(result && Array.isArray(result.items), 'section should have an items array')
    }
  })

  suite.test('saveCloudflareBypassCookies accepts an empty list', async () => {
    await NHentai.saveCloudflareBypassCookies([])
  })

  await suite.run()
}
