// Synthetic adapter, not a connection to a corporate directory or Keycloak Admin API.
export const legalEntities = [
  {code:'TEST-ECOM',name:'Тестовое юрлицо E-com',unit:'ecom'},
  {code:'TEST-FINTECH',name:'Тестовое юрлицо Fintech',unit:'fintech'},
  {code:'TEST-TECH',name:'Тестовое юрлицо Technologies',unit:'technologies'}
]
export const portalGroups = [
  {code:'merch-ecom',name:'Участники раздачи E-com (тест)',unit:'ecom'},
  {code:'merch-fintech',name:'Участники раздачи Fintech (тест)',unit:'fintech'},
  {code:'merch-tech',name:'Участники раздачи Technologies (тест)',unit:'technologies'}
]
export const portalPeople = [
  [1,'alice','Алина','Тестовая','TEST-ECOM',['merch-ecom']],
  [2,'boris','Борис','Тестовый','TEST-FINTECH',['merch-fintech']],
  [3,'outsider','Нет','Доступа','TEST-TECH',[]],
  [4,'blocked','Заблокирован','Тестовый','TEST-TECH',[],false],
  [5,'organizer','Организатор','Тестовый','TEST-ECOM',[]],
  [6,'fintech-admin','Админ Fintech','Тестовый','TEST-FINTECH',[]],
  [7,'dana','Дана','Портальная','TEST-ECOM',['merch-ecom']],
  [8,'elena','Елена','Портальная','TEST-FINTECH',['merch-fintech']]
].map(([i,username,firstName,lastName,legalEntity,groups,active=true])=>({
  subject:`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
  username,firstName,lastName,name:firstName+' '+lastName,email:username+'@example.invalid',legalEntity,groups,active,
  unit:legalEntities.find(x=>x.code===legalEntity).unit
}))
