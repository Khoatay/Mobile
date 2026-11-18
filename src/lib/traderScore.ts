/**
 * Đánh giá một tài khoản (thường là Only view) từ lịch sử lệnh: các chỉ số, bốn điểm (an toàn, tăng trưởng,
 * kỷ luật, FOMO) và kết luận "có đáng theo không". Mọi nhận định đều kèm bằng chứng là con số cụ thể.
 * Quy tắc cố định, không dùng AI, để kết quả giải thích được và lặp lại được.
 */
import { rMultiple } from './stats'
import { netOf, type Trade } from './types'

export interface Metrics {
  n: number
  wins: number
  losses: number
  winRate: number
  net: number
  avgWin: number
  avgLoss: number
  /** Lệnh thắng lớn nhất / nhỏ nhất, lệnh thua lớn nhất / nhỏ nhất (theo độ lớn khoản lỗ). */
  bestWin: number
  smallestWin: number
  worstLoss: number
  smallestLoss: number
  profitFactor: number
  expectancy: number
  /** Vốn: số dư hiện tại trừ lãi/lỗ trong kỳ, tức tiền đã bỏ vào (gồm nạp/rút). Đúng cả khi xem toàn bộ lịch sử. */
  startBalance: number
  growthPct: number
  maxDrawdown: number
  maxDrawdownPct: number
  worstLossPct: number
  maxLosingStreak: number
  slShare: number
  /** Lệnh lỗ vượt quá 1.15R (dời SL, gồng lỗ hoặc trượt giá lớn). */
  beyondSlShare: number
  avgHoldWinMs: number
  avgHoldLossMs: number
  /** Hệ số biến thiên của khối lượng lệnh: thấp là vào lot đều tay. */
  lotCv: number
  /** Tỷ lệ lệnh ngay sau một lệnh thua mà lot tăng từ 1.5 lần trở lên; 0 nếu không khác hẳn sau lệnh thắng (không phải gấp thếp). */
  martingaleShare: number
  /** Tỷ lệ lệnh mở trong 15 phút sau khi một lệnh thua đóng (trade gỡ). */
  revengeShare: number
  tradesPerDay: number
  /** Tỷ lệ ngày vào lệnh nhiều gấp đôi mức trung bình. */
  burstDayShare: number
  /** Tỷ lệ tuần có lãi. */
  greenWeekShare: number
  spanDays: number
}

export type Grade = 'good' | 'ok' | 'weak' | 'bad'
export interface Score { score: number; grade: Grade; label: string; reasons: string[] }
export interface Verdict { level: 'consider' | 'watch' | 'avoid' | 'unknown'; title: string; detail: string }
export interface Assessment { metrics: Metrics; safety: Score; growth: Score; discipline: Score; fomo: Score; verdict: Verdict; confidence: 'low' | 'medium' | 'high' }

const DAY = 86_400_000
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

export function computeMetrics(input: Trade[], balanceNow: number): Metrics {
  const trades = [...input].sort((a, b) => a.closeTime - b.closeTime)
  const nets = trades.map(netOf)
  const wins = nets.filter((x) => x > 0), losses = nets.filter((x) => x < 0)
  const net = nets.reduce((s, x) => s + x, 0)
  const startBalance = Math.max(1, balanceNow - net)

  let cum = 0, peak = 0, maxDd = 0, maxDdPct = 0, streak = 0, maxStreak = 0
  for (const x of nets) {
    cum += x
    peak = Math.max(peak, cum)
    maxDd = Math.max(maxDd, peak - cum)
    maxDdPct = Math.max(maxDdPct, (peak - cum) / (startBalance + peak))
    streak = x < 0 ? streak + 1 : 0
    maxStreak = Math.max(maxStreak, streak)
  }

  const withR = trades.map(rMultiple).filter((r): r is number => r != null)
  const hold = (pred: (x: number) => boolean) => mean(trades.filter((_, i) => pred(nets[i])).map((t) => t.closeTime - t.openTime))
  const vols = trades.map((t) => t.volume)
  const vMean = mean(vols)
  const lotCv = vMean > 0 ? Math.sqrt(mean(vols.map((v) => (v - vMean) ** 2))) / vMean : 0

  // Gấp thếp: tăng lot sau lệnh thua nhiều hơn hẳn so với sau lệnh thắng. So với sau lệnh thắng để không bắt nhầm
  // người chỉ vào lot thất thường; cần ít nhất 8 lần thua để so.
  let afterLoss = 0, biggerLoss = 0, afterWin = 0, biggerWin = 0, revenge = 0
  for (let i = 1; i < trades.length; i++) {
    const up = trades[i].volume >= trades[i - 1].volume * 1.5
    if (nets[i - 1] < 0) { afterLoss++; if (up) biggerLoss++ } else { afterWin++; if (up) biggerWin++ }
  }
  const lossUp = afterLoss ? biggerLoss / afterLoss : 0, winUp = afterWin ? biggerWin / afterWin : 0
  const martingale = afterLoss >= 8 && lossUp - winUp >= 0.25 ? lossUp : 0
  for (const t of trades) if (trades.some((p, j) => nets[j] < 0 && p.closeTime <= t.openTime && t.openTime - p.closeTime <= 15 * 60_000)) revenge++

  const byDay = new Map<string, number>()
  for (const t of trades) { const k = new Date(t.openTime).toISOString().slice(0, 10); byDay.set(k, (byDay.get(k) ?? 0) + 1) }
  const perDay = trades.length / Math.max(1, byDay.size)
  const burst = [...byDay.values()].filter((c) => c >= Math.max(4, perDay * 2)).length

  const byWeek = new Map<number, number>()
  trades.forEach((t, i) => { const w = Math.floor(t.closeTime / (7 * DAY)); byWeek.set(w, (byWeek.get(w) ?? 0) + nets[i]) })
  const weeks = [...byWeek.values()]

  const span = trades.length ? (trades[trades.length - 1].closeTime - trades[0].openTime) / DAY : 0
  const grossWin = wins.reduce((s, x) => s + x, 0), grossLoss = -losses.reduce((s, x) => s + x, 0)
  return {
    n: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    net,
    avgWin: mean(wins), avgLoss: losses.length ? -mean(losses) : 0,
    bestWin: wins.length ? Math.max(...wins) : 0,
    smallestWin: wins.length ? Math.min(...wins) : 0,
    worstLoss: losses.length ? -Math.min(...losses) : 0,
    smallestLoss: losses.length ? -Math.max(...losses) : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: trades.length ? net / trades.length : 0,
    startBalance,
    growthPct: net / startBalance,
    maxDrawdown: maxDd, maxDrawdownPct: maxDdPct,
    worstLossPct: losses.length ? -Math.min(...losses) / startBalance : 0,
    maxLosingStreak: maxStreak,
    slShare: trades.length ? trades.filter((t) => t.sl > 0).length / trades.length : 0,
    beyondSlShare: withR.length ? withR.filter((r) => r < -1.15).length / withR.length : 0,
    avgHoldWinMs: hold((x) => x > 0), avgHoldLossMs: hold((x) => x < 0),
    lotCv,
    martingaleShare: martingale,
    revengeShare: trades.length ? revenge / trades.length : 0,
    tradesPerDay: perDay,
    burstDayShare: byDay.size ? burst / byDay.size : 0,
    greenWeekShare: weeks.length ? weeks.filter((w) => w > 0).length / weeks.length : 0,
    spanDays: span,
  }
}

function grade(score: number, labels: [string, string, string, string]): Pick<Score, 'grade' | 'label'> {
  const g: Grade = score >= 75 ? 'good' : score >= 55 ? 'ok' : score >= 35 ? 'weak' : 'bad'
  return { grade: g, label: labels[['good', 'ok', 'weak', 'bad'].indexOf(g)] }
}

/** Đánh giá đầy đủ. `openRiskPct`: phần lỗ đang treo của lệnh mở so với số dư (số âm là đang lỗ). */
export function assess(trades: Trade[], balanceNow: number, openFloatingPct = 0, openWithoutSl = 0): Assessment {
  const m = computeMetrics(trades, balanceNow)
  const holdRatio = m.avgHoldWinMs > 0 ? m.avgHoldLossMs / m.avgHoldWinMs : 1

  // ---- An toàn: sụt giảm, lệnh thua lớn nhất, SL, gấp thếp, lỗ đang treo
  let s = 100
  const sr: string[] = []
  if (m.maxDrawdownPct > 0.3) { s -= 40; sr.push(`Từng sụt ${pct(m.maxDrawdownPct)} từ đỉnh: rất sâu.`) }
  else if (m.maxDrawdownPct > 0.15) { s -= 22; sr.push(`Từng sụt ${pct(m.maxDrawdownPct)} từ đỉnh: khá sâu.`) }
  else sr.push(`Sụt giảm lớn nhất ${pct(m.maxDrawdownPct, 1)} từ đỉnh: trong tầm kiểm soát.`)
  if (m.worstLossPct > 0.05) { s -= 20; sr.push(`Một lệnh thua mất tới ${pct(m.worstLossPct, 1)} tài khoản.`) }
  else if (m.worstLossPct > 0.02) { s -= 8; sr.push(`Lệnh thua lớn nhất mất ${pct(m.worstLossPct, 1)} tài khoản.`) }
  if (m.slShare < 0.5) { s -= 18; sr.push(`Chỉ ${pct(m.slShare)} số lệnh có stop loss.`) }
  if (m.martingaleShare > 0.2) { s -= 22; sr.push(`${pct(m.martingaleShare)} lần sau khi thua thì tăng lot từ 1.5 lần trở lên: dấu hiệu gấp thếp.`) }
  // Gấp thếp: lịch sử có thể trông đẹp cho tới chuỗi thua đủ dài để cháy tài khoản, nên chặn điểm ở mức rất rủi ro.
  if (m.martingaleShare > 0.3) { s = Math.min(s, 35); sr.push('Gấp thếp có thể cháy tài khoản chỉ sau một chuỗi thua dài, dù lịch sử đang có lãi.') }
  if (openFloatingPct < -0.1) { s -= 15; sr.push(`Lệnh đang mở lỗ ${pct(-openFloatingPct, 1)} số dư.`) }
  if (openWithoutSl > 0) { s -= 6; sr.push(`${openWithoutSl} lệnh đang mở không có stop loss.`) }
  const safety: Score = { score: clamp(s), ...grade(clamp(s), ['An toàn', 'Khá an toàn', 'Rủi ro cao', 'Rất rủi ro']), reasons: sr }

  // ---- Tăng trưởng: lãi theo %, profit factor, độ đều theo tuần
  let g = 50
  const gr: string[] = []
  const monthly = m.spanDays >= 7 ? m.growthPct / Math.max(1, m.spanDays / 30) : m.growthPct
  g += Math.max(-35, Math.min(30, monthly * 300))
  gr.push(`Lãi/lỗ ${m.growthPct >= 0 ? '+' : ''}${pct(m.growthPct, 1)} so với vốn${m.spanDays >= 30 ? `, khoảng ${monthly >= 0 ? '+' : ''}${pct(monthly, 1)} mỗi tháng` : ''}.`)
  if (m.profitFactor >= 1.5) { g += 12; gr.push(`Profit factor ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}: lãi gộp lớn hơn hẳn lỗ gộp.`) }
  else if (m.profitFactor < 1) { g -= 12; gr.push(`Profit factor ${m.profitFactor.toFixed(2)}: tổng lỗ lớn hơn tổng lãi.`) }
  if (m.greenWeekShare >= 0.6) { g += 8; gr.push(`${pct(m.greenWeekShare)} số tuần có lãi: tăng trưởng đều.`) }
  else if (m.greenWeekShare < 0.4) { g -= 8; gr.push(`Chỉ ${pct(m.greenWeekShare)} số tuần có lãi: kết quả thất thường.`) }
  if (monthly > 0.3) gr.push('Lãi quá nhanh thường đi kèm rủi ro lớn; xem kỹ điểm An toàn.')
  const growth: Score = { score: clamp(g), ...grade(clamp(g), ['Tăng trưởng tốt', 'Tăng trưởng khá', 'Tăng trưởng yếu', 'Đang thua lỗ']), reasons: gr }

  // ---- Kỷ luật: dùng SL, lot đều, cắt lỗ đúng kế hoạch, không gồng lỗ
  let d = 100
  const dr: string[] = []
  if (m.slShare >= 0.9) dr.push(`${pct(m.slShare)} số lệnh có stop loss.`)
  else { d -= (0.9 - m.slShare) * 60; dr.push(`${pct(1 - m.slShare)} số lệnh không đặt stop loss.`) }
  if (m.beyondSlShare > 0.15) { d -= 20; dr.push(`${pct(m.beyondSlShare)} lệnh có SL bị lỗ vượt quá stop loss ban đầu (dời SL hoặc gồng).`) }
  if (holdRatio > 1.5) { d -= 18; dr.push(`Giữ lệnh thua lâu gấp ${holdRatio.toFixed(1)} lần lệnh thắng: có dấu hiệu gồng lỗ.`) }
  else if (holdRatio < 0.8 && m.losses >= 5) dr.push('Cắt lệnh thua nhanh hơn lệnh thắng: tốt.')
  if (m.lotCv > 1) { d -= 18; dr.push('Khối lượng lệnh thay đổi rất thất thường.') }
  else if (m.lotCv < 0.5) dr.push('Khối lượng lệnh đều tay.')
  if (m.worstLoss > m.avgLoss * 4 && m.losses >= 5) { d -= 10; dr.push(`Lệnh thua lớn nhất gấp ${(m.worstLoss / m.avgLoss).toFixed(1)} lần lệnh thua trung bình.`) }
  const discipline: Score = { score: clamp(d), ...grade(clamp(d), ['Kỷ luật tốt', 'Khá kỷ luật', 'Thiếu kỷ luật', 'Rất thiếu kỷ luật']), reasons: dr }

  // ---- FOMO: điểm càng cao càng ít FOMO (để bốn điểm cùng chiều: cao là tốt)
  let f = 100
  const fr: string[] = []
  if (m.revengeShare > 0.5) { f -= 50; fr.push(`${pct(m.revengeShare)} lệnh mở trong 15 phút sau một lệnh thua: phần lớn là lệnh gỡ.`) }
  else if (m.revengeShare > 0.25) { f -= 35; fr.push(`${pct(m.revengeShare)} lệnh mở trong 15 phút sau một lệnh thua: hay vào lệnh gỡ.`) }
  else if (m.revengeShare > 0.12) { f -= 15; fr.push(`${pct(m.revengeShare)} lệnh mở ngay sau một lệnh thua.`) }
  else fr.push('Ít khi vào lệnh vội ngay sau lệnh thua.')
  if (m.burstDayShare > 0.15) { f -= 25; fr.push(`${pct(m.burstDayShare)} số ngày vào lệnh dồn dập (gấp đôi bình thường).`) }
  if (m.tradesPerDay > 10) { f -= 15; fr.push(`Trung bình ${m.tradesPerDay.toFixed(1)} lệnh mỗi ngày giao dịch.`) }
  if (m.martingaleShare > 0.2) { f -= 20; fr.push('Tăng lot sau khi thua.') }
  const fomo: Score = { score: clamp(f), ...grade(clamp(f), ['Không FOMO', 'Ít FOMO', 'Hay FOMO', 'FOMO nặng']), reasons: fr }

  const confidence: Assessment['confidence'] = m.n >= 60 && m.spanDays >= 60 ? 'high' : m.n >= 30 && m.spanDays >= 30 ? 'medium' : 'low'
  const verdict = decide(safety, growth, discipline, fomo, confidence, m)
  return { metrics: m, safety, growth, discipline, fomo, verdict, confidence }
}

function decide(safety: Score, growth: Score, discipline: Score, fomo: Score, confidence: Assessment['confidence'], m: Metrics): Verdict {
  if (m.n < 10) return { level: 'unknown', title: 'Chưa đủ dữ liệu', detail: `Mới có ${m.n} lệnh đóng trong khoảng này. Chọn khoảng thời gian dài hơn, hoặc theo dõi thêm.` }
  if (safety.score < 40) return { level: 'avoid', title: 'Không nên theo', detail: 'Rủi ro quá cao so với vốn: một chuỗi xấu có thể mất phần lớn tài khoản, kể cả khi đang lãi.' }
  if (growth.score < 40) return { level: 'avoid', title: 'Không nên theo', detail: 'Tài khoản đang không có lãi trong khoảng thời gian này.' }
  const all = [safety, growth, discipline, fomo]
  if (confidence !== 'low' && all.every((x) => x.score >= 65)) {
    return { level: 'consider', title: 'Đáng cân nhắc theo', detail: 'An toàn, có lãi, kỷ luật và ít FOMO. Nếu theo, bắt đầu bằng vốn nhỏ hoặc demo, đặt mức dừng lỗ cho cả việc copy, và xem lại mỗi tuần.' }
  }
  const weak = all.filter((x) => x.score < 55).map((x) => x.label.toLowerCase())
  return {
    level: 'watch',
    title: 'Theo dõi thêm',
    detail: confidence === 'low'
      ? `Kết quả có vẻ ${weak.length ? 'chưa ổn' : 'ổn'} nhưng số lệnh hoặc thời gian còn ít. Theo dõi thêm ít nhất 30 lệnh và 1 tháng trước khi quyết định.`
      : `Chưa đủ tốt ở: ${weak.join(', ') || 'một số mặt'}. Chờ thêm thời gian xem có cải thiện không.`,
  }
}
