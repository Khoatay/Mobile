import { useState, type ReactNode } from 'react'
import { isWebUrl, PARTNERS, type PartnerLinks } from '../lib/partners'
import { PRESETS } from '../lib/prop'
import { Field } from '../components/Field'
import { usePersistent } from '../lib/store'

interface Guide { title: string; body: ReactNode }
interface Link { id: string; title: string; url: string; group: string }

const SECTIONS: { title: string; guides: Guide[] }[] = [
  {
    title: 'Dùng app này',
    guides: [
      {
        title: 'Bắt đầu trong 5 phút',
        body: (
          <ol>
            <li><strong>Tính lot</strong>: nhập số dư, % rủi ro và stop loss, app cho ra khối lượng lệnh. Cập nhật bảng tỷ giá trước khi dùng cho lệnh thật.</li>
            <li><strong>Nhật ký lệnh</strong>: kéo thả file báo cáo của MT5 hoặc MT4 vào, hoặc bấm “Nạp dữ liệu mẫu” để xem thử.</li>
            <li><strong>Thống kê</strong>: xem tỷ lệ thắng, profit factor, sụt giảm, và cặp tiền, phiên, ngày nào bạn trade tốt hay kém.</li>
            <li>Gắn <strong>setup</strong> cho từng lệnh trong Nhật ký để biết setup nào thực sự có lãi.</li>
          </ol>
        ),
      },
      {
        title: 'Đọc trang Thống kê thế nào',
        body: (
          <ul>
            <li><strong>Kỳ vọng mỗi lệnh</strong> là con số quan trọng nhất: trung bình mỗi lệnh bạn lãi hay lỗ bao nhiêu. Dương thì hệ thống có lợi thế.</li>
            <li><strong>Profit factor</strong> = tổng lãi chia tổng lỗ. Dưới 1 là đang lỗ; trên 1.5 là khá.</li>
            <li><strong>Sụt giảm lớn nhất</strong> cho biết giai đoạn tệ nhất đã mất bao nhiêu, để bạn chọn mức rủi ro mỗi lệnh chịu được.</li>
            <li>Dưới 30 lệnh thì mọi con số còn dao động mạnh, chưa nên kết luận.</li>
          </ul>
        ),
      },
      {
        title: 'Theo dõi luật quỹ',
        body: (
          <>
            <p>Chọn chương trình (FTMO, The5ers, TenTrade) hoặc tự nhập luật, điền vốn ban đầu và ngày bắt đầu. App hiện tiến độ mục tiêu, mức lỗ hôm nay và lỗ tổng so với giới hạn.</p>
            <p>Thông số mẫu chỉ để tham khảo. Luật của quỹ thay đổi theo thời gian và theo từng gói, nên hãy đối chiếu với điều khoản tài khoản của bạn. Khi chưa nối MT5, app chỉ thấy lệnh đã đóng, không thấy lệnh đang treo.</p>
          </>
        ),
      },
      {
        title: 'Thu chi đầu tư và Chia sẻ cộng đồng',
        body: (
          <ul>
            <li><strong>Thu chi đầu tư</strong>: ghi mọi khoản bỏ ra (phí quỹ, nạp tài khoản, TradingView, khoá học) và thu về (rút từ quỹ, backcom, affiliate) để biết tổng thể bạn đang lãi hay lỗ.</li>
            <li><strong>Chia sẻ cộng đồng</strong>: tạo banner và nội dung cho tín hiệu, kết quả lệnh, hoặc thống kê theo kỳ; tải ảnh về hoặc gửi thẳng lên nhóm Telegram.</li>
            <li>Đặt tên thương hiệu, màu và link giới thiệu ở trang <strong>Cá nhân hoá</strong>.</li>
          </ul>
        ),
      },
    ],
  },
  {
    title: 'Kết nối',
    guides: [
      {
        title: 'Kết nối MT5 (xem nhiều tài khoản)',
        body: (
          <ol>
            <li>Cần máy Windows, Python 3.10 trở lên, và mỗi tài khoản một bản MT5 cài ở thư mục riêng.</li>
            <li>Mở cửa sổ lệnh trong thư mục <code>bridge</code>, chạy <code>pip install -r requirements.txt</code>.</li>
            <li>Sao chép <code>config.example.json</code> thành <code>config.json</code>. Với mỗi tài khoản, điền số tài khoản, mật khẩu view (investor), tên máy chủ và đường dẫn tới <code>terminal64.exe</code>.</li>
            <li>Chạy <code>python bridge.py</code>. Góc dưới bên trái app sẽ báo số tài khoản đã nối.</li>
            <li>Vào trang <strong>Tài khoản</strong> và bấm “Đưa lịch sử mọi tài khoản vào Nhật ký”.</li>
          </ol>
        ),
      },
      {
        title: 'Lấy mật khẩu view (investor) ở đâu',
        body: <p>Trong MT5: menu Tools → Options → tab Server → Change, chọn “Change investor (read only) password”. Với tài khoản quỹ, mật khẩu này thường có sẵn trong email cấp tài khoản hoặc trang quản lý của quỹ. Mật khẩu view chỉ cho xem, không đặt hay đóng lệnh được.</p>,
      },
      {
        title: 'Kết nối Telegram (đọc kênh và gửi bài)',
        body: (
          <ol>
            <li>Vào my.telegram.org, đăng nhập, chọn “API development tools”, tạo ứng dụng để lấy <code>api_id</code> và <code>api_hash</code>. Điền vào <code>config.json</code>.</li>
            <li>Chạy <code>python bridge.py login</code>, nhập số điện thoại và mã xác nhận. Lệnh này in ra tên các kênh, nhóm bạn đang tham gia.</li>
            <li>Chép tên kênh muốn đọc vào <code>channels</code>, và tên nhóm cộng đồng muốn gửi bài vào <code>post_targets</code>.</li>
            <li>Chạy lại <code>python bridge.py</code>.</li>
          </ol>
        ),
      },
      {
        title: 'TradingView',
        body: <p>App chưa kết nối với TradingView. Hiện tại bạn phân tích trên TradingView rồi nhập giá vào, stop loss, take profit sang trang Tính lot, phiếu vào lệnh, hoặc trang Chia sẻ. Phí TradingView ghi ở trang Thu chi đầu tư.</p>,
      },
    ],
  },
  {
    title: 'Giao dịch cơ bản',
    guides: [
      {
        title: 'Pip, lot và giá trị pip',
        body: (
          <ul>
            <li><strong>Pip</strong> là bước giá chuẩn: 0.0001 với đa số cặp, 0.01 với cặp có JPY. App tính vàng theo 0.1.</li>
            <li><strong>1 lot</strong> = 100.000 đơn vị tiền cơ sở (vàng: 100 oz). 0.01 lot là mức nhỏ nhất ở đa số broker.</li>
            <li>Với cặp kết thúc bằng USD, 1 lot lãi lỗ khoảng 10 USD mỗi pip. Cặp khác phải quy đổi; trang Tính lot làm việc đó.</li>
          </ul>
        ),
      },
      {
        title: 'Quản lý rủi ro: chọn khối lượng từ stop loss',
        body: (
          <>
            <p>Thứ tự đúng là: chọn điểm stop loss theo phân tích trước, rồi mới tính khối lượng sao cho nếu chạm stop loss bạn chỉ mất một phần nhỏ, cố định của tài khoản. Nhiều người dùng 0.5% đến 1% mỗi lệnh.</p>
            <p>Ví dụ: tài khoản 10.000 USD, rủi ro 1% là 100 USD. Stop loss 20 pip trên EURUSD, mỗi pip 10 USD cho 1 lot, vậy khối lượng là 100 ÷ (20 × 10) = 0.5 lot.</p>
            <p>Với mức 1% mỗi lệnh, thua 10 lệnh liên tiếp mất khoảng 10% tài khoản. Với 5% mỗi lệnh, cùng chuỗi đó mất khoảng 40%.</p>
          </>
        ),
      },
      {
        title: 'Tỷ lệ R:R và tỷ lệ thắng',
        body: (
          <>
            <p>R:R là phần thưởng kỳ vọng so với rủi ro. R:R 1:2 nghĩa là chấp nhận lỗ 1 để có cơ hội lãi 2.</p>
            <p>Hai con số đi cùng nhau: với R:R 1:2 bạn chỉ cần thắng trên 34% số lệnh là có lãi; với R:R 1:1 cần trên 50%. Tỷ lệ thắng cao mà R:R thấp vẫn có thể lỗ.</p>
          </>
        ),
      },
      {
        title: 'Các phiên giao dịch',
        body: <p>Thị trường forex chạy gần như liên tục từ thứ Hai đến thứ Sáu, qua ba phiên chính: Á, Âu, Mỹ. Khoảng thời gian phiên Âu và phiên Mỹ cùng mở thường sôi động nhất, spread thấp nhất. Trang Thống kê cho biết bạn trade tốt ở phiên nào.</p>,
      },
      {
        title: 'Thi quỹ: vì sao người ta rớt',
        body: (
          <ul>
            <li>Vi phạm giới hạn lỗ trong ngày do vào quá nhiều lệnh sau khi thua, hoặc do khối lượng quá lớn.</li>
            <li>Quên rằng quỹ tính cả lệnh đang treo, không chỉ lệnh đã đóng.</li>
            <li>Giữ lệnh qua tin mạnh. Xem trang Tin tức trước mỗi phiên.</li>
            <li>Tăng rủi ro để “về đích” khi gần đạt mục tiêu.</li>
          </ul>
        ),
      },
    ],
  },
]

/** Lấy mã video nếu là link YouTube, để nhúng trình phát. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null
    if (u.hostname.endsWith('youtube.com')) return u.searchParams.get('v') ?? (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null)
  } catch { /* không phải URL */ }
  return null
}


function PartnerButton({ id, links, label }: { id: string; links?: PartnerLinks; label: string }) {
  const p = PARTNERS.find((x) => x.id === id)!
  const v = links?.[id]
  if (!v?.url) return null
  return (
    <span className="partner-link">
      <a className="button primary" href={v.url} target="_blank" rel="noopener noreferrer">{label}</a>
      {v.code && <span className="chip">Mã: {v.code}</span>}
      <span className="muted small">Link giới thiệu cho {p.name}</span>
    </span>
  )
}

const FUND_INFO: Record<string, { intro: string; presets: string[] }> = {
  ftmo: { intro: 'Quỹ lâu năm, phổ biến nhất. Có gói 2 bước (Challenge rồi Verification) và gói 1 bước.', presets: ['ftmo-2s-1', 'ftmo-2s-2', 'ftmo-1s'] },
  the5ers: { intro: 'Nhiều chương trình khác nhau: High Stakes 2 bước, Hyper Growth 1 bước, Bootcamp 3 bước giá rẻ.', presets: ['5ers-hs-1', '5ers-hs-2', '5ers-hg', '5ers-bc'] },
  tentrade: { intro: 'Quỹ mới hơn, gói TenExpress 1 bước với giới hạn lỗ tổng rộng hơn.', presets: ['ten-express'] },
}

function FundRules({ ids }: { ids: string[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Chương trình</th><th className="num">Mục tiêu</th><th className="num">Lỗ ngày</th><th className="num">Lỗ tổng</th><th>Kiểu lỗ tổng</th><th className="num">Ngày tối thiểu</th></tr></thead>
        <tbody>
          {ids.map((id) => {
            const p = PRESETS.find((x) => x.id === id)!
            const r = p.rules
            return (
              <tr key={id}>
                <td>{p.name}</td>
                <td className="num">{r.targetPct}%</td>
                <td className="num">{r.dailyLossPct ? `${r.dailyLossPct}%${r.dailyBase === 'dayStart' ? ' (đầu ngày)' : ''}` : 'Không'}</td>
                <td className="num">{r.maxLossPct}%</td>
                <td>{r.maxLossType === 'trailing' ? 'Trailing' : 'Cố định'}</td>
                <td className="num">{r.minDays || 'Không'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function fundSection(links?: PartnerLinks): { title: string; guides: Guide[] } {
  return {
    title: 'Quỹ (prop firm)',
    guides: [
      {
        title: 'Quỹ hoạt động thế nào',
        body: (
          <ol>
            <li><strong>Mua bài thi (challenge)</strong>: trả một khoản phí để nhận tài khoản thi, ví dụ 100.000 USD vốn ảo.</li>
            <li><strong>Vượt vòng</strong>: đạt mục tiêu lãi mà không chạm giới hạn lỗ trong ngày và giới hạn lỗ tổng, đủ số ngày giao dịch tối thiểu. Gói 2 bước phải qua hai vòng.</li>
            <li><strong>Nhận tài khoản cấp vốn</strong>: giao dịch tiếp với cùng luật lỗ (thường không còn mục tiêu lãi).</li>
            <li><strong>Rút lợi nhuận (payout)</strong>: quỹ chia phần lớn lợi nhuận cho bạn theo tỷ lệ của từng gói; nhiều quỹ hoàn lại phí thi ở lần rút đầu.</li>
            <li><strong>Vi phạm luật</strong> ở bất kỳ bước nào là mất tài khoản, phải mua bài thi mới.</li>
          </ol>
        ),
      },
      {
        title: 'Hiểu đúng giới hạn lỗ',
        body: (
          <ul>
            <li><strong>Lỗ trong ngày</strong> tính theo equity (gồm cả lệnh đang treo), không chỉ lệnh đã đóng. Ngày reset theo giờ máy chủ của quỹ.</li>
            <li><strong>Tính trên vốn ban đầu</strong> (FTMO): giới hạn cố định, ví dụ 5% của 100.000 là 5.000 USD mỗi ngày. <strong>Tính trên số dư đầu ngày</strong> (The5ers): giới hạn đổi theo số dư.</li>
            <li><strong>Lỗ tổng cố định</strong>: sàn số dư không đổi, ví dụ 90.000 USD. <strong>Trailing</strong>: sàn đi lên theo đỉnh số dư cuối ngày, nên lãi xong rồi lỗ lại vẫn có thể vi phạm.</li>
            <li>Trang <strong>Quỹ</strong> tính sẵn mọi thứ này cho từng tài khoản và báo còn được lỗ bao nhiêu hôm nay.</li>
          </ul>
        ),
      },
      ...PARTNERS.filter((p) => p.kind === 'prop').map((p) => ({
        title: p.name,
        body: (
          <>
            <p>{FUND_INFO[p.id]?.intro}</p>
            {FUND_INFO[p.id] && <FundRules ids={FUND_INFO[p.id].presets} />}
            <p className="muted small">Thông số tổng hợp từ các trang đánh giá bên thứ ba, có thể đã thay đổi. Luôn đọc điều khoản trên trang của quỹ trước khi mua.</p>
            <PartnerButton id={p.id} links={links} label={`Mua bài thi ${p.name}`} />
          </>
        ),
      })),
      {
        title: 'Cách vận hành tài khoản quỹ trong app',
        body: (
          <ol>
            <li>Ở trang <strong>Tài khoản</strong>, thêm tài khoản quỹ bằng mật khẩu view, đặt vai trò <strong>Quỹ</strong>, broker là tên quỹ và giai đoạn (Vòng 1, Vòng 2, Đã cấp vốn).</li>
            <li>App tự chọn chương trình và cỡ tài khoản; kiểm tra lại cho đúng gói bạn mua.</li>
            <li>Mỗi ngày trước khi vào lệnh, xem <strong>Còn được lỗ hôm nay</strong>. Phiếu vào lệnh tự chặn lệnh có khoản lỗ vượt mức này.</li>
            <li>Đặt rủi ro mỗi lệnh sao cho thua liền 3–4 lệnh vẫn chưa chạm giới hạn ngày.</li>
          </ol>
        ),
      },
    ],
  }
}

function brokerSection(links?: PartnerLinks): { title: string; guides: Guide[] } {
  return {
    title: 'Sàn giao dịch',
    guides: [
      {
        title: 'Exness',
        body: (
          <>
            <p>Hợp người mới: nạp ít, có tài khoản cent để tập với tiền nhỏ, rút nạp nhanh. Có nhiều loại tài khoản (Standard, Raw Spread, Zero, Pro) khác nhau ở spread và phí.</p>
            <PartnerButton id="exness" links={links} label="Mở tài khoản Exness" />
          </>
        ),
      },
      {
        title: 'IC Markets',
        body: (
          <>
            <p>Hợp scalper, người chạy EA và copy trade: tài khoản Raw spread thấp, tính phí theo lot. Cần số vốn ban đầu cao hơn.</p>
            <PartnerButton id="icmarkets" links={links} label="Mở tài khoản IC Markets" />
          </>
        ),
      },
    ],
  }
}

export default function Guides({ links: partnerLinks }: { links?: PartnerLinks }) {
  const sections = [SECTIONS[0], SECTIONS[1], fundSection(partnerLinks), brokerSection(partnerLinks), SECTIONS[2]]
  const [links, setLinks] = usePersistent<Link[]>('fx.links', [])
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [group, setGroup] = useState('Video hướng dẫn')
  const [err, setErr] = useState('')
  const groups = [...new Set(links.map((l) => l.group))]

  function add() {
    if (!title.trim() || !isWebUrl(url.trim())) { setErr('Cần tiêu đề và một đường link bắt đầu bằng http:// hoặc https://'); return }
    setLinks([...links, { id: `l${Date.now()}`, title: title.trim(), url: url.trim(), group: group.trim() || 'Khác' }])
    setTitle(''); setUrl(''); setErr('')
  }

  return (
    <>
      <h1>Hướng dẫn</h1>
      {sections.map((s) => (
        <section key={s.title} className="card">
          <h3>{s.title}</h3>
          {s.guides.map((g) => (
            <details key={g.title} className="guide">
              <summary>{g.title}</summary>
              {g.body}
            </details>
          ))}
        </section>
      ))}

      <section className="card">
        <h3>Bài viết và video của bạn</h3>
        <p className="muted small">Thêm link bài viết, video YouTube hay tài liệu của riêng bạn để dùng lại hoặc gửi cho cộng đồng. Video YouTube được phát ngay tại đây.</p>
        <div className="prop-form">
          <Field label="Tiêu đề"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Đường link"><input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
          <Field label="Nhóm">
            <input list="link-groups" value={group} onChange={(e) => setGroup(e.target.value)} />
            <datalist id="link-groups">{['Video hướng dẫn', 'Bài viết', 'Kiến thức giao dịch', ...groups].map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
        </div>
        <div className="actions" style={{ marginTop: 12 }}><button className="primary" onClick={add}>Thêm</button></div>
        {err && <p className="notice bad">⚠ {err}</p>}
        {groups.map((g) => (
          <div key={g}>
            <h3 style={{ marginTop: 18 }}>{g}</h3>
            {links.filter((l) => l.group === g).map((l) => {
              const yt = youtubeId(l.url)
              return (
                <details key={l.id} className="guide">
                  <summary>{l.title}</summary>
                  {yt && <iframe className="video" src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`} title={l.title} allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />}
                  <p><a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a></p>
                  <button className="ghost danger" onClick={() => setLinks(links.filter((x) => x.id !== l.id))}>Xoá</button>
                </details>
              )
            })}
          </div>
        ))}
      </section>
    </>
  )
}
