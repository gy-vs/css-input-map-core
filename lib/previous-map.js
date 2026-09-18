'use strict'

let { existsSync, lstatSync, readFileSync, realpathSync } = require('fs')
let { basename, dirname, isAbsolute, join, relative, sep } = require('path')
let { SourceMapConsumer, SourceMapGenerator } = require('source-map-js')

function fromBase64(str) {
  if (Buffer) {
    return Buffer.from(str, 'base64').toString()
  } else {
    /* c8 ignore next 2 */
    return window.atob(str)
  }
}

// Resolve a path to its actual location after following every symlink.
// Returns `undefined` for broken links, symlink loops or any other
// file-system error instead of throwing: a malformed user upload must not
// crash CSS parsing.
function realpath(file) {
  try {
    return realpathSync(file)
  } catch {
    return undefined
  }
}

// Check whether `dir` treats names with different case as the same file.
// Works on both case-sensitive (Linux ext4) and case-insensitive (Windows,
// default macOS APFS) file systems without relying on `process.platform`.
function isCaseInsensitive(dir) {
  let part = dir
  let swapped
  while (true) {
    let letter = /[a-zA-Z]/.exec(basename(part))
    if (letter) {
      let name = basename(part)
      let changed =
        letter[0] === letter[0].toLowerCase()
          ? letter[0].toUpperCase()
          : letter[0].toLowerCase()
      swapped = join(
        dirname(part),
        name.slice(0, letter.index) + changed + name.slice(letter.index + 1)
      )
      break
    }
    let parent = dirname(part)
    /* c8 ignore next 3 */
    // Unreachable on tested paths: a writable ancestor always contains a
    // letter (home/temp directory names are never all digits or symbols).
    if (parent === part) return false
    part = parent
  }
  try {
    return lstatSync(swapped).ino === lstatSync(part).ino
  } catch {
    /* c8 ignore next 3 */
    // On case-sensitive file systems the swapped name does not exist.
    return false
  }
}

// Check the actual file locations instead of path strings, so symlinks
// (including a symlink in the middle of a path) pointing outside the CSS
// directory cannot bypass the boundary check.
function isInside(mapDir, cssDir) {
  let inside = rel =>
    rel === '' ||
    (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))

  if (inside(relative(cssDir, mapDir))) return true

  /* c8 ignore start */
  // Real path names differing only in case matters on case-insensitive
  // file systems (Windows, default macOS) where they are the same location.
  if (isCaseInsensitive(cssDir)) {
    return inside(
      relative(cssDir.toLowerCase(), mapDir.toLowerCase())
    )
  }
  return false
  /* c8 ignore stop */
}

class PreviousMap {
  constructor(css, opts) {
    if (opts.map === false) return
    if (opts.unsafeMap) this.unsafeMap = true
    this.loadAnnotation(css)
    this.inline = this.startWith(this.annotation, 'data:')

    let prev = opts.map ? opts.map.prev : undefined
    let text = this.loadMap(opts.from, prev)
    if (!this.mapFile && opts.from) {
      this.mapFile = opts.from
    }
    if (this.mapFile) this.root = dirname(this.mapFile)
    if (text) this.text = text
  }

  consumer() {
    if (!this.consumerCache) {
      this.consumerCache = new SourceMapConsumer(this.json || this.text)
    }
    return this.consumerCache
  }

  decodeInline(text) {
    let baseCharsetUri = /^data:application\/json;charset=utf-?8;base64,/
    let baseUri = /^data:application\/json;base64,/
    let charsetUri = /^data:application\/json;charset=utf-?8,/
    let uri = /^data:application\/json,/

    let uriMatch = text.match(charsetUri) || text.match(uri)
    if (uriMatch) {
      return decodeURIComponent(text.substr(uriMatch[0].length))
    }

    let baseUriMatch = text.match(baseCharsetUri) || text.match(baseUri)
    if (baseUriMatch) {
      return fromBase64(text.substr(baseUriMatch[0].length))
    }

    let encoding = text.slice('data:application/json;'.length)
    encoding = encoding.slice(0, encoding.indexOf(','))
    throw new Error('Unsupported source map encoding ' + encoding)
  }

  getAnnotationURL(sourceMapString) {
    return sourceMapString.replace(/^\/\*\s*# sourceMappingURL=/, '').trim()
  }

  isMap(map) {
    if (typeof map !== 'object') return false
    return (
      typeof map.mappings === 'string' ||
      typeof map._mappings === 'string' ||
      Array.isArray(map.sections)
    )
  }

  loadAnnotation(css) {
    let comments = css.match(/\/\*\s*# sourceMappingURL=/g)
    if (!comments) return

    // sourceMappingURLs from comments, strings, etc.
    let start = css.lastIndexOf(comments.pop())
    let end = css.indexOf('*/', start)

    if (start > -1 && end > -1) {
      // Locate the last sourceMappingURL to avoid pickin
      this.annotation = this.getAnnotationURL(css.substring(start, end))
    }
  }

  loadFile(path, cssFile, trusted) {
    if (!trusted && !this.unsafeMap) {
      if (!/\.map$/i.test(path)) return undefined
      if (!cssFile) return undefined

      // Resolve to real locations before comparing, so a `.map` symlink
      // (or a symlink anywhere in the middle of the path) cannot point
      // outside the CSS file directory. Broken links and symlink loops
      // resolve to `undefined` and are rejected without throwing.
      let cssDir = realpath(dirname(cssFile))
      let mapPath = realpath(path)
      if (!cssDir || !mapPath || !isInside(dirname(mapPath), cssDir)) {
        return undefined
      }
    }
    this.root = dirname(path)
    if (existsSync(path)) {
      this.mapFile = path
      return readFileSync(path, 'utf-8').toString().trim()
    }
  }

  loadMap(file, prev) {
    if (prev === false) return false

    if (prev) {
      if (typeof prev === 'string') {
        return prev
      } else if (typeof prev === 'function') {
        let prevPath = prev(file)
        if (prevPath) {
          let map = this.loadFile(prevPath, file, true)
          if (!map) {
            throw new Error(
              'Unable to load previous source map: ' + prevPath.toString()
            )
          }
          return map
        }
      } else if (prev instanceof SourceMapConsumer) {
        return SourceMapGenerator.fromSourceMap(prev).toString()
      } else if (prev instanceof SourceMapGenerator) {
        return prev.toString()
      } else if (this.isMap(prev)) {
        return JSON.stringify(prev)
      } else {
        throw new Error(
          'Unsupported previous source map format: ' + prev.toString()
        )
      }
    } else if (this.inline) {
      return this.decodeInline(this.annotation)
    } else if (this.annotation) {
      let map = this.annotation
      if (file) map = join(dirname(file), map)
      let unknown = this.loadFile(map, file, false)
      if (unknown) {
        try {
          /* c8 ignore next 4 */
          this.json = JSON.parse(unknown.replace(/^\)]}'[^\n]*\n/, ''))
        } catch {
          return undefined
        }
      }
      return unknown
    }
  }

  startWith(string, start) {
    if (!string) return false
    return string.substr(0, start.length) === start
  }

  withContent() {
    return !!(
      this.consumer().sourcesContent &&
      this.consumer().sourcesContent.length > 0
    )
  }
}

module.exports = PreviousMap
PreviousMap.default = PreviousMap
