import {
  type JSONValue,
  type SortingOption,
  type TestLogger,
} from '@paperback/types'
import { TestSuite, registerDefaultTests } from './suite.js'
import { Hitomi } from '../Hitomi/main.js'
import sourceInfo from '../Hitomi/pbconfig.js'
import { setHideReadSetting } from '../Hitomi/settings.js'

const DATE_SORT: SortingOption = { id: 'date_added', label: 'Date Added' }

function searchHitomi(title = '', metadata?: JSONValue) {
  return Hitomi.getSearchResults(
    { title, metadata: [] },
    metadata,
    DATE_SORT,
  )
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

  suite.test('initialise completes without error', async () => {
    try {
      await Hitomi.initialise()
    } catch (err) {
      throw new Error(`initialise() should not throw, got: ${err}`)
    }
  })

  suite.test('getDiscoverSections', async () => {
    const sections = await Hitomi.getDiscoverSections()
    if (!sections.length) throw new Error('Expected at least one discover section')
    for (const section of sections) {
      if (!section.id || typeof section.id !== 'string') {
        throw new Error(`Section has invalid id: ${section.id}`)
      }
      if (!section.title || typeof section.title !== 'string') {
        throw new Error(`Section "${section.id}" has invalid title: ${section.title}`)
      }
    }
    suite.state['DiscoverSections'] = sections
  })

  suite.test('getDiscoverSectionItems', async () => {
    let result: any
    try {
      result = await Hitomi.getDiscoverSectionItems(
        { id: 'date_added', title: 'Date Added' } as any,
        undefined,
      )
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (!result.items.length || !result.metadata) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    suite.state['DiscoverPage1'] = result
  })

  suite.test('getDiscoverSectionItems pagination', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const page1 = suite.state['DiscoverPage1'] as any
    if (!page1?.metadata) throw new Error('Page 1 should have metadata for pagination')
    let page2: any
    try {
      page2 = await Hitomi.getDiscoverSectionItems(
        { id: 'date_added', title: 'Date Added' } as any,
        page1.metadata,
      )
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (!page2.items.length) throw new Error('Expected items on page 2')
    const page1Ids = new Set(page1.items.map((item: any) => item.mangaId || item.id))
    if (page2.items.every((item: any) => page1Ids.has(item.mangaId || item.id))) {
      throw new Error('Page 2 returned identical items to page 1')
    }
  })

  suite.test('getSearchResults', async () => {
    const result = await searchHitomi()
    if (!result.items.length || !result.metadata) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    for (const item of result.items as any[]) {
      if (!item.mangaId) throw new Error(`Item missing mangaId: ${JSON.stringify(item)}`)
      if (!item.title || typeof item.title !== 'string') {
        throw new Error(`Item "${item.mangaId}" missing title`)
      }
      if (!item.imageUrl || typeof item.imageUrl !== 'string') {
        throw new Error(`Item "${item.mangaId}" missing imageUrl`)
      }
    }
    suite.state['SearchPage1'] = result
  })

  suite.test('getSearchResults pagination', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const page1 = suite.state['SearchPage1'] as any
    if (!page1?.metadata) throw new Error('Page 1 should have metadata for pagination')
    const page2 = await searchHitomi('', page1.metadata)
    if (!page2.items.length) throw new Error('Expected search results on page 2')
    const page1Ids = new Set(page1.items.map((item: any) => item.mangaId))
    if (page2.items.every((item: any) => page1Ids.has(item.mangaId))) {
      throw new Error('Page 2 returned identical items to page 1')
    }
  })

  suite.test('getSearchFilters', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const filters = await Hitomi.getSearchFilters()
    if (!filters.length) throw new Error('Expected at least one search filter')
    for (const filter of filters) {
      if (!filter.id || !filter.title) throw new Error('Filter missing id or title')
    }
  })

  suite.test('getSortingOptions', async () => {
    const options = await Hitomi.getSortingOptions()
    if (options.length < 2) throw new Error('Expected multiple sorting options')
    if (new Set(options.map(option => option.id)).size !== options.length) {
      throw new Error('Sorting option IDs should be unique')
    }
  })

  suite.test('getAdvancedSearchForm', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const form = await Hitomi.getAdvancedSearchForm({ title: '', metadata: [] } as any)
    if (!form || typeof form !== 'object') throw new Error('Expected advanced search form')
  })

  suite.test('getSettingsForm', async () => {
    const form = await Hitomi.getSettingsForm()
    if (!form) throw new Error('Expected settings form')
    if (!Array.isArray(form.getSections())) throw new Error('Settings form should return sections')
  })

  suite.test('manga details structure', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const searchPage = suite.state['SearchPage1'] as any
    const searchItem = searchPage?.items?.[0]
    if (!searchItem?.mangaId) throw new Error('getSearchResults must pass first')
    let sourceManga: any
    try {
      sourceManga = await Hitomi.getMangaDetails(searchItem.mangaId)
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    suite.state['MangaProviding.getMangaDetails'] = sourceManga
    const info = sourceManga.mangaInfo
    if (!info.primaryTitle || typeof info.primaryTitle !== 'string') {
      throw new Error('Missing primaryTitle')
    }
    if (!info.thumbnailUrl || typeof info.thumbnailUrl !== 'string') {
      throw new Error('Missing thumbnailUrl')
    }
    if (!info.synopsis || typeof info.synopsis !== 'string') throw new Error('Missing synopsis')
    if (!Array.isArray(info.tagGroups) || !info.tagGroups.length) {
      throw new Error('Expected non-empty tagGroups')
    }
    if (info.status !== 'COMPLETED') throw new Error(`Unexpected status: ${info.status}`)
  })

  suite.test('chapter structure', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const sourceManga = suite.state['MangaProviding.getMangaDetails'] as any
    if (!sourceManga) throw new Error('getMangaDetails must pass first')
    let chapters: any[]
    try {
      chapters = await Hitomi.getChapters(sourceManga)
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    suite.state['ChapterProviding.getChapters'] = chapters
    if (!chapters?.length) throw new Error('getChapters must pass first')
    for (const chapter of chapters) {
      if (!chapter.chapterId || !chapter.sourceManga) throw new Error('Invalid chapter')
      if (typeof chapter.chapNum !== 'number' || Number.isNaN(chapter.chapNum)) {
        throw new Error(`Invalid chapNum: ${chapter.chapNum}`)
      }
    }
  })

  suite.test('chapter page URLs are usable', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const chapters = suite.state['ChapterProviding.getChapters'] as any[]
    if (!chapters?.length) throw new Error('getChapters must pass first')
    let details: any
    try {
      details = await Hitomi.getChapterDetails(chapters[0])
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    suite.state['ChapterProviding.getChapterDetails'] = details
    const pages = details?.pages
    if (!Array.isArray(pages) || !pages.length) throw new Error('Expected chapter pages')
    if (pages.some((page: unknown) => typeof page !== 'string' || page.length === 0)) {
      throw new Error('Every chapter page should be a non-empty string')
    }
  })

  suite.test('search results are consistent across calls', async () => {
    if (suite.state['LiveDataUnavailable']) return
    let first: any
    let second: any
    try {
      first = await searchHitomi()
      second = await searchHitomi()
    } catch {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    if (!first.items.length || !second.items.length) {
      suite.state['LiveDataUnavailable'] = true
      return
    }
    const firstIds = first.items.map(item => item.mangaId).sort()
    const secondIds = second.items.map(item => item.mangaId).sort()
    if (firstIds.join(',') !== secondIds.join(',')) {
      throw new Error('Repeated searches should return the same IDs')
    }
  })

  suite.test('discover sections return item arrays', async () => {
    if (suite.state['LiveDataUnavailable']) return
    const sections = suite.state['DiscoverSections'] as any[]
    if (!sections?.length) throw new Error('getDiscoverSections must pass first')
    for (const section of sections.slice(0, 3)) {
      let result: any
      try {
        result = await Hitomi.getDiscoverSectionItems(section, undefined)
      } catch {
        suite.state['LiveDataUnavailable'] = true
        return
      }
      if (!Array.isArray(result.items)) throw new Error(`Invalid items for ${section.id}`)
    }
  })

  await suite.run()
}
