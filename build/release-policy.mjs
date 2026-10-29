/** Static leakage checks, deliberately not a claim that browser code is secret. */
const proseSentinels = [
  'CVE-2021-44228',
  'CVE-2017-0144',
  'Первое подключение к порталу',
  'Сеанс новый: ESTABLISHED ещё не подтверждён',
  'Сотрудник открывает корпоративный портал из новой сети.',
]

export function inspectReleaseFile(fileName, contents) {
  const failures = []
  if (/\.(?:map|tsx?|md|json)$/i.test(fileName) || /(?:^|\/)(?:src|server|tests?)\//.test(fileName)) {
    failures.push(`${fileName}: source/map/data files must not be published with the release`)
  }
  if (!/\.(?:m?js|css|html)$/i.test(fileName)) return failures
  if (/sourceMappingURL\s*=|["']sourcesContent["']\s*:/.test(contents)) {
    failures.push(`${fileName}: embedded source map or source-map reference found`)
  }
  // These signatures catch the original readable answer table, including Vite's
  // ordinary minification of true/false to !0/!1. Runtime reversibility remains.
  if (/(?:\bmalicious\b|["']malicious["'])\s*:\s*(?:true|false|!\s*[01])\b/.test(contents)) {
    failures.push(`${fileName}: readable malicious verdict table found`)
  }
  if (/(?:\bexpectedRoute\b|["']expectedRoute["'])\s*:\s*["'](?:full|fast)["']/.test(contents)) {
    failures.push(`${fileName}: readable expected route table found`)
  }
  for (const sentinel of proseSentinels) {
    if (contents.includes(sentinel)) failures.push(`${fileName}: unobfuscated scenario/dossier text found (${sentinel})`)
  }
  return failures
}
