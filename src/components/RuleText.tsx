/** Hiển thị bộ quy tắc dạng Markdown đơn giản (tiêu đề ##, gạch đầu dòng, đoạn văn). Không dùng innerHTML. */
export default function RuleText({ text }: { text: string }) {
  const blocks: { kind: 'h' | 'ul' | 'p'; lines: string[] }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    const h = line.match(/^#{1,4}\s+(.*)/)
    const li = line.match(/^\s*[-*•]\s+(.*)/)
    if (h) blocks.push({ kind: 'h', lines: [h[1]] })
    else if (li) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'ul') last.lines.push(li[1])
      else blocks.push({ kind: 'ul', lines: [li[1]] })
    } else blocks.push({ kind: 'p', lines: [line] })
  }
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
  return (
    <div className="rules">
      {blocks.map((b, i) =>
        b.kind === 'h' ? <h4 key={i}>{inline(b.lines[0])}</h4>
        : b.kind === 'ul' ? <ul key={i}>{b.lines.map((l, j) => <li key={j} className={/suy luận|cần xác nhận/i.test(l) ? 'guess' : ''}>{inline(l)}</li>)}</ul>
        : <p key={i}>{inline(b.lines[0])}</p>,
      )}
    </div>
  )
}
