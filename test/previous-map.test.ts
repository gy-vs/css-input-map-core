import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join, sep } from 'path'
import { SourceMapConsumer } from 'source-map-js'
import { pathToFileURL } from 'url'
import { test } from 'uvu'
import { equal, is, match, not, throws, type } from 'uvu/assert'

import { parse } from '../lib/postcss.js'
import PreviousMap from '../lib/previous-map.js'

let dir = join(__dirname, 'prevmap-fixtures')
let outsideDir = join(__dirname, 'prevmap-outside-fixtures')
let mapObj = {
  file: null,
  mappings: '',
  names: [],
  sources: [],
  version: 3
}
let map = JSON.stringify(mapObj)

function deleteDir(path: string): void {
  if (existsSync(path)) {
    readdirSync(path).forEach(i => {
      let file = join(path, i)
      if (lstatSync(file).isDirectory()) {
        deleteDir(file)
      } else {
        unlinkSync(file)
      }
    })
    rmdirSync(path)
  }
}

test.after.each(() => {
  deleteDir(dir)
  deleteDir(outsideDir)
})

test('misses property if no map', () => {
  type(parse('a{}').source?.input.map, 'undefined')
})

test('creates property if map present', () => {
  let root = parse('a{}', { map: { prev: map } })
  is(root.source?.input.map.text, map)
})

test('returns consumer', () => {
  let obj = parse('a{}', { map: { prev: map } }).source?.input.map.consumer()
  is(obj instanceof SourceMapConsumer, true)
})

test('sets annotation property', () => {
  let mapOpts = { map: { prev: map } }

  let root1 = parse('a{}', mapOpts)
  type(root1.source?.input.map.annotation, 'undefined')

  let root2 = parse('a{}/*# sourceMappingURL=a.css.map */', mapOpts)
  is(root2.source?.input.map.annotation, 'a.css.map')
})

test('checks previous sources content', () => {
  let map2: any = {
    file: 'b',
    mappings: '',
    names: [],
    sources: ['a'],
    version: 3
  }

  let opts = { map: { prev: map2 } }
  is(parse('a{}', opts).source?.input.map.withContent(), false)

  map2.sourcesContent = ['a{}']
  is(parse('a{}', opts).source?.input.map.withContent(), true)
})

test('decodes base64 maps', () => {
  let b64 = Buffer.from(map).toString('base64')
  let css =
    'a{}\n' + `/*# sourceMappingURL=data:application/json;base64,${b64} */`

  is(parse(css).source?.input.map.text, map)
})

test('decodes base64 UTF-8 maps', () => {
  let b64 = Buffer.from(map).toString('base64')
  let css =
    'a{}\n/*# sourceMappingURL=data:application/json;' +
    'charset=utf-8;base64,' +
    b64 +
    ' */'

  is(parse(css).source?.input.map.text, map)
})

test('accepts different name for base64 maps with UTF-8 encoding', () => {
  let b64 = Buffer.from(map).toString('base64')
  let css =
    'a{}\n/*# sourceMappingURL=data:application/json;' +
    'charset=utf8;base64,' +
    b64 +
    ' */'

  is(parse(css).source?.input.map.text, map)
})

test('decodes URI maps', () => {
  let uri = 'data:application/json,' + decodeURI(map)
  let css = `a{}\n/*# sourceMappingURL=${uri} */`

  is(parse(css).source?.input.map.text, map)
})

test('decodes URI UTF-8 maps', () => {
  let uri = decodeURI(map)
  let css =
    'a{}\n/*# sourceMappingURL=data:application/json;' +
    'charset=utf-8,' +
    uri +
    ' */'

  is(parse(css).source?.input.map.text, map)
})

test('accepts different name for URI maps with UTF-8 encoding', () => {
  let uri = decodeURI(map)
  let css =
    'a{}\n/*# sourceMappingURL=data:application/json;' +
    'charset=utf8,' +
    uri +
    ' */'

  is(parse(css).source?.input.map.text, map)
})

test('removes map on request', () => {
  let uri = 'data:application/json,' + decodeURI(map)
  let css = `a{}\n/*# sourceMappingURL=${uri} */`

  let input = parse(css, { map: { prev: false } }).source?.input
  type(input?.map, 'undefined')
})

test('raises on unknown inline encoding', () => {
  let css =
    'a { }\n/*# sourceMappingURL=data:application/json;' +
    'md5,68b329da9893e34099c7d8ad5cb9c940*/'

  throws(() => {
    parse(css)
  }, 'Unsupported source map encoding md5')
})

test('raises on unknown map format', () => {
  throws(() => {
    // @ts-expect-error Invalid input
    parse('a{}', { map: { prev: 1 } })
  }, 'Unsupported previous source map format: 1')
})

test('reads map from annotation', () => {
  let file = join(dir, 'a.map')
  mkdirSync(dir)
  writeFileSync(file, map)
  let root = parse('a{}\n/*# sourceMappingURL=a.map */', { from: file })

  is(root.source?.input.map.text, map)
  is(root.source?.input.map.root, dir)
})

test('reads only the last map from annotation', () => {
  let file = join(dir, 'c.map')
  mkdirSync(dir)
  writeFileSync(file, map)
  let root = parse(
    'a{}' +
      '\n/*# sourceMappingURL=a.map */' +
      '\n/*# sourceMappingURL=b.map */' +
      '\n/*# sourceMappingURL=c.map */',
    { from: file }
  )

  is(root.source?.input.map.text, map)
  is(root.source?.input.map.root, dir)
})

test('sets unique name for inline map', () => {
  let map2 = {
    mappings: '',
    names: [],
    sources: ['a'],
    version: 3
  }

  let opts = { map: { prev: map2 } }
  let file1 = parse('a{}', opts).source?.input.map.file
  let file2 = parse('a{}', opts).source?.input.map.file

  match(String(file1), /^<input css [\w-]+>$/)
  is.not(file1, file2)
})

test('accepts an empty mappings string', () => {
  not.throws(() => {
    let emptyMap = {
      mappings: '',
      names: [],
      sources: [],
      version: 3
    }
    parse('body{}', { map: { prev: emptyMap } })
  })
})

test('accepts a function', () => {
  let css = 'body{}\n/*# sourceMappingURL=a.map */'
  let file = join(dir, 'previous-sourcemap-function.map')
  mkdirSync(dir)
  writeFileSync(file, map)
  let opts = {
    map: {
      prev: () => file
    }
  }
  let root = parse(css, opts)
  is(root.source?.input.map.text, map)
  is(root.source?.input.map.annotation, 'a.map')
})

test('calls function with opts.from', () => {
  let css = 'body{}\n/*# sourceMappingURL=a.map */'
  let file = join(dir, 'previous-sourcemap-function.map')
  mkdirSync(dir)
  writeFileSync(file, map)
  parse(css, {
    from: 'a.css',
    map: {
      prev: from => {
        is(from, 'a.css')
        return file
      }
    }
  })
})

test('raises when function returns invalid path', () => {
  let css = 'body{}\n/*# sourceMappingURL=a.map */'
  let fakeMap = Number.MAX_SAFE_INTEGER.toString() + '.map'
  let fakePath = join(dir, fakeMap)
  let opts = {
    map: {
      prev: () => fakePath
    }
  }
  throws(() => {
    parse(css, opts)
  }, 'Unable to load previous source map: ' + fakePath)
})

test('uses source map path as a root', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  mkdirSync(join(dir, 'maps'))
  writeFileSync(
    join(dir, 'maps', 'a.map'),
    JSON.stringify({
      file: 'test.css',
      mappings: 'AACA,CAAC,CACG,GAAG,CAAC;EACF,KAAK,EAAE,GAAI;CACZ',
      names: [],
      sources: ['../../test.scss'],
      version: 3
    })
  )
  let root = parse(
    '* div {\n  color: red;\n  }\n/*# sourceMappingURL=maps/a.map */',
    { from }
  )
  equal(root.source?.input.origin(1, 4, 1, 6), {
    column: 5,
    endColumn: 8,
    endLine: 3,
    file: join(dir, '..', 'test.scss'),
    line: 3,
    url: pathToFileURL(join(dir, '..', 'test.scss')).href
  })
})

test('does not load map from non-.map file', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  writeFileSync(join(dir, 'a.txt'), map)
  let input = parse('a{}\n/*# sourceMappingURL=a.txt */', { from }).source
    ?.input
  type(input?.map, 'undefined')
})

test('does not load map from outside the from folder', () => {
  let from = join(dir, 'subdir', 'a.css')
  mkdirSync(dir)
  mkdirSync(join(dir, 'subdir'))
  writeFileSync(join(dir, 'outside.map'), map)
  let input = parse('a{}\n/*# sourceMappingURL=../outside.map */', { from })
    .source?.input
  type(input?.map, 'undefined')
})

test('does not load relative map without from', () => {
  let cwd = join(dir, 'subdir')
  mkdirSync(dir)
  mkdirSync(cwd)
  writeFileSync(join(cwd, 'previous.map'), map)
  let previousCwd = process.cwd()
  try {
    process.chdir(cwd)
    let input = parse('a{}\n/*# sourceMappingURL=previous.map */').source?.input
    type(input?.map, 'undefined')
  } finally {
    process.chdir(previousCwd)
  }
})

test('loads map from outside the from folder with unsafeMap', () => {
  let from = join(dir, 'subdir', 'a.css')
  mkdirSync(dir)
  mkdirSync(join(dir, 'subdir'))
  writeFileSync(join(dir, 'outside.map'), map)
  let input = parse('a{}\n/*# sourceMappingURL=../outside.map */', {
    from,
    unsafeMap: true
  }).source?.input
  is(input?.map.text, map)
})

test('does not load map from a symlink outside the from folder', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  mkdirSync(outsideDir)
  let secretPath = join(outsideDir, 'secret.map')
  writeFileSync(secretPath, JSON.stringify({ secret: 'do-not-leak' }))
  let linkPath = join(dir, 'link.map')
  symlinkSync(secretPath, linkPath)

  let input = parse('a{}\n/*# sourceMappingURL=link.map */', {
    from
  }).source?.input
  type(input?.map, 'undefined')
})

test('loads map from a symlink inside the from folder', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  mkdirSync(join(dir, 'maps'))
  let targetPath = join(dir, 'maps', 'real.map')
  writeFileSync(targetPath, map)
  let linkPath = join(dir, 'link.map')
  symlinkSync(targetPath, linkPath)

  let input = parse('a{}\n/*# sourceMappingURL=link.map */', {
    from
  }).source?.input
  is(input?.map.text, map)
})

test('does not crash on a broken symlink map', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  mkdirSync(outsideDir)
  symlinkSync(join(outsideDir, 'missing.map'), join(dir, 'broken.map'))

  let input = parse('a{}\n/*# sourceMappingURL=broken.map */', {
    from
  }).source?.input
  type(input?.map, 'undefined')
})

test('does not crash on a symlink cycle map', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  symlinkSync(join(dir, 'b.map'), join(dir, 'a.map'))
  symlinkSync(join(dir, 'a.map'), join(dir, 'b.map'))

  let input = parse('a{}\n/*# sourceMappingURL=a.map */', {
    from
  }).source?.input
  type(input?.map, 'undefined')
})

test('does not load map through symlinked folder outside from folder', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  mkdirSync(outsideDir)
  writeFileSync(join(outsideDir, 'secret.map'), map)
  // The last path component is a regular file name, but a middle
  // component is a symlink escaping the CSS file’s directory.
  symlinkSync(outsideDir, join(dir, 'linked-folder'))

  let input = parse(
    'a{}\n/*# sourceMappingURL=linked-folder/secret.map */',
    { from }
  ).source?.input
  type(input?.map, 'undefined')
})

test('loads map through a symlinked folder inside the from folder', () => {
  let from = join(dir, 'a.css')
  mkdirSync(dir)
  mkdirSync(join(dir, 'maps'))
  writeFileSync(join(dir, 'maps', 'real.map'), map)
  symlinkSync(join(dir, 'maps'), join(dir, 'linked-folder'))

  let input = parse(
    'a{}\n/*# sourceMappingURL=linked-folder/real.map */',
    { from }
  ).source?.input
  is(input?.map.text, map)
})

test('does not load map when the CSS directory does not exist', () => {
  mkdirSync(outsideDir)
  writeFileSync(join(outsideDir, 'outside.map'), map)
  let from = join(dir, 'missing', 'a.css')

  let input = parse(
    'a{}\n/*# sourceMappingURL=../../prevmap-outside-fixtures/outside.map */',
    { from }
  ).source?.input
  type(input?.map, 'undefined')
})

test('checks that a map is inside its CSS directory case-insensitively', () => {
  let checker: any = new PreviousMap('', { map: false })
  let root = join(sep, 'project', 'styles')

  is(checker.isInsideDir(root, join(root, 'a.map')), true)
  is(checker.isInsideDir(root, join(sep, 'other', 'a.map')), false)
  is(checker.isInsideDir(root, root), false)
  is(checker.isInsideDir(root, join(root, '..', 'a.map')), false)
  // Case-insensitive file systems (Windows, default macOS) must treat
  // differently cased spellings of the same directory as equal.
  is(
    checker.isInsideDir(
      join(sep, 'Project', 'Styles'),
      join(sep, 'project', 'styles', 'a.map'),
      true
    ),
    true
  )
  // The check stays case-sensitive when the file system is.
  is(
    checker.isInsideDir(
      join(sep, 'Project', 'Styles'),
      join(sep, 'project', 'styles', 'a.map')
    ),
    false
  )
})

test('uses current file path for source map', () => {
  let root = parse('a{b:1}', {
    from: join(__dirname, 'dir', 'subdir', 'a.css'),
    map: {
      prev: {
        file: 'test.css',
        mappings: 'AAAA,CAAC;EAAC,CAAC,EAAC,CAAC',
        names: [],
        sources: ['../test.scss'],
        version: 3
      }
    }
  })
  equal(root.source?.input.origin(1, 1), {
    column: 1,
    endColumn: undefined,
    endLine: undefined,
    file: join(__dirname, 'dir', 'test.scss'),
    line: 1,
    url: pathToFileURL(join(__dirname, 'dir', 'test.scss')).href
  })
})

test('works with non-file sources', () => {
  let root = parse('a{b:1}', {
    from: join(__dirname, 'dir', 'subdir', 'a.css'),
    map: {
      prev: {
        file: 'test.css',
        mappings: 'AAAA,CAAC;EAAC,CAAC,EAAC,CAAC',
        names: [],
        sources: ['http://example.com/test.scss'],
        version: 3
      }
    }
  })
  equal(root.source?.input.origin(1, 1), {
    column: 1,
    endColumn: undefined,
    endLine: undefined,
    line: 1,
    url: 'http://example.com/test.scss'
  })
})

test('works with index map', () => {
  let root = parse('body {\nwidth:100%;\n}', {
    from: join(__dirname, 'a.css'),
    map: {
      prev: {
        sections: [
          {
            map: {
              mappings: 'AAAA;AACA;AACA;',
              sources: ['b.css'],
              sourcesContent: ['body {\nwidth:100%;\n}'],
              version: 3
            },
            offset: { column: 0, line: 0 }
          }
        ],
        version: 3
      }
    }
  })
  is((root as any).source.input.origin(1, 2).file, join(__dirname, 'b.css'))
})

test.run()
