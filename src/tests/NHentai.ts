import {
  type JSONValue,
  type SortingOption,
  type TestLogger,
} from '@paperback/types'
import { TestSuite, registerDefaultTests } from './suite.js'
import { NHentai } from '../NHentai/main.js'
import sourceInfo from '../NHentai/pbconfig.js'
import { setHideReadSetting } from '../NHentai/settings.js'

const DATE_SORT: SortingOption = { id: 'date', label: 'Date Added' }

function searchNHentai(title: string, metadata?: JSONValue) {
  return NHentai.getSearchResults(
    { title, metadata: [] },
    metadata,
    DATE_SORT,
  )
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

  suite.test('initialise completes without error', async () => {
    await NHentai.initialise()
  })

  suite.test('getDiscoverSections returns valid sections', async () => {
    const sections = await NHentai.getDiscoverSections()
    if (!sections.length) throw new Error('Expected at least one discover section')
    for (const section of sections) {
      if (!section.id || !section.title) throw new Error('Invalid discover section')
    }
    suite.state['DiscoverSections'] = sections
  })

  suite.test('getDiscoverSectionItems supports pagination', async () => {
    const section = { id: 'new_uploads', title: 'New Uploads' } as any
    const page1 = await NHentai.getDiscoverSectionItems(section, undefined)
    if (!page1.items.length || !page1.metadata) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    const page2 = await NHentai.getDiscoverSectionItems(section, page1.metadata)
    if (!page2.items.length) throw new Error('Expected items on page 2')
    suite.state['DiscoverPage1'] = page1
  })

  suite.test('getSearchResults returns valid items', async () => {
    const result = await searchNHentai('school')
    if (!result?.items?.length) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    for (const item of result.items as any[]) {
      if (!item.mangaId || !item.title || !item.imageUrl) {
        throw new Error(`Invalid search result: ${JSON.stringify(item)}`)
      }
      if (!item.imageUrl.startsWith('http')) {
        throw new Error(`Search image URL is not HTTP: ${item.imageUrl}`)
      }
    }
    suite.state['SearchPage1'] = result
  })

  suite.test('getSearchResults returns a distinct next page', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const page1 = suite.state['SearchPage1'] as any
    if (!page1?.metadata) throw new Error('Search page 1 should have metadata')
    const page2 = await searchNHentai('school', page1.metadata)
    if (!page2.items.length) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    const page1Ids = new Set(page1.items.map((item: any) => item.mangaId))
    if (page2.items.every((item: any) => page1Ids.has(item.mangaId))) {
      throw new Error('Page 2 returned only page 1 items')
    }
  })

  suite.test('getSearchResults accepts filter syntax', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const result = await searchNHentai('school maid pages:<=200')
    if (!result || !Array.isArray(result.items)) {
      throw new Error('Filtered search should return an items array')
    }
  })

  suite.test('getSearchResults without filters returns results', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const result = await searchNHentai('')
    if (!result.items.length) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (!result.metadata) throw new Error('Expected pagination metadata')
  })

  suite.test('getSearchFilters returns valid filters', async () => {
    const filters = await NHentai.getSearchFilters()
    if (!filters.length) throw new Error('Expected at least one search filter')
    for (const filter of filters) {
      if (!filter.id || !filter.title) throw new Error('Filter missing id or title')
    }
  })

  suite.test('getSortingOptions returns unique options', async () => {
    const options = await NHentai.getSortingOptions()
    if (options.length < 2) throw new Error('Expected multiple sorting options')
    if (new Set(options.map(option => option.id)).size !== options.length) {
      throw new Error('Sorting option IDs should be unique')
    }
  })

  suite.test('getAdvancedSearchForm returns a form', async () => {
    const form = await NHentai.getAdvancedSearchForm({ title: '', metadata: [] } as any)
    if (!form || typeof form !== 'object') throw new Error('Expected advanced search form')
  })

  suite.test('getSettingsForm returns sections', async () => {
    const form = await NHentai.getSettingsForm()
    if (!form || !Array.isArray(form.getSections())) throw new Error('Invalid settings form')
  })

  suite.test('getMangaDetails has valid metadata', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const searchPage = suite.state['SearchPage1'] as any
    const searchItem = searchPage?.items?.[0]
    if (!searchItem?.mangaId) throw new Error('getSearchResults must pass first')
    let sourceManga: any
    try {
      sourceManga = await NHentai.getMangaDetails(searchItem.mangaId)
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    suite.state['MangaProviding.getMangaDetails'] = sourceManga
    const info = sourceManga.mangaInfo
    if (!info.primaryTitle || !info.thumbnailUrl || !info.synopsis) {
      throw new Error('Manga details missing required text fields')
    }
    if (!Array.isArray(info.tagGroups) || !info.tagGroups.length) {
      throw new Error('Manga details should include tag groups')
    }
    if (info.status !== 'COMPLETED') throw new Error(`Unexpected status: ${info.status}`)
    if (info.contentRating === undefined) throw new Error('Missing content rating')
    if (!/^https?:\/\/[it]\d+\.nhentai\.net\//.test(info.thumbnailUrl)) {
      throw new Error(`Thumbnail does not use NHentai CDN: ${info.thumbnailUrl}`)
    }
    for (const group of info.tagGroups as any[]) {
      if (!group.id || !Array.isArray(group.tags)) throw new Error('Invalid tag group')
      for (const tag of group.tags) {
        if (!tag.id || typeof tag.title !== 'string') throw new Error('Invalid tag')
      }
    }
  })

  suite.test('getMangaDetails is stable across calls', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const sourceManga = suite.state['MangaProviding.getMangaDetails'] as any
    if (!sourceManga) throw new Error('getMangaDetails must pass first')
    let first: any
    let second: any
    try {
      first = await NHentai.getMangaDetails(sourceManga.mangaId)
      second = await NHentai.getMangaDetails(sourceManga.mangaId)
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (first.mangaId !== second.mangaId || first.mangaInfo.primaryTitle !== second.mangaInfo.primaryTitle) {
      throw new Error('Manga details changed between calls')
    }
  })

  suite.test('getChapters returns valid chapter data', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const sourceManga = suite.state['MangaProviding.getMangaDetails'] as any
    if (!sourceManga) throw new Error('getMangaDetails must pass first')
    let chapters: any[]
    try {
      chapters = await NHentai.getChapters(sourceManga)
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (!chapters.length) throw new Error('Expected at least one chapter')
    for (const chapter of chapters) {
      if (!chapter.chapterId || !chapter.sourceManga || !chapter.langCode) {
        throw new Error('Invalid chapter structure')
      }
      if (typeof chapter.chapNum !== 'number' || Number.isNaN(chapter.chapNum)) {
        throw new Error(`Invalid chapter number: ${chapter.chapNum}`)
      }
    }
    suite.state['Chapters'] = chapters
  })

  suite.test('getChapterDetails returns valid page URLs', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const chapters = suite.state['Chapters'] as any[]
    if (!chapters?.length) throw new Error('getChapters must pass first')
    let details: any
    try {
      details = await NHentai.getChapterDetails(chapters[0])
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (!Array.isArray(details.pages) || !details.pages.length) {
      throw new Error('Expected chapter pages')
    }
    for (const page of details.pages) {
      if (!/^https?:\/\/[it]\d+\.nhentai\.net\/galleries\/\d+\/\d+\.[a-z]+$/i.test(page)) {
        throw new Error(`Invalid page URL: ${page}`)
      }
    }
  })

  suite.test('related sections return item arrays', async () => {
    const results = await Promise.all([
      NHentai.getRelatedSection(undefined, false),
      NHentai.getLastReadSection(undefined, false),
      NHentai.getTopRereadSection(undefined, false),
    ])
    for (const result of results) {
      if (!result || !Array.isArray(result.items)) throw new Error('Invalid related section')
    }
  })

  suite.test('saveCloudflareBypassCookies accepts an empty list', async () => {
    await NHentai.saveCloudflareBypassCookies([])
  })

  await suite.run()
}
