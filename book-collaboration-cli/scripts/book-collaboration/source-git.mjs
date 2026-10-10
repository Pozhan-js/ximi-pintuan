import { execFileSync } from 'node:child_process'
const clean = (value, max) => value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max)

/** File history is attribution of the source file, never inferred ownership of a requirement. */
export function sourceGitReader(root) {
  const cache = new Map()
  const files = new Map()
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 2_100_000, stdio: ['ignore', 'pipe', 'pipe'] })
  const format = '%H%x00%an%x00%cn%x00%cI%x00%s%x00'
  const parse = output => {
    const fields = output.trim().split('\0')
    const commits = []
    for (let i = 0; i + 4 < fields.length; i += 5) {
      const sha = fields[i].trim()
      if (!/^[a-f0-9]{40}$/.test(sha) || !Number.isFinite(Date.parse(fields[i + 3]))) throw new Error('Git metadata invalid')
      commits.push({ sha, author: clean(fields[i + 1], 120), committer: clean(fields[i + 2], 120), committedAt: new Date(fields[i + 3]).toISOString(), subject: clean(fields[i + 4], 300) })
    }
    return commits
  }
  return (path, fix, entryTitle) => {
    const key = JSON.stringify([path, entryTitle || ''])
    const scope = entryTitle ? 'record' : 'file'
    if (!cache.has(key)) {
      try {
        let history
        if (entryTitle) {
          if (!files.has(path)) files.set(path, run('show', `HEAD:${path}`).split('\n'))
          const lines = files.get(path)
          const matches = lines.flatMap((line, i) => line.trim() === `"topic": ${JSON.stringify(entryTitle)},` ? [i] : [])
          if (matches.length !== 1) throw new Error('Record not uniquely committed')
          const index = matches[0]
          const indent = lines[index].match(/^ */)[0].slice(2)
          let start = index, end = index
          while (start >= 0 && lines[start] !== indent + '{') start--
          while (end < lines.length && ![indent + '}', indent + '},'].includes(lines[end])) end++
          if (start < 0 || end === lines.length) throw new Error('Record range unavailable')
          history = parse(run('log', '-3', '--no-patch', `--format=${format}`, '-L', `${start + 1},${end + 1}:${path}`))
        } else history = parse(run('log', '-3', `--format=${format}`, 'HEAD', '--', path))
        cache.set(key, { scope, history, dirty: !!run('status', '--porcelain', '--', path).trim(), status: history.length ? 'available' : 'unavailable' })
      } catch { cache.set(key, { scope, history: [], dirty: false, status: 'unavailable' }) }
    }
    const result = { ...cache.get(key) }
    if (typeof fix === 'string' && /^[a-f0-9]{7,40}$/i.test(fix)) {
      try { result.fix = parse(run('show', '-s', `--format=${format}`, `${fix}^{commit}`))[0] } catch { /* No guessed fix author. */ }
    }
    return result
  }
}
