
import ShopAnchor from '@/components/ShopAnchor'
import Link from '@/components/ShopLink'
import { shopRedirect } from '@/lib/shop-redirect'
import AdminShell from '@/components/AdminShell'
import {createClient} from '@/lib/supabase/server'
import {requireAdmin} from '@/lib/admin'
import {reportFilters,formatReportTime,scopeName,modeName,type HandoutReport,type StockRow,type ReportName} from '@/lib/analytics'
import {displayColor,displaySize} from '@/lib/variant-labels'

export default async function AnalyticsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const redirect: (path: string) => never = await shopRedirect()

  const supabase=await createClient(),access=await requireAdmin(supabase)
  if(!access.ok){if(access.status===401)redirect('/login');return <main className="page-error">Аналитика доступна только активным администраторам.</main>}
  const params=new URLSearchParams()
  for(const [key,value] of Object.entries(await searchParams))if(typeof value==='string')params.set(key,value)
  let filters
  try{filters=reportFilters(params)}catch(e){return <AdminShell adminEmail={access.employee.email} title="Аналитика"><p role="alert">{(e as Error).message}</p><Link href="/admin/analytics">Сбросить фильтры</Link></AdminShell>}
  const [issued,currentStock]=await Promise.all([
    supabase.rpc('admin_handout_report',{p_from:filters.from,p_until:filters.until,p_scope:filters.scope,p_mode:filters.mode,p_query:filters.q}),
    supabase.rpc('admin_stock_report',{p_query:filters.q}),
  ])
  if(issued.error||currentStock.error)return <AdminShell adminEmail={access.employee.email} title="Аналитика"><p role="alert">Не удалось загрузить отчёты. Обновите страницу.</p></AdminShell>
  const report=issued.data as HandoutReport,stock=currentStock.data as StockRow[],alerts=stock.filter(s=>s.alert)
  const query=new URLSearchParams(filters)
  const {data:unitId}=await supabase.rpc('current_unit_id',{})
  const csv=(name:ReportName)=><ShopAnchor className="ao-light-btn" href={'/api/admin/analytics?'+new URLSearchParams({...Object.fromEntries(query),report:name})}>Экспорт CSV</ShopAnchor>
  return <AdminShell adminEmail={access.employee.email} title="Аналитика" stockAlertCount={alerts.length}>
    <section className="analytics-page">
      <form method="get" action="/admin/analytics" className="analytics-filters">
        <input type="hidden" name="unit" value={unitId||''}/>
        <label>С даты<input name="from" type="date" defaultValue={filters.from} required className="ap-input"/></label>
        <label>По дату включительно<input name="until" type="date" defaultValue={filters.until} required className="ap-input"/></label>
        <label>Раздел выдачи<select name="scope" defaultValue={filters.scope} className="ap-input"><option value="all">Все разделы</option><option value="catalog">Каталог</option><option value="welcome">Welcome pack</option></select></label>
        <label>Способ получения<select name="mode" defaultValue={filters.mode} className="ap-input"><option value="all">Все способы</option><option value="office">Офис</option><option value="remote_visit">Визит в Ташкент</option><option value="remote_shipping">Удалённая отправка</option></select></label>
        <label>Товар, размер, цвет или SKU<input name="q" type="search" maxLength={200} defaultValue={filters.q} className="ap-input"/></label>
        <button type="submit" className="ao-save-btn">Применить</button>
      </form>
      <p>Период считается по фактической дате получения, по времени Ташкента. Включены только заказы со статусом «Получен». Поиск учитывает только совпавшие позиции заказа.</p>
      <section className="analytics-section">
        <header><h2>Сводка выдач</h2>{csv('totals')}</header>
        <div className="analytics-summary"><div><span>Полученных заказов</span><b>{report.order_count}</b></div><div><span>Выдано штук</span><b>{report.units}</b></div><div><span>Товаров / размеров в отчёте</span><b>{report.items.length}</b></div></div>
      </section>
      <section className="analytics-section">
        <header><h2>Выдано по товарам и размерам</h2>{csv('items')}</header>
        <ReportLimit count={report.items.length}/>
        <div className="analytics-table-wrap"><table><thead><tr><th>Товар</th><th>Размер</th><th>Цвет</th><th>SKU</th><th>Выдано, шт.</th><th>Заказов</th></tr></thead><tbody>{report.items.slice(0,200).map((i,index)=><tr key={index}><td>{i.product_name}</td><td>{displaySize(i.size)}</td><td>{displayColor(i.color)}</td><td>{i.sku||'—'}</td><td>{i.qty}</td><td>{i.orders}</td></tr>)}</tbody></table></div>
        {!report.items.length&&<p>За выбранный период выдач не найдено.</p>}
      </section>
      <section className="analytics-section">
        <header><h2>Выдачи по дням</h2>{csv('days')}</header><ReportLimit count={report.days.length}/>
        <div className="analytics-table-wrap"><table><thead><tr><th>Дата получения</th><th>Заказов</th><th>Выдано, шт.</th></tr></thead><tbody>{report.days.slice(0,200).map(d=><tr key={d.day}><td>{d.day}</td><td>{d.orders}</td><td>{d.qty}</td></tr>)}</tbody></table></div>
        {!report.days.length&&<p>За выбранный период выдач не найдено.</p>}
      </section>
      <section className="analytics-section">
        <header><h2>Подробные выдачи</h2>{csv('details')}</header><ReportLimit count={report.details.length}/>
        <div className="analytics-table-wrap"><table><thead><tr><th>Заказ</th><th>Получен (Ташкент)</th><th>Раздел / получение</th><th>Выдал</th><th>Товар</th><th>Размер / цвет</th><th>SKU</th><th>Шт.</th></tr></thead><tbody>{report.details.slice(0,200).map((i,index)=><tr key={index}><td><Link href={'/admin/orders?q='+encodeURIComponent(i.order_number)}>{i.order_number}</Link></td><td>{formatReportTime(i.received_at)}</td><td>{scopeName(i.order_scope)} · {modeName(i.fulfillment_mode)}</td><td>{i.received_by_name||'Не указан'}</td><td>{i.product_name}</td><td>{displaySize(i.size)} · {displayColor(i.color)}</td><td>{i.sku||'—'}</td><td>{i.qty}</td></tr>)}</tbody></table></div>
        {!report.details.length&&<p>За выбранный период выдач не найдено.</p>}
      </section>
      <p>Остатки ниже показаны на текущий момент по всем действующим товарам. На них влияет только поиск; выбранные период, раздел выдачи и способ получения относятся к выдачам.</p>
      <section className="analytics-section">
        <header><h2>Предупреждения об остатках</h2>{csv('alerts')}</header>
        <p>Порог по умолчанию — 5 доступных штук. Изменить его для размера и цвета можно в «Товарах», в редакторе товара.</p>
        <StockTable rows={alerts}/>
        {!alerts.length&&<p>Предупреждений нет.</p>}
      </section>
      <section className="analytics-section">
        <header><h2>Текущие остатки</h2>{csv('stock')}</header>
        <StockTable rows={stock}/>
        {!stock.length&&<p>Действующих вариантов товаров не найдено.</p>}
      </section>
    </section>
  </AdminShell>
}
function ReportLimit({count}:{count:number}){return count>200?<p>Показаны первые 200 из {count} строк. CSV содержит весь отчёт.</p>:null}
function StockTable({rows}:{rows:StockRow[]}){return <><ReportLimit count={rows.length}/><div className="analytics-table-wrap"><table><thead><tr><th>Товар</th><th>Размер / цвет</th><th>SKU</th><th>На складе</th><th>Зарезервировано</th><th>Доступно</th><th>Порог</th><th>Предупреждение</th></tr></thead><tbody>{rows.slice(0,200).map(s=><tr key={s.variant_id}><td><Link href={'/admin/products?q='+encodeURIComponent(s.sku||s.product_name)}>{s.product_name}</Link></td><td>{displaySize(s.size)} · {displayColor(s.color)}</td><td>{s.sku||'—'}</td><td>{s.total_qty}</td><td>{s.reserved_qty}</td><td>{s.available_qty}</td><td>{s.low_stock_threshold}</td><td>{s.alert?<strong className="stock-alert-note">{s.available_qty===0?'Товар закончился':`Осталось ${s.available_qty} шт.`}</strong>:'Достаточно'}</td></tr>)}</tbody></table></div></>}
