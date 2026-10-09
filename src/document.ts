import { copy_data, element_children } from './engine/element'
import { Page } from './elems/page'
import type { PageProps } from './elems/page'

type DocumentProps = PageProps & Readonly<{ title?: string }>

// A document owns an ordered set of pages, not a spatial layout. Source props
// supply page defaults; hosts lay out each page independently in a shared pass.
class Document {
  readonly pages: readonly Page[]
  readonly defaults: Readonly<Omit<PageProps, 'children'>>
  readonly title?: string

  // Snapshot defaults and page order without measuring or changing the pages.
  constructor({ children, title, ...defaults }: DocumentProps = {}) {
    const pages = element_children(children)
    if (!pages.length) throw new TypeError('Document requires at least one Page')
    if (!pages.every(page => page instanceof Page)) {
      throw new TypeError('Document children must be Page elements')
    }
    if (title !== undefined && typeof title !== 'string') {
      throw new TypeError('Document.title must be a string')
    }
    this.pages = pages as readonly Page[]
    this.defaults = copy_data(defaults)
    this.title = title
    Object.freeze(this)
  }
}

export { Document }
export type { DocumentProps }
