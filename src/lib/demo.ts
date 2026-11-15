import { contractSize, parseSymbol, pipSize, SAMPLE_QUOTES, usdValue } from './forex'
import type { Trade } from './types'

/** Sinh lệnh mẫu cố định (không ngẫu nhiên thật) để xem thử giao diện. */
export function demoTrades(): Trade[] {
  let seed = 42
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const symbols = ['EURUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'XAUUSD', 'AUDUSD', 'GBPJPY']
  const setups = ['Breakout', 'Pullback', 'Range']
  const out: Trade[] = []
  let day = Date.UTC(2026, 5, 1)
  for (let i = 0; i < 90; i++) {
    day += Math.floor(rnd() * 2 + 0.6) * 86_400_000
    const dow = new Date(day).getUTCDay()
    if (dow === 6) day += 2 * 86_400_000
    if (dow === 0) day += 86_400_000
    const symbol = symbols[Math.floor(rnd() * symbols.length)]
    const info = parseSymbol(symbol)!
    const pip = pipSize(info)
    const side = rnd() > 0.45 ? 'buy' : 'sell'
    const dir = side === 'buy' ? 1 : -1
    const hour = 3 + Math.floor(rnd() * 18)
    const openTime = day + hour * 3_600_000 + Math.floor(rnd() * 60) * 60_000
    const slPips = 15 + Math.floor(rnd() * 25)
    // Phiên Âu–Mỹ thắng nhiều hơn một chút để biểu đồ có điều đáng xem.
    const win = rnd() < (hour >= 14 && hour < 19 ? 0.58 : 0.42)
    const movePips = win ? slPips * (1 + rnd() * 1.4) : -slPips * (0.5 + rnd() * 0.5)
    const openPrice = (usdValue(info.base, SAMPLE_QUOTES) / usdValue(info.quote, SAMPLE_QUOTES)) * (1 + (rnd() - 0.5) * 0.02)
    const volume = Math.round((0.05 + rnd() * 0.25) * 100) / 100
    const pipValue = contractSize(info) * pip * usdValue(info.quote, SAMPLE_QUOTES)
    const digits = pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5
    const round = (x: number) => Number(x.toFixed(digits))
    out.push({
      id: `demo:${i + 1}`,
      ticket: String(500000 + i),
      symbol, side, volume,
      openTime,
      closeTime: openTime + Math.floor((0.2 + rnd() * 9) * 3_600_000),
      openPrice: round(openPrice),
      closePrice: round(openPrice + dir * movePips * pip),
      sl: round(openPrice - dir * slPips * pip),
      tp: round(openPrice + dir * slPips * 2 * pip),
      commission: -Number((volume * 7).toFixed(2)),
      swap: rnd() > 0.8 ? -Number((volume * 3).toFixed(2)) : 0,
      profit: Number((movePips * pipValue * volume).toFixed(2)),
      source: 'demo',
      setup: setups[Math.floor(rnd() * setups.length)],
    })
  }
  return out
}
