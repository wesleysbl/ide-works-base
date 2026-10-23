"""Menções: Chrome com API simulada, sem sessões nem notificações reais."""
import json, os, re, subprocess, uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
fixture=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {detail,row,sessaoDe} from './scripts/e2e/comum.mjs';console.log(JSON.stringify({detail,row,session:sessaoDe()}))"],cwd=ROOT,text=True))
base=os.environ.get('E2E_BASE','http://127.0.0.1:8093')
author='00000000-0000-0000-0000-000000000001';target='00000000-0000-0000-0000-000000000002'
list_id='00000000-0000-0000-0000-000000000010'
people=[{'id':author,'name':'Wesley'},{'id':target,'name':'Hélia Assis'}]
task=fixture['detail'];task.update(id=fixture['row']['id'],title='Card de menções',description='Antes. Depois.',listId=list_id,listName='Sabor Doce',attachments=[],comments=[],checklists=[])
status={'id':'st1','name':'Em andamento','type':'open','color':None,'sortOrder':0}
task['statuses']=[status];task['statusId']='st1'
board={'header':{k:task.get(k) for k in ['listId','listName','folderId','folderName','spaceId','spaceName','categoryName','statusSetName','inheritedFrom']},'statuses':[status],'tasks':[],
 'availableTags':[],'columnTotals':{'st1':0},'columnMatched':{'st1':0},'perColumn':50,'assigneeOptions':[],'unassignedTasks':0,'filter':{'texto':'','responsavel':None}}
posts=[];created=[];notices=[];candidates=[];seen=set()
def notify(body, comment=None):
 if target not in body:return
 notices.append({'key':'mention:'+str(uuid.uuid4()),'tipo':'mencao','taskId':task['id'],'taskTitle':task['title'],'listId':list_id,'listName':'Sabor Doce','actorName':'Wesley','commentId':comment,'clientName':None,'occurredAt':'2026-09-11T18:00:00Z','dueOn':None,'automationName':None,'fromListName':None,'toListName':None,'toStatusName':None,'seen':False})
def handler(route, user):
 req=route.request;p=urlparse(req.url).path
 if not p.startswith('/api/'):
  if req.url.startswith(base):route.continue_()
  else:route.abort()
  return
 data={'ok':True,'rows':[],'total':0,'unread':0,'notices':[]}
 if p=='/api/auth/me':data={**fixture['session'],'userId':user}
 elif p.startswith('/api/board/tree'):data={'ok':True,'spaces':[],'companies':[]}
 elif p=='/api/team':data={'ok':True,'team':[],'me':user}
 elif p=='/api/catalogs':data={'ok':True,'categories':[{'id':'c1','name':'Ide','isDefault':True}],'plans':[],'tags':[]}
 elif p=='/api/board/mentionable':candidates.append(req.url);data={'ok':True,'people':people}
 elif p.startswith('/api/board/notices'):
  if p.endswith('/read'):
   b=req.post_data_json
   if b['read']:seen.add(b['key'])
   else:seen.discard(b['key'])
  mine=[{**n,'seen':n['key'] in seen} for n in notices] if user==target else []
  unread=sum(not n['seen'] for n in mine)
  data={'ok':True,'unread':unread,'notices':{'notices':[n for n in mine if 'vistos=1' in req.url or not n['seen']], 'unread':unread,'capped':False}}
 elif p==f'/api/board/lists/{list_id}/tasks' and req.method=='POST':
  b=req.post_data_json;created.append(b);newid=str(uuid.uuid4())
  board['tasks'].append({**fixture['row'],'id':newid,'title':b['title'],'statusId':'st1','previewAttachmentId':None})
  board['columnTotals']['st1']+=1;board['columnMatched']['st1']+=1
  data={'ok':True,'id':newid,'task':{**task,'id':newid,'title':b['title']}}
 elif p==f'/api/board/lists/{list_id}':data={'ok':True,'board':board}
 elif p.startswith('/api/board/tasks/'):
  if p.endswith('/comments') and req.method=='POST':
   b=req.post_data_json;posts.append(b);cid=str(uuid.uuid4())
   task['comments'].append({'id':cid,'parentId':b.get('parentId'),'body':b['body'],'author':{'id':author,'name':'Wesley'},'mine':user==author,'createdAt':'2026-09-11T18:00:00Z','editedAt':None,'replyCount':0,'replies':[]})
   task['progress']['commentCount']=len(task['comments']);notify(b['body'],cid)
  elif req.method=='PATCH':task.update(req.post_data_json)
  data={'ok':True,'id':task['id'],'task':task,'storage':{'ready':True,'variable':''}}
 elif p.startswith('/api/board/comments/') and req.method=='PATCH':
  c=next(c for c in task['comments'] if c['id']==p.split('/')[-1]);c['body']=req.post_data_json['body'];data={'ok':True,'task':task}
 route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 sender=browser.new_context(viewport={'width':1440,'height':1000});sender.route('**/*',lambda r:handler(r,author))
 page=sender.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(10000)
 page.goto(base+'/quadro/'+list_id);page.wait_for_load_state('networkidle')
 Path('/tmp/ideworks-mentions-board.html').write_text(page.content())
 page.get_by_role('button',name='+ Adicionar tarefa',exact=True).click()
 quick=page.get_by_role('textbox',name='Título da tarefa nova',exact=True)
 quick.fill('Olá @hel')
 expect(page.get_by_role('option',name='Hélia Assis',exact=False)).to_be_visible()
 page.screenshot(path='/tmp/ideworks-mention-suggestions.png',full_page=True)
 quick.press('Enter')
 expect(quick.locator('.mencao')).to_have_text('@Hélia Assis')
 assert len(created)==0
 quick.press('End');quick.press('Space');quick.press_sequentially('confira isto')
 page.locator('.t-caixa-nova').get_by_role('button',name='Criar',exact=True).click()
 expect(page.locator('.q-coluna-corpo .mencao')).to_have_count(1)
 assert target in created[0]['title']
 assert any('list='+list_id in u for u in candidates)
 page.goto(base+'/tarefa/'+task['id']);page.wait_for_load_state('networkidle')
 composer=page.locator('.c-bloco > .c-escrever');text=composer.get_by_role('textbox')
 text.fill('Confirme com @hel')
 page.get_by_role('option',name='Hélia Assis',exact=False).click()
 expect(text.locator('.mencao')).to_have_text('@Hélia Assis')
 assert text.locator('a').count()==0 and len(posts)==0
 text.press('End');text.press_sequentially(' antes de aprovar.')
 composer.get_by_role('button',name='Comentar',exact=True).click()
 expect(page.locator('.c-texto .mencao')).to_have_text('@Hélia Assis')
 assert target in posts[0]['body'];assert any('task='+task['id'] in u for u in candidates)
 text.fill('@Pessoa sem acesso');expect(page.get_by_text('Nenhuma pessoa com esse nome e acesso.')).to_be_visible()
 text.press('Escape');text.fill('')
 # Colar email não cria menção e Escape fecha a lista sem fechar a tarefa.
 text.fill('contato@example.test');expect(page.get_by_role('listbox',name='Pessoas com acesso')).to_have_count(0);text.fill('')
 # Descrição mantém o chip no meio do texto ao salvar e reabrir.
 editor=page.get_by_role('textbox',name='Descrição da tarefa',exact=True)
 editor.fill('Antes @hel');editor.press('End')
 page.get_by_role('option',name='Hélia Assis',exact=False).click()
 editor.press('End');editor.press_sequentially('Depois.')
 expect(editor.locator('.mencao')).to_have_text('@Hélia Assis')
 page.locator('.cu-trilha').get_by_role('button',name='Salvar',exact=True).click()
 page.reload();page.wait_for_load_state('networkidle')
 expect(editor.locator('.mencao')).to_have_text('@Hélia Assis')
 assert re.search(r'Antes.*mention:.*\) Depois',task['description']),task['description']
 page.locator('.c-bloco').screenshot(path='/tmp/ideworks-mention-comment.png')
 # A outra pessoa recebe o aviso, lê o card/lista e segue o atalho do comentário.
 receiver=browser.new_context(viewport={'width':1440,'height':1000});receiver.route('**/*',lambda r:handler(r,target))
 targetpage=receiver.new_page();targetpage.on('pageerror',lambda e:errors.append(str(e)))
 targetpage.goto(base+'/avisos');targetpage.wait_for_load_state('networkidle')
 expect(targetpage.get_by_role('heading',name='Mencionaram você',exact=False)).to_be_visible()
 expect(targetpage.get_by_text('Wesley mencionou você neste card.')).to_be_visible()
 expect(targetpage.locator('.av-origem')).to_contain_text('Sabor Doce')
 expect(targetpage.get_by_role('link',name='Abrir lista',exact=True)).to_have_attribute('href','/quadro/'+list_id)
 targetpage.screenshot(path='/tmp/ideworks-mention-notification.png',full_page=True)
 targetpage.get_by_role('link',name='Abrir comentário',exact=True).click()
 expect(targetpage.locator('.c-fala[data-destacado="true"]')).to_be_in_viewport()
 targetpage.goto(base+'/avisos');targetpage.get_by_role('button',name='Marcar como visto',exact=True).click()
 expect(targetpage.locator('.av-linha')).to_have_count(0)
 assert not errors,errors
 print('OK: @ no card, teclado/toque, chip sem link, comentário, descrição, permissão no seletor, notificação, lista e atalho.',flush=True)
 browser.close()
