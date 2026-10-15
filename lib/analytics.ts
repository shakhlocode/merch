import {tashkentToday} from '@/lib/fulfillment'
import {escapeCsv,toCsv} from '@/lib/utils'
import {displayColor,displaySize} from '@/lib/variant-labels'

export type ReportFilters={from:string;until:string;scope:string;mode:string;q:string}
export type StockRow={variant_id:string;product_id:string;product_name:string;placement:string;size:string|null;color:string|null;sku:string|null;total_qty:number;reserved_qty:number;available_qty:number;low_stock_threshold:number;alert:boolean}
export type IssuedItem={product_id:string;variant_id:string;product_name:string;size:string|null;color:string|null;sku:string|null;qty:number;orders:number}
export type IssuedDay={day:string;orders:number;qty:number}
export type IssuedLine=Omit<IssuedItem,'orders'>&{order_id:string;order_number:string;order_scope:string;received_at:string;received_by_name:string|null;received_day:string;fulfillment_mode:string}
export type HandoutReport={order_count:number;units:number;items:IssuedItem[];days:IssuedDay[];details:IssuedLine[]}
export const emptyHandout:HandoutReport={order_count:0,units:0,items:[],days:[],details:[]}
export const reportNames={items:'Выдачи по товарам и размерам',days:'Выдачи по дням',details:'Подробные выдачи',totals:'Сводка выдач',stock:'Текущие остатки',alerts:'Предупреждения об остатках'}
export type ReportName=keyof typeof reportNames
export function reportFilters(params:URLSearchParams):ReportFilters {
  const today=tashkentToday(),from=params.get('from')||today.slice(0,8)+'01',until=params.get('until')||today
  const validDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='1900-01-01'&&date<'9999-12-31'&&Number.isFinite(new Date(date+'T00:00:00Z').getTime())&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date
  if(!validDate(from)||!validDate(until)||from>until)throw new Error('Укажите корректный период: дата начала должна быть не позже даты окончания.')
  const scope=params.get('scope')||'all',mode=params.get('mode')||'all',q=(params.get('q')||'').trim()
  if(!['all','catalog','welcome'].includes(scope)||!['all','office','remote_shipping','remote_visit'].includes(mode)||q.length>200)throw new Error('Проверьте фильтры отчёта.')
  return {from,until,scope,mode,q}
}
export const formatReportTime=(value:string)=>new Date(value).toLocaleString('ru-RU',{timeZone:'Asia/Tashkent'})
export const scopeName=(value:string)=>value==='welcome'?'Welcome pack':'Каталог'
export const modeName=(value:string)=>value==='remote_shipping'?'Удалённая отправка':value==='remote_visit'?'Визит в Ташкент':'Офис'
export function analyticsCsv(name:ReportName,report:HandoutReport,stock:StockRow[],filters:ReportFilters) {
  let rows:Record<string,string>[]=[],headers:string[]=[]
  if(name==='items'){
    headers=['Товар','Размер','Цвет','SKU','Выдано штук','Заказов']
    rows=report.items.map(i=>({'Товар':i.product_name,'Размер':displaySize(i.size),'Цвет':displayColor(i.color),'SKU':i.sku||'','Выдано штук':String(i.qty),'Заказов':String(i.orders)}))
  }else if(name==='days'){
    headers=['Дата получения (Ташкент)','Заказов','Выдано штук']
    rows=report.days.map(d=>({'Дата получения (Ташкент)':d.day,'Заказов':String(d.orders),'Выдано штук':String(d.qty)}))
  }else if(name==='details'){
    headers=['Номер заказа','Раздел','Получение','Дата получения (Ташкент)','Выдал','Товар','Размер','Цвет','SKU','Количество']
    rows=report.details.map(i=>({'Номер заказа':i.order_number,'Раздел':scopeName(i.order_scope),'Получение':modeName(i.fulfillment_mode),'Дата получения (Ташкент)':formatReportTime(i.received_at),'Выдал':i.received_by_name||'Не указан','Товар':i.product_name,'Размер':displaySize(i.size),'Цвет':displayColor(i.color),'SKU':i.sku||'','Количество':String(i.qty)}))
  }else if(name==='totals'){
    headers=['Начало периода','Конец периода','Раздел','Получение','Поиск','Полученных заказов','Выдано штук']
    rows=[{'Начало периода':filters.from,'Конец периода':filters.until,'Раздел':filters.scope==='all'?'Все':scopeName(filters.scope),'Получение':filters.mode==='all'?'Все':modeName(filters.mode),'Поиск':filters.q,'Полученных заказов':String(report.order_count),'Выдано штук':String(report.units)}]
  }else{
    headers=['Снимок (Ташкент)','Товар','Размер','Цвет','SKU','На складе','Зарезервировано','Доступно','Порог предупреждения','Предупреждение']
    const snapshot=formatReportTime(new Date().toISOString())
    rows=stock.filter(s=>name!=='alerts'||s.alert).map(s=>({'Снимок (Ташкент)':snapshot,'Товар':s.product_name,'Размер':displaySize(s.size),'Цвет':displayColor(s.color),'SKU':s.sku||'','На складе':String(s.total_qty),'Зарезервировано':String(s.reserved_qty),'Доступно':String(s.available_qty),'Порог предупреждения':String(s.low_stock_threshold),'Предупреждение':s.alert?(s.available_qty===0?'Товар закончился':'Мало осталось'):''}))
  }
  return '\uFEFF'+(rows.length?toCsv(rows):headers.map(escapeCsv).join(';'))
}
